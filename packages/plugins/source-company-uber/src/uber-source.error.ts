export type UberFailureCode = "HTTP" | "BLOCKED" | "SCHEMA_INVALID";

export class UberSourceError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: UberFailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "UberSourceError";
    this.cause = cause;
  }
}

export function uberErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
