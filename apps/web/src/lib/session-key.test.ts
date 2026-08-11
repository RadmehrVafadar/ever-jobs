import { describe, expect, it, vi } from "vitest";
import {
  clearSessionApiKey,
  getSessionApiKey,
  setSessionApiKey,
} from "./session-key";

describe("session API key storage", () => {
  it("trims and stores the key only in sessionStorage", () => {
    setSessionApiKey("  local-admin-key  ");

    expect(getSessionApiKey()).toBe("local-admin-key");
    expect(Object.values(window.sessionStorage)).toContain("local-admin-key");
    expect(Object.values(window.localStorage)).not.toContain("local-admin-key");
  });

  it("clears a stored key without persisting an empty value", () => {
    setSessionApiKey("local-admin-key");
    clearSessionApiKey();

    expect(getSessionApiKey()).toBe("");
    expect(window.sessionStorage.length).toBe(0);
  });

  it("notifies the active tab when credentials change", () => {
    const listener = vi.fn();
    window.addEventListener("radar-api-key-change", listener);

    setSessionApiKey("next-key");

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("radar-api-key-change", listener);
  });
});
