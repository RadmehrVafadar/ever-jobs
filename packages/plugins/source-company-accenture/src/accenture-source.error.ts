export type AccentureSourceErrorCode =
  | 'HTTP'
  | 'MARKUP_CHANGED'
  | 'SCHEMA_INVALID';

export class AccentureSourceError extends Error {
  constructor(
    readonly code: AccentureSourceErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AccentureSourceError';
  }
}
