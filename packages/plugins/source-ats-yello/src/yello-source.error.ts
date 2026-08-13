export type YelloSourceErrorCode =
  | 'INVALID_INPUT'
  | 'HTTP'
  | 'MARKUP_CHANGED'
  | 'SCHEMA_INVALID';

export class YelloSourceError extends Error {
  constructor(
    readonly code: YelloSourceErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'YelloSourceError';
  }
}
