import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";
import {
  normalizeLocationIdentity,
  parseLocationText,
} from "@ever-jobs/common";
import { JobPostDto, LocationDto, Site } from "@ever-jobs/models";

export const CANONICAL_EPISODE_WINDOW_MS = 14 * 24 * 60 * 60 * 1_000;

export interface CanonicalFingerprintOptions {
  /** The source target is an employer-owned company or ATS listing. */
  employerOwnedListing?: boolean;
}

@Injectable()
export class JobFingerprintService {
  private readonly trackingParameters = new Set([
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_id",
    "gh_src",
    "lever-source",
    "source",
    "ref",
    "referrer",
    "fbclid",
    "gclid",
    "mc_cid",
    "mc_eid",
  ]);

  normalizeText(value?: unknown): string {
    const text =
      typeof value === "string"
        ? value
        : value === null || value === undefined
          ? ""
          : String(value);
    return text
      .normalize("NFKC")
      .trim()
      .toLowerCase()
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ");
  }

  normalizeLocation(value?: unknown): string {
    return this.normalizeText(value)
      .replace(/greater toronto area/g, "gta")
      .replace(/\btoronto\s*,?\s*on(?:tario)?\b/g, "toronto ontario")
      .replace(/remote within canada/g, "remote canada")
      .replace(/canada remote/g, "remote canada");
  }

  canonicalizeUrl(value?: unknown): string {
    if (!value) return "";
    const text = typeof value === "string" ? value : String(value);
    try {
      const url = new URL(text.trim());
      url.protocol = url.protocol.toLowerCase();
      url.hostname = url.hostname.toLowerCase();
      if (
        (url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")
      ) {
        url.port = "";
      }
      for (const key of [...url.searchParams.keys()]) {
        if (
          this.trackingParameters.has(key.toLowerCase()) ||
          key.toLowerCase().startsWith("utm_")
        ) {
          url.searchParams.delete(key);
        }
      }
      url.searchParams.sort();
      url.hash = "";
      url.pathname = url.pathname.replace(/\/{2,}/g, "/");
      const rendered = url.toString();
      return rendered.endsWith("/") ? rendered.slice(0, -1) : rendered;
    } catch {
      return this.normalizeText(text).replace(/\/+$/, "");
    }
  }

  hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  descriptionHash(description?: unknown): string | null {
    const normalized = this.normalizeText(description);
    return normalized ? this.hash(normalized) : null;
  }

  fingerprint(job: JobPostDto): string {
    const source = this.normalizeText(job.site ?? "unknown");
    const externalId = this.normalizeText(job.id ?? job.atsId ?? null);
    if (externalId) {
      return this.hash(["external", source, externalId].join("|"));
    }
    return this.hash(
      [
        "source-record",
        source,
        this.canonicalIdentity(job, { employerOwnedListing: true }),
      ].join("|"),
    );
  }

  /** A source-independent grouping key; source observations remain preserved. */
  canonicalFingerprint(
    job: JobPostDto,
    options: CanonicalFingerprintOptions = {},
  ): string {
    return this.hash(
      ["canonical-job", this.canonicalIdentity(job, options)].join("|"),
    );
  }

  /**
   * Notification/match identity for one posting episode.
   *
   * Employer URLs keep a posting stable across sources. A genuine source date
   * is the next-best discriminator. Sources that expose neither start an
   * observation-anchored episode; persistence reuses that key for 14 days.
   */
  canonicalEpisodeFingerprint(
    job: JobPostDto,
    observedAt: Date,
    options: CanonicalFingerprintOptions = {},
  ): string {
    const employerUrl = this.canonicalEmployerUrl(job, options);
    const publicationDate = this.normalizedPublicationDate(job.datePosted);
    const observationAnchor = Number.isFinite(observedAt.getTime())
      ? observedAt.toISOString()
      : new Date(0).toISOString();
    const discriminator = employerUrl
      ? `url:${employerUrl}`
      : publicationDate
        ? `published:${publicationDate}`
        : `observed:${observationAnchor}`;
    return this.hash(
      [
        "canonical-episode",
        this.canonicalCoreIdentity(job),
        discriminator,
      ].join("|"),
    );
  }

  usesObservationEpisodeAnchor(
    job: JobPostDto,
    options: CanonicalFingerprintOptions = {},
  ): boolean {
    return (
      !this.canonicalEmployerUrl(job, options) &&
      !this.normalizedPublicationDate(job.datePosted)
    );
  }

  canonicalLocationKeys(job: JobPostDto): string[] {
    const extended = job as JobPostDto & { locations?: unknown[] | null };
    const candidates = [
      ...(Array.isArray(extended.locations) ? extended.locations : []),
      ...(extended.locations?.length ? [] : [job.location]),
    ];
    return [
      ...new Set(
        candidates
          .map((location) => this.canonicalLocationKey(location))
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right));
  }

  private canonicalIdentity(
    job: JobPostDto,
    options: CanonicalFingerprintOptions,
  ): string {
    return [
      this.canonicalCoreIdentity(job),
      this.canonicalEmployerUrl(job, options),
    ].join("|");
  }

  private canonicalCoreIdentity(job: JobPostDto): string {
    return [
      this.normalizeCanonicalText(job.companyName),
      this.normalizeCanonicalText(job.title),
      this.canonicalLocationKeys(job).join("\u001f"),
    ].join("|");
  }

  private canonicalEmployerUrl(
    job: JobPostDto,
    options: CanonicalFingerprintOptions,
  ): string {
    // Google Careers decorates its Apply URL with the search-matrix query,
    // location, locale, and page that discovered the job. Those parameters are
    // not posting identity. The official result URL contains Google's stable
    // numeric posting ID and remains constant across every matrix request.
    if (job.site === Site.GOOGLE_CAREERS && job.jobUrl) {
      return this.canonicalizeUrl(job.jobUrl);
    }
    const externalEmployerUrl = firstNonEmpty(job.applyUrl, job.jobUrlDirect);
    if (externalEmployerUrl) return this.canonicalizeUrl(externalEmployerUrl);
    if (options.employerOwnedListing) {
      return this.canonicalizeUrl(job.jobUrl);
    }
    return "";
  }

  private normalizedPublicationDate(value: unknown): string {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime())
      ? date.toISOString().slice(0, 10)
      : "";
  }

  private normalizeCanonicalText(value: unknown): string {
    return this.normalizeText(value)
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private canonicalLocationKey(value: unknown): string {
    if (typeof value === "string") {
      const parsed = parseLocationText(value).location;
      return parsed
        ? normalizeLocationIdentity(parsed)
        : this.normalizeLocation(value);
    }
    if (!value || typeof value !== "object") return "";
    const location = value as LocationDto;
    if (!location.city && !location.state && !location.country) return "";
    return normalizeLocationIdentity(location);
  }
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}
