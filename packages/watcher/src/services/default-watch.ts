import { JobWatch } from "../interfaces/watch.types";
import {
  prestigeInternshipsV2Watch,
  PRESTIGE_INTERNSHIPS_V2_NAME,
} from "./prestige-internships-v2.preset";

/** @deprecated Use `prestigeInternshipsV2Watch` and the versioned preset ID. */
export function defaultInternshipWatch(): Partial<JobWatch> {
  return prestigeInternshipsV2Watch();
}

/** @deprecated Use `PRESTIGE_INTERNSHIPS_V2_NAME`. */
export const DEFAULT_WATCH_NAME = PRESTIGE_INTERNSHIPS_V2_NAME;

export {
  prestigeInternshipsV2Watch,
  PRESTIGE_INTERNSHIPS_V2_ID,
  PRESTIGE_INTERNSHIPS_V2_NAME,
  PRESTIGE_INTERNSHIPS_V2_PRESET,
  PRESTIGE_INTERNSHIPS_V2_VERSION,
} from "./prestige-internships-v2.preset";
