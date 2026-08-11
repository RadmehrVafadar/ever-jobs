import { ArgumentsHost, ConflictException } from "@nestjs/common";
import { HttpExceptionFilter } from "../http-exception.filter";

describe("HttpExceptionFilter secret redaction", () => {
  it("preserves safe conflict metadata without returning webhook URLs", () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      getType: () => "http",
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          method: "POST",
          url: "/api/watches/watch-1/apply",
          headers: {},
          body: {},
        }),
      }),
    } as unknown as ArgumentsHost;

    new HttpExceptionFilter().catch(
      new ConflictException({
        code: "WATCH_STALE_UPDATE",
        message:
          "stale https://discord.com/api/webhooks/123/secret-token",
        currentUpdatedAt: "2026-08-04T12:00:00.000Z",
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "WATCH_STALE_UPDATE",
        currentUpdatedAt: "2026-08-04T12:00:00.000Z",
        detail: "stale [REDACTED_URL]",
      }),
    );
    expect(JSON.stringify(json.mock.calls)).not.toContain("secret-token");
  });
});
