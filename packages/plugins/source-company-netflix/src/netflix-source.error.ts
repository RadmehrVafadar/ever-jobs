export type NetflixFailureCode = "HTTP" | "BLOCKED" | "SCHEMA_INVALID";

export class NetflixSourceError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: NetflixFailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "NetflixSourceError";
    this.cause = cause;
  }
}

export function netflixErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
