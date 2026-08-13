export type IcimsFailureCode =
  | 'EXTRACTION_EMPTY'
  | 'INVALID_TENANT'
  | 'REQUEST_FAILED';

/** Typed iCIMS failure surfaced to watcher source-health accounting. */
export class IcimsSourceError extends Error {
  constructor(
    public readonly code: IcimsFailureCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'IcimsSourceError';
  }
}
