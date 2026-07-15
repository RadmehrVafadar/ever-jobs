export interface AppleSearchResponse {
  res?: {
    searchResults?: AppleJobResult[];
    totalRecords?: number;
  };
}

export interface AppleJobResult {
  id?: string | number;
  positionId?: string | number;
  postingTitle?: string;
  postingDate?: string;
  jobSummary?: string;
  transformedPostingTitle?: string;
  homeOffice?: boolean;
  locations?: AppleLocation[];
  team?: { teamName?: string };
}

export interface AppleLocation {
  city?: string;
  stateProvince?: string;
  countryName?: string;
  name?: string;
}
