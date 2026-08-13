/** Stable error code consumed by watcher source-health reporting. */
export const SUCCESSFACTORS_EXTRACTION_ERROR_CODE =
  'SUCCESSFACTORS_EXTRACTION_FAILED';

/**
 * Raised when an official SuccessFactors response says jobs exist but none can
 * be normalized. This is parser drift, not a valid empty search result.
 */
export class SuccessFactorsExtractionError extends Error {
  readonly code = SUCCESSFACTORS_EXTRACTION_ERROR_CODE;

  constructor(
    readonly companySlug: string,
    readonly advertisedResultCount: number,
  ) {
    super(
      `SuccessFactors advertised ${advertisedResultCount} result(s) for ${companySlug} but parsed zero jobs`,
    );
    this.name = 'SuccessFactorsExtractionError';
  }
}
