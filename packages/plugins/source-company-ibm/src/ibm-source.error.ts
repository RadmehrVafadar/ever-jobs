export type IbmFailureCode =
  | "HTTP"
  | "BLOCKED"
  | "MARKUP_CHANGED"
  | "SCHEMA_INVALID";

export class IbmSourceError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: IbmFailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "IbmSourceError";
    this.cause = cause;
  }
}

export function ibmErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
