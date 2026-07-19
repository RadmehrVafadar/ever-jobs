export type ShopifyFailureCode =
  | "HTTP"
  | "BLOCKED"
  | "MARKUP_CHANGED"
  | "SCHEMA_INVALID";

export class ShopifySourceError extends Error {
  readonly cause?: unknown;

  constructor(
    readonly code: ShopifyFailureCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "ShopifySourceError";
    this.cause = cause;
  }
}

export function shopifyErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
