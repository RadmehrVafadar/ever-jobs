export type GoogleCareersFailureCode =
  | "HTTP"
  | "BLOCKED"
  | "MARKUP_CHANGED"
  | "SCHEMA_INVALID";

export class GoogleCareersSourceError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: GoogleCareersFailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "GoogleCareersSourceError";
    this.cause = cause;
  }
}

export function googleCareersErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
