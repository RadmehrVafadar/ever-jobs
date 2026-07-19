import { Injectable } from "@nestjs/common";
import { JobPostDto, LocationDto } from "@ever-jobs/models";
import {
  LocationGeographyHint,
  LocationParseConfidence,
  normalizeLocationIdentity,
  parseLocationGeography,
  splitLocationLabels,
} from "@ever-jobs/common";
import {
  GeographyDecision,
  GeographyExplanation,
} from "../interfaces/watch.types";

export type GeographyPreference =
  | "toronto"
  | "greater-toronto-area"
  | "waterloo"
  | "remote-canada";

export interface GeographyTargetContext {
  key: string;
  tier: 1 | 2 | 3;
}

export interface GeographyClassification extends GeographyExplanation {
  eligible: boolean;
  suppressionReason?: "outside-target-scope" | "geography-unknown";
  preferences: GeographyPreference[];
  hints: LocationGeographyHint[];
}

const CONFIDENCE_RANK: Readonly<Record<LocationParseConfidence, number>> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/**
 * Applies target-tier policy to descriptive location hints. It deliberately
 * does not award ranking points; Toronto/GTA/Waterloo preferences are returned
 * separately for the scoring layer.
 */
@Injectable()
export class GeographyClassificationService {
  classify(
    job: JobPostDto,
    target: GeographyTargetContext,
  ): GeographyClassification {
    const hints = this.locationHints(job);
    const preferences = this.preferences(hints);
    const canadian = bestHint(hints.filter((hint) => hint.region === "canada"));
    const american = bestHint(
      hints.filter((hint) => hint.region === "united-states"),
    );
    const regional = bestHint(
      hints.filter(
        (hint) => hint.region === "north-america" || hint.region === "americas",
      ),
    );

    if (canadian) {
      return this.eligible(
        target.key,
        "eligible-canada",
        "CA",
        canadian.confidence,
        preferences,
        hints,
      );
    }

    if (target.tier !== 1 && american) {
      return this.eligible(
        target.key,
        "eligible-united-states",
        "US",
        american.confidence,
        preferences,
        hints,
      );
    }

    if (
      target.tier !== 1 &&
      regional &&
      !explicitlyExcludesCanadaAndUnitedStates(job.description)
    ) {
      return this.eligible(
        target.key,
        "eligible-north-america",
        undefined,
        regional.confidence,
        preferences,
        hints,
      );
    }

    const confidentlyOutside = bestHint(
      hints.filter(
        (hint) =>
          hint.region === "other" ||
          (target.tier === 1 &&
            (hint.region === "united-states" ||
              hint.region === "north-america" ||
              hint.region === "americas")),
      ),
    );
    if (
      confidentlyOutside ||
      (regional && explicitlyExcludesCanadaAndUnitedStates(job.description))
    ) {
      return {
        sourceTargetKey: target.key,
        locationConfidence:
          (confidentlyOutside ?? regional)?.confidence ?? "unknown",
        geographyDecision: "outside-target-scope",
        eligible: false,
        suppressionReason: "outside-target-scope",
        preferences,
        hints,
      };
    }

    return {
      sourceTargetKey: target.key,
      locationConfidence: bestHint(hints)?.confidence ?? "unknown",
      geographyDecision: "geography-unknown",
      eligible: false,
      suppressionReason: "geography-unknown",
      preferences,
      hints,
    };
  }

  private eligible(
    sourceTargetKey: string,
    geographyDecision: GeographyDecision,
    matchedCountry: "CA" | "US" | undefined,
    locationConfidence: LocationParseConfidence,
    preferences: GeographyPreference[],
    hints: LocationGeographyHint[],
  ): GeographyClassification {
    return {
      sourceTargetKey,
      ...(matchedCountry ? { matchedCountry } : {}),
      locationConfidence,
      geographyDecision,
      eligible: true,
      preferences,
      hints,
    };
  }

  private locationHints(job: JobPostDto): LocationGeographyHint[] {
    const locations = Array.isArray(job.locations)
      ? job.locations.filter(isLocationDto)
      : [];
    const legacyLocation = job.location as unknown;
    if (isLocationDto(legacyLocation)) {
      locations.push(legacyLocation);
    }

    const hints: LocationGeographyHint[] = [];
    const seen = new Set<string>();
    if (typeof legacyLocation === "string") {
      for (const label of splitLocationLabels(legacyLocation)) {
        this.addHint(hints, seen, label);
      }
    }
    for (const location of locations) {
      const cityLabels = splitLocationLabels(location.city);
      if (cityLabels.length > 1 && !location.state && !location.country) {
        for (const label of cityLabels) this.addHint(hints, seen, label);
        continue;
      }
      this.addHint(hints, seen, location);
    }

    if (
      hints.length === 0 &&
      (job.isRemote || /remote/i.test(text(job.workFromHomeType)))
    ) {
      this.addHint(hints, seen, "Remote");
    }
    return hints;
  }

  private addHint(
    hints: LocationGeographyHint[],
    seen: Set<string>,
    value: string | LocationDto,
  ): void {
    const hint = parseLocationGeography(value);
    const key = hint.location
      ? normalizeLocationIdentity(hint.location)
      : `${hint.region}|${hint.normalizedLabel.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    hints.push(hint);
  }

  private preferences(hints: LocationGeographyHint[]): GeographyPreference[] {
    const preferences = new Set<GeographyPreference>();
    for (const hint of hints) {
      if (hint.countryCode !== "CA") continue;
      const textValue = [
        hint.normalizedLabel,
        hint.location?.city,
        hint.location?.state,
      ]
        .filter(Boolean)
        .join(" ");
      if (/\btoronto\b/i.test(textValue)) preferences.add("toronto");
      if (/\b(?:gta|greater toronto area)\b/i.test(textValue)) {
        preferences.delete("toronto");
        preferences.add("greater-toronto-area");
      }
      if (/\bwaterloo\b/i.test(textValue)) preferences.add("waterloo");
      if (hint.remoteMentioned) preferences.add("remote-canada");
    }
    return [...preferences];
  }
}

function bestHint(
  hints: LocationGeographyHint[],
): LocationGeographyHint | undefined {
  return hints.reduce<LocationGeographyHint | undefined>(
    (best, candidate) =>
      !best ||
      CONFIDENCE_RANK[candidate.confidence] > CONFIDENCE_RANK[best.confidence]
        ? candidate
        : best,
    undefined,
  );
}

function explicitlyExcludesCanadaAndUnitedStates(
  description: string | null | undefined,
): boolean {
  const value = text(description);
  if (!value) return false;
  const excludesCanada =
    /(?:exclude|excluding|except|not available in|not open to|cannot hire in|no applicants? from)\s+(?:residents? (?:of|in)\s+)?canada/i.test(
      value,
    ) || /canada\s+(?:excluded|ineligible|not eligible)/i.test(value);
  const excludesUnitedStates =
    /(?:exclude|excluding|except|not available in|not open to|cannot hire in|no applicants? from)\s+(?:the\s+)?(?:united states|u\.?s\.?a?\.?)/i.test(
      value,
    ) ||
    /(?:united states|u\.?s\.?a?\.?)\s+(?:excluded|ineligible|not eligible)/i.test(
      value,
    );
  return excludesCanada && excludesUnitedStates;
}

function isLocationDto(value: unknown): value is LocationDto {
  return Boolean(value) && typeof value === "object";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
