/**
 * @deprecated Spec 6003 replaced the selectable prestige preset with
 * `canadian-tech-internships`. These aliases preserve source compatibility for
 * consumers that import the former TypeScript names; the retired string ID is
 * not registered by `WatchPresetService`.
 */
export {
  assertCanadianTechInternshipCompanyCoverage as assertPrestigeCompanyCoverage,
  CANADIAN_TECH_INTERNSHIP_COMPANIES as PRESTIGE_COMPANIES,
  CANADIAN_TECH_INTERNSHIP_DEFERRED_COMPANIES as PRESTIGE_DEFERRED_COMPANIES,
  CANADIAN_TECH_INTERNSHIP_LOCATIONS as PRESTIGE_TIER_1_LOCATIONS,
  CANADIAN_TECH_INTERNSHIP_LOCATIONS as PRESTIGE_TIER_2_3_LOCATIONS,
  CANADIAN_TECH_INTERNSHIP_SEARCH_TERMS as PRESTIGE_INTERNSHIP_SEARCH_TERMS,
  CANADIAN_TECH_INTERNSHIPS_ID as PRESTIGE_INTERNSHIPS_V2_ID,
  CANADIAN_TECH_INTERNSHIPS_NAME as PRESTIGE_INTERNSHIPS_V2_NAME,
  CANADIAN_TECH_INTERNSHIPS_PRESET as PRESTIGE_INTERNSHIPS_V2_PRESET,
  CANADIAN_TECH_INTERNSHIPS_VERSION as PRESTIGE_INTERNSHIPS_V2_VERSION,
  canadianTechInternshipsWatch as prestigeInternshipsV2Watch,
} from "./canadian-tech-internships.preset";

export type { WatchPresetDefinition } from "./canadian-tech-internships.preset";
