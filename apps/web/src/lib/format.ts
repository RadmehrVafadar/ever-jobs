export function formatDate(
  value?: string | null,
  options: Intl.DateTimeFormatOptions = {},
): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  }).format(date);
}

export function relativeTime(value?: string | null): string {
  if (!value) return "not yet";
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "unknown";
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size)
      return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, "second");
}

export function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact" }).format(
    value,
  );
}

export function percentage(value?: number | null): string {
  return value === undefined || value === null
    ? "—"
    : new Intl.NumberFormat(undefined, {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(value);
}

export function duration(value?: number | null): string {
  if (value === undefined || value === null) return "—";
  if (value < 1_000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1_000).toFixed(1)} s`;
  return `${Math.round(value / 60_000)} min`;
}

export function sentenceCase(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function locationLabel(
  location?: {
    city?: string | null;
    state?: string | null;
    country?: string | null;
  } | null,
): string {
  return (
    [location?.city, location?.state, location?.country]
      .filter(Boolean)
      .join(", ") || "Location not listed"
  );
}
