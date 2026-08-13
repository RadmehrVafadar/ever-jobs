/**
 * SAP SuccessFactors uses a public OData API for job postings.
 *
 * Company slug format: {instance}:{companyId}
 * e.g., "sap:SAP" or "successfactors:CompanyXYZ"
 *
 * OData API:
 *   https://{instance}.successfactors.com/odata/v2/JobRequisitionPosting
 *   Supports $filter, $select, $top, $skip, $orderby params
 *
 * HTML fallback:
 *   https://{instance}.successfactors.com/career?company={companyId}&keyword={term}
 *
 * SuccessFactors also powers branded career domains such as
 * `https://jobs.example.com/go/Students/1234/`. Those portals are addressed by
 * `ScraperInputDto.companyUrl`; their public search pages use `q` and
 * `startrow` query parameters.
 */

/** Default page size for SuccessFactors OData pagination */
export const SF_PAGE_SIZE = 20;

/** Default page size used by the branded SuccessFactors career-site theme. */
export const SF_VANITY_PAGE_SIZE = 25;

/** Page size used by the client-rendered RMK unified search service. */
export const SF_RMK_PAGE_SIZE = 25;

/** Hard ceiling preventing runaway pagination on malformed RMK responses. */
export const SF_RMK_MAX_PAGES = 20;

/** Locale sent by Deloitte Canada's public browser search. */
export const SF_RMK_DEFAULT_LOCALE = 'en_US';

/** Public JSON search route used by client-rendered SuccessFactors RMK sites. */
export const SF_RMK_JOBS_PATH = '/services/recruiting/v1/jobs';

/** Minimum delay between SuccessFactors requests (ms) */
export const SF_DELAY_MIN = 1500;

/** Maximum delay between SuccessFactors requests (ms) */
export const SF_DELAY_MAX = 3000;

/** Default headers for SuccessFactors API requests */
export const SF_HEADERS: Record<string, string> = {
  Accept:
    'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36',
};

/**
 * Parse a SuccessFactors compound slug into its components.
 * Format: "{instance}:{companyId}"
 * Defaults: companyId = instance name
 */
export function parseSfSlug(slug: string): {
  instance: string;
  companyId: string;
} {
  const parts = slug.split(':');
  return {
    instance: parts[0],
    companyId: parts[1] ?? parts[0],
  };
}

/**
 * Build the SuccessFactors OData API URL for a given instance.
 */
export function buildSfODataUrl(instance: string): string {
  return `https://${instance}.successfactors.com/odata/v2/JobRequisitionPosting`;
}

/**
 * Build the SuccessFactors HTML career page URL.
 */
export function buildSfCareerUrl(
  instance: string,
  companyId: string,
  keyword?: string,
): string {
  let url = `https://${instance}.successfactors.com/career?company=${encodeURIComponent(companyId)}`;
  if (keyword) {
    url += `&keyword=${encodeURIComponent(keyword)}`;
  }
  return url;
}

/** True when a branded SuccessFactors URL points at a single job page. */
export function isSfJobDetailUrl(rawUrl: string): boolean {
  try {
    return /\/(?:job|jobdetail)(?:\/|$)/i.test(new URL(rawUrl).pathname);
  } catch {
    return false;
  }
}

/**
 * Build a branded SuccessFactors listing URL without replacing the caller's
 * domain or campaign path. `/go/` category pages and `/search/` pages both
 * accept the same `q` and `startrow` parameters.
 */
export function buildSfVanityListingUrl(
  rawUrl: string,
  keyword: string | undefined,
  startRow: number,
): string {
  const url = new URL(rawUrl);

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('companyUrl must use http or https');
  }

  if (url.pathname === '' || url.pathname === '/') {
    url.pathname = '/search/';
  }

  url.hash = '';
  if (keyword !== undefined) {
    url.searchParams.set('q', keyword);
  }
  url.searchParams.set('startrow', String(Math.max(0, Math.floor(startRow))));
  return url.toString();
}

/** Resolve a listing/detail href while retaining the branded career domain. */
export function resolveSfUrl(href: string, pageUrl: string): string {
  return new URL(href, pageUrl).toString();
}

/** Resolve the RMK unified-search API without leaving the supplied vanity host. */
export function buildSfRmkJobsUrl(rawUrl: string): string {
  return new URL(SF_RMK_JOBS_PATH, new URL(rawUrl).origin).toString();
}
