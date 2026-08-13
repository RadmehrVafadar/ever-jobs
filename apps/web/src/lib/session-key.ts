const STORAGE_KEY = "radar.operator.api-key";

export function getSessionApiKey(): string {
  if (typeof window === "undefined") return "";
  return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
}

export function setSessionApiKey(value: string): void {
  if (typeof window === "undefined") return;
  const trimmed = value.trim();
  if (trimmed) window.sessionStorage.setItem(STORAGE_KEY, trimmed);
  else window.sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("radar-api-key-change"));
}

export function clearSessionApiKey(): void {
  setSessionApiKey("");
}
