import { JobPost } from "../types";
import { locationLabel } from "./format";

export function downloadText(
  filename: string,
  text: string,
  type = "application/json",
): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, value: unknown): void {
  downloadText(filename, `${JSON.stringify(value, null, 2)}\n`);
}

export function jobsToCsv(jobs: JobPost[]): string {
  const headings = [
    "site",
    "title",
    "company",
    "location",
    "remote",
    "posted",
    "url",
  ];
  const rows = jobs.map((job) => [
    job.site ?? "",
    job.title,
    job.companyName ?? "",
    locationLabel(job.location),
    job.isRemote ? "yes" : "no",
    job.datePosted ?? "",
    job.applyUrl ?? job.jobUrl,
  ]);
  return [headings, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
