import { JobWatch } from "../interfaces/watch.types";
import {
  canadianTechInternshipsWatch,
  CANADIAN_TECH_INTERNSHIPS_NAME,
} from "./canadian-tech-internships.preset";

/** @deprecated Use `canadianTechInternshipsWatch` and the versioned preset ID. */
export function defaultInternshipWatch(): Partial<JobWatch> {
  return canadianTechInternshipsWatch();
}

/** @deprecated Use `CANADIAN_TECH_INTERNSHIPS_NAME`. */
export const DEFAULT_WATCH_NAME = CANADIAN_TECH_INTERNSHIPS_NAME;

export {
  canadianTechInternshipsWatch,
  CANADIAN_TECH_INTERNSHIPS_ID,
  CANADIAN_TECH_INTERNSHIPS_NAME,
  CANADIAN_TECH_INTERNSHIPS_PRESET,
  CANADIAN_TECH_INTERNSHIPS_VERSION,
} from "./canadian-tech-internships.preset";
