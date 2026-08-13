/** Stable error code used by watcher health reporting and adapter tests. */
export const WORKDAY_EXTRACTION_ERROR_CODE = 'WORKDAY_EXTRACTION_FAILED';

/**
 * Raised when Workday advertises available jobs but the adapter cannot produce
 * a single normalized posting. This distinguishes parser drift from a real,
 * successful zero-result search.
 */
export class WorkdayExtractionError extends Error {
  readonly code = WORKDAY_EXTRACTION_ERROR_CODE;

  constructor(
    readonly companySlug: string,
    readonly advertisedResultCount: number,
  ) {
    super(
      `Workday advertised ${advertisedResultCount} result(s) for ${companySlug} but parsed zero jobs`,
    );
    this.name = 'WorkdayExtractionError';
  }
}
