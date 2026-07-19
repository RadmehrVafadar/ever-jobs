import { createHash } from "crypto";
import { Injectable } from "@nestjs/common";
import { JobPostDto } from "@ever-jobs/models";

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
      ["source-record", source, this.canonicalIdentity(job)].join("|"),
    );
  }

  /** A source-independent grouping key; source observations remain preserved. */
  canonicalFingerprint(job: JobPostDto): string {
    return this.hash(["canonical-job", this.canonicalIdentity(job)].join("|"));
  }

  private canonicalIdentity(job: JobPostDto): string {
    const location =
      typeof job.location === "string"
        ? job.location
        : [job.location?.city, job.location?.state, job.location?.country]
            .filter(Boolean)
            .join(" ");
    return [
      this.normalizeText(job.companyName),
      this.normalizeText(job.title),
      this.normalizeLocation(location),
      this.canonicalizeUrl(job.applyUrl ?? job.jobUrlDirect ?? job.jobUrl),
    ].join("|");
  }
}
