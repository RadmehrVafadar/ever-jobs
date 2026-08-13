/**
 * TypeScript interfaces for SAP SuccessFactors OData API responses.
 */

export interface SfJobPosting {
  jobReqId?: string | null;
  jobTitle?: string | null;
  jobDescription?: string | null;
  locationObj?: {
    city?: string | null;
    state?: string | null;
    country?: string | null;
  } | null;
  locationObjlist?: Array<{
    city?: string | null;
    state?: string | null;
    country?: string | null;
  }> | null;
  department?: string | null;
  division?: string | null;
  postingStartDate?: string | null;
  postingEndDate?: string | null;
  jobType?: string | null;
  employmentType?: string | null;
  companyName?: string | null;
  externalJobUrl?: string | null;
  formattedJobTitle?: string | null;
}

export interface SfODataResponse {
  d?: {
    results?: SfJobPosting[];
    __count?: string;
    __next?: string;
  };
}

/** Metadata retained while walking a branded SuccessFactors listing page. */
export interface SfVanityPageResult {
  jobs: import('@ever-jobs/models').JobPostDto[];
  advertisedResultCount: number | null;
  /** Zero-based startrow value advertised by the page's next result range. */
  nextStartRow: number | null;
  /** Number of listing elements found before field validation. */
  cardCount: number;
}

/** Minimal schema.org JobPosting shape used by branded detail pages. */
export interface SfJsonLdJobPosting {
  '@type'?: string | string[];
  title?: string;
  description?: string;
  datePosted?: string;
  employmentType?: string | string[];
  url?: string;
  identifier?: string | { value?: string; name?: string };
  hiringOrganization?: { name?: string };
  jobLocation?:
    | SfJsonLdJobLocation
    | SfJsonLdJobLocation[];
}

export interface SfJsonLdJobLocation {
  address?: {
    addressLocality?: string;
    addressRegion?: string;
    addressCountry?: string | { name?: string };
  };
}

/** Request emitted by the current SuccessFactors RMK unified-search widget. */
export interface SfRmkSearchRequest {
  keywords: string;
  locale: string;
  location: string;
  /** Zero-based page number. */
  pageNumber: number;
  sortBy: 'recent';
}

export interface SfRmkSearchResponse {
  jobSearchResult?: SfRmkJobEnvelope[] | null;
  totalJobs?: number | string | null;
}

export interface SfRmkJobEnvelope {
  response?: SfRmkJob | null;
}

/**
 * Tenant-configurable RMK unified result fields. Known Deloitte fields are
 * named explicitly; the index signature keeps other configured card fields
 * available without weakening the normalized mapper.
 */
export interface SfRmkJob {
  id?: string | number | null;
  unifiedStandardTitle?: string | null;
  unifiedUrlTitle?: string | null;
  urlTitle?: string | null;
  jobTitle?: string | null;
  mfield1?: string | string[] | null;
  jobLocationShort?: string | string[] | null;
  employeeType?: string | string[] | null;
  filter6?: string | string[] | null;
  unifiedStandardStart?: string | null;
  referenceDate?: string | null;
  department?: string | null;
  jobFunction?: string | null;
  company?: string | null;
  companyName?: string | null;
  description?: string | null;
  jobDescription?: string | null;
  externalJobUrl?: string | null;
  jobUrl?: string | null;
  url?: string | null;
  [key: string]: unknown;
}
