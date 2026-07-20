import { SourcePlugin } from "@ever-jobs/plugin";

import { Injectable, Logger } from "@nestjs/common";
import {
  IScraper,
  ScraperInputDto,
  JobResponseDto,
  JobPostDto,
  Site,
  LocationDto,
} from "@ever-jobs/models";
import { createHttpClient } from "@ever-jobs/common";
import {
  MICROSOFT_SEARCH_ENDPOINT,
  MICROSOFT_HEADERS,
  MICROSOFT_PAGE_SIZE,
  MICROSOFT_REQUEST_DELAY_MS,
  MICROSOFT_BASE_URL,
} from "./microsoft.constants";
import { EightfoldSearchResponse, EightfoldPosition } from "./microsoft.types";

@SourcePlugin({
  site: Site.MICROSOFT,
  name: "Microsoft",
  category: "company",
  watchMode: "query",
})
@Injectable()
export class MicrosoftService implements IScraper {
  private readonly logger = new Logger(MicrosoftService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const jobs: JobPostDto[] = [];
    const maxResults = input.resultsWanted ?? 100;
    let start = 0;
    let consecutiveEmpty = 0;

    try {
      const client = createHttpClient({
        proxies: input.proxies,
        timeout: input.requestTimeout ?? 30,
      });
      client.setHeaders(MICROSOFT_HEADERS);

      while (jobs.length < maxResults && consecutiveEmpty < 3) {
        const { data } = await client.get<EightfoldSearchResponse>(
          MICROSOFT_SEARCH_ENDPOINT,
          {
            params: {
              domain: "microsoft.com",
              query: input.searchTerm ?? "",
              location: input.location ?? "",
              start,
              sort_by: "timestamp",
            },
          },
        );

        const positions = data?.data?.positions;
        if (!Array.isArray(positions)) {
          throw new Error(
            "Microsoft returned an invalid response: expected data.positions[]",
          );
        }
        if (positions.length === 0) {
          consecutiveEmpty++;
          start += MICROSOFT_PAGE_SIZE;
          await this.delay(MICROSOFT_REQUEST_DELAY_MS);
          continue;
        }

        consecutiveEmpty = 0;
        for (const p of positions) {
          if (jobs.length >= maxResults) break;
          jobs.push(this.mapToJobPost(p));
        }

        start += MICROSOFT_PAGE_SIZE;
        await this.delay(MICROSOFT_REQUEST_DELAY_MS);
      }

      this.logger.log(`Microsoft: scraped ${jobs.length} jobs`);
    } catch (err: any) {
      this.logger.error(`Microsoft scrape failed: ${err.message}`);
      throw err;
    }

    return { jobs };
  }

  private mapToJobPost(p: EightfoldPosition): JobPostDto {
    if (!p || typeof p !== "object") {
      throw new Error(
        "Microsoft returned an invalid position: expected an object",
      );
    }
    if (typeof p.name !== "string" || !p.name.trim()) {
      throw new Error(
        "Microsoft returned an invalid position: expected a non-empty name",
      );
    }
    if (
      p.locations !== undefined &&
      (!Array.isArray(p.locations) ||
        p.locations.some((location) => typeof location !== "string"))
    ) {
      throw new Error(
        "Microsoft returned an invalid position: expected locations[] of strings",
      );
    }

    const seenLocations = new Set<string>();
    const locations = (p.locations ?? [])
      .map((value) => value.trim())
      .filter((value) => {
        const key = value.toLowerCase();
        if (!value || seenLocations.has(key)) return false;
        seenLocations.add(key);
        return true;
      })
      .map((value) => this.toLocation(value));

    const url = p.positionUrl
      ? `${MICROSOFT_BASE_URL}${p.positionUrl}`
      : undefined;

    return new JobPostDto({
      id: p.id === null || p.id === undefined ? undefined : String(p.id),
      site: Site.MICROSOFT,
      title: p.name,
      companyName: "Microsoft",
      jobUrl: url,
      location: locations[0] ?? null,
      locations,
      department: p.department ?? undefined,
      datePosted: p.postedTs
        ? new Date(p.postedTs * 1000).toISOString().split("T")[0]
        : undefined,
      atsId:
        p.displayJobId === null || p.displayJobId === undefined
          ? undefined
          : String(p.displayJobId),
    });
  }

  private toLocation(value: string): LocationDto {
    const parts = value.split(",").map((part) => part.trim());
    return new LocationDto({
      city: parts[0] || null,
      state: parts.length > 2 ? parts[1] || null : null,
      country: parts.length > 1 ? parts[parts.length - 1] || null : null,
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
