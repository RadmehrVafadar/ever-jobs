/**
 * TypeScript interfaces for iCIMS responses.
 */

export interface IcimsJobListItem {
  id?: string | null;
  title?: string | null;
  url?: string | null;
  location?: string | null;
  datePosted?: string | null;
  category?: string | null;
  description?: string | null;
  employmentType?: string | null;
  applicationDeadline?: string | null;
  companyName?: string | null;
}

export interface IcimsGatewayResponse {
  jobs?: Array<IcimsJobListItem | IcimsJibeJobEnvelope>;
  totalCount?: number;
  count?: number;
  meta_data?: unknown;
}

/** Current iCIMS Career Sites (formerly Jibe) `/api/jobs` envelope. */
export interface IcimsJibeJobEnvelope {
  data?: IcimsJibeJobData | null;
}

/** Public fields emitted by the iCIMS Career Sites search API. */
export interface IcimsJibeJobData {
  slug?: string | null;
  req_id?: string | null;
  title?: string | null;
  description?: string | null;
  location_name?: string | null;
  full_location?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  country_code?: string | null;
  categories?: Array<{ name?: string | null }> | null;
  category?: string | null;
  department?: string | null;
  tags1?: string[] | null;
  tags2?: string[] | null;
  tags3?: string[] | null;
  employment_type?: string | null;
  posted_date?: string | null;
  create_date?: string | null;
  update_date?: string | null;
  apply_url?: string | null;
  hiring_organization?: string | { name?: string | null } | null;
}

export interface IcimsTenantContext {
  companySlug: string;
  companyName: string;
  boardUrl: string;
  explicitCompanyUrl: boolean;
}

export interface IcimsHtmlParseResult {
  jobs: IcimsJobListItem[];
  advertisedCount?: number;
  discoveryUrl?: string;
  isJibePortal: boolean;
}
