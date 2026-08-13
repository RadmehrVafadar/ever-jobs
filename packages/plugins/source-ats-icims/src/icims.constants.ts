/**
 * iCIMS exposes two public career-site generations. Legacy portals render a
 * search document under `*.icims.com/jobs/search`; current Career Sites
 * (formerly Jibe) expose a paginated `/api/jobs` JSON endpoint. Playwright is
 * retained only as a bounded last-resort compatibility path.
 *
 * Company slug format: subdomain (e.g., `facebook`)
 * Search URL: https://{company}.icims.com/jobs/search?ss=1&searchKeyword={term}&searchLocation={location}
 * Gateway JSON URL: https://{company}.icims.com/jobs/search?pr=0&schemaId=&o={offset}&mode=job&iis=Internet
 * Page size: 20
 * Delay: 3000-5000ms
 */

/** Default page size for legacy `*.icims.com/jobs/search` pagination. */
export const ICIMS_PAGE_SIZE = 20;

/** Default page size for current iCIMS Career Sites `/api/jobs`. */
export const ICIMS_CAREER_SITES_PAGE_SIZE = 25;

/** Maximum redirect/iframe discovery hops before using the browser fallback. */
export const ICIMS_MAX_DISCOVERY_HOPS = 2;

/** Maximum hydrated pages visited by the Playwright fallback. */
export const ICIMS_MAX_PLAYWRIGHT_PAGES = 3;

/** Hydration wait used only by the browser fallback. */
export const ICIMS_PLAYWRIGHT_HYDRATION_MS = 2500;

/** Minimum delay between iCIMS requests (ms) */
export const ICIMS_DELAY_MIN = 3000;

/** Maximum delay between iCIMS requests (ms) */
export const ICIMS_DELAY_MAX = 5000;

/** Default headers for iCIMS gateway requests */
export const ICIMS_HEADERS: Record<string, string> = {
  Accept: 'application/json, text/html, */*',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129 Safari/537.36',
};

/**
 * Build the iCIMS search page URL (used for Playwright fallback).
 */
export function buildIcimsSearchUrl(
  company: string,
  keyword?: string,
  location?: string,
  page?: number,
): string {
  const base = `https://${company}.icims.com/jobs/search`;
  const params = new URLSearchParams();
  params.set('ss', '1');
  if (keyword) params.set('searchKeyword', keyword);
  if (location) params.set('searchLocation', location);
  if (page && page > 1) {
    params.set('pr', String((page - 1) * ICIMS_PAGE_SIZE));
  }
  return `${base}?${params.toString()}`;
}

/**
 * Build the iCIMS gateway JSON endpoint URL (tried first before Playwright).
 */
export function buildIcimsGatewayUrl(company: string, offset: number): string {
  const params = new URLSearchParams();
  params.set('pr', String(offset));
  params.set('schemaId', '');
  params.set('o', String(offset));
  params.set('mode', 'job');
  params.set('iis', 'Internet');
  return `https://${company}.icims.com/jobs/search?${params.toString()}`;
}

/** Build the current iCIMS Career Sites (Jibe) public JSON endpoint. */
export function buildIcimsCareerSitesApiUrl(
  portalUrl: string,
  page: number,
  limit: number,
  keyword?: string,
  location?: string,
): string {
  const portal = new URL(portalUrl);
  const url = new URL('/api/jobs', portal.origin);
  url.searchParams.set('lang', 'en-US');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('page', String(page));
  if (keyword) url.searchParams.set('keywords', keyword);
  if (location) url.searchParams.set('location', location);
  return url.toString();
}
