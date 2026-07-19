import { BadRequestException, Injectable } from "@nestjs/common";
import { Site } from "@ever-jobs/models";
import { z } from "zod";
import { JobWatch } from "../interfaces/watch.types";

const initializationModes = ["baseline", "recent-only", "notify-all"] as const;
const workplaceTypes = ["remote", "hybrid", "on-site"] as const;

export const watchSearchScopeSchema = z
  .object({
    countryCodes: z
      .array(
        z
          .string()
          .trim()
          .length(2)
          .transform((value) => value.toUpperCase()),
      )
      .min(1)
      .max(25),
    locations: z.array(z.string().trim().min(1)).min(1).max(100),
    searchTerms: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
    maxRequestsPerRun: z.number().int().min(1).max(1_000).optional(),
  })
  .strict();

export const watchSourceTargetSchema = z.object({
  site: z.nativeEnum(Site),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  intervalMinutes: z
    .number()
    .int()
    .min(1)
    .max(24 * 60),
  companySlug: z.string().trim().min(1).max(200).optional(),
  companyName: z.string().trim().min(1).max(200).optional(),
  searchScope: watchSearchScopeSchema.optional(),
  enabled: z.boolean().default(true),
  initializedAt: z.coerce.date().nullable().optional(),
  lastRunAt: z.coerce.date().nullable().optional(),
  nextRunAt: z.coerce.date().nullable().optional(),
});

export const notificationDestinationSchema = z
  .object({
    type: z.enum(["telegram", "discord", "webhook"]),
    destinationRef: z.string().trim().min(1).max(100).default("default"),
  })
  .strict();

const watchObjectSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    enabled: z.boolean().optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    schedule: z.string().trim().max(100).nullable().optional(),
    intervalMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .optional(),
    timezone: z.string().trim().min(1).max(100).optional(),
    sourceTargets: z.array(watchSourceTargetSchema).min(1).max(250).optional(),
    sources: z.array(z.string().trim().min(1)).max(250).optional(),
    sourceTiers: z.record(z.number().int().min(1).max(3)).optional(),
    companySlugs: z.array(z.string().trim().min(1)).max(250).optional(),
    companies: z.array(z.string().trim().min(1)).max(500).optional(),
    searchTerms: z.array(z.string().trim().min(1)).min(1).max(100).optional(),
    requiredTerms: z.array(z.string().trim().min(1)).max(100).optional(),
    preferredTerms: z.array(z.string().trim().min(1)).max(250).optional(),
    excludedTerms: z.array(z.string().trim().min(1)).max(250).optional(),
    locations: z.array(z.string().trim().min(1)).max(100).optional(),
    countryCodes: z
      .array(
        z
          .string()
          .trim()
          .length(2)
          .transform((v) => v.toUpperCase()),
      )
      .max(25)
      .optional(),
    allowedWorkplaceTypes: z.array(z.enum(workplaceTypes)).max(3).optional(),
    allowedEmploymentTypes: z
      .array(z.string().trim().min(1))
      .max(25)
      .optional(),
    minimumScore: z.number().int().min(0).max(500).optional(),
    urgentScore: z.number().int().min(0).max(500).optional(),
    digestScore: z.number().int().min(0).max(500).optional(),
    notificationChannels: z
      .array(notificationDestinationSchema)
      .max(10)
      .optional(),
    initializationMode: z.enum(initializationModes).optional(),
    recentWindowMinutes: z
      .number()
      .int()
      .min(1)
      .max(7 * 24 * 60)
      .optional(),
    weights: z.record(z.number().min(0).max(100)).optional(),
  })
  .strict();

function assertTimezone(timezone: string | undefined): void {
  if (!timezone) return;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format();
  } catch {
    throw new BadRequestException(`Invalid IANA timezone: ${timezone}`);
  }
}

function assertThresholds(input: Partial<JobWatch>): void {
  const digest = input.digestScore;
  const minimum = input.minimumScore;
  const urgent = input.urgentScore;
  if (digest !== undefined && minimum !== undefined && digest > minimum) {
    throw new BadRequestException(
      "digestScore must be less than or equal to minimumScore",
    );
  }
  if (minimum !== undefined && urgent !== undefined && minimum > urgent) {
    throw new BadRequestException(
      "minimumScore must be less than or equal to urgentScore",
    );
  }
  if (digest !== undefined && urgent !== undefined && digest > urgent) {
    throw new BadRequestException(
      "digestScore must be less than or equal to urgentScore",
    );
  }
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "watch"}: ${issue.message}`)
    .join("; ");
}

@Injectable()
export class WatchValidationService {
  parseCreate(value: unknown): Partial<JobWatch> {
    const result = watchObjectSchema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(formatZodError(result.error));
    }
    const parsed = result.data as unknown as Partial<JobWatch>;
    assertTimezone(parsed.timezone);
    assertThresholds(parsed);
    return parsed;
  }

  parsePatch(value: unknown, current: JobWatch): Partial<JobWatch> {
    const result = watchObjectSchema.partial().safeParse(value);
    if (!result.success) {
      throw new BadRequestException(formatZodError(result.error));
    }
    const parsed = result.data as unknown as Partial<JobWatch>;
    assertTimezone(parsed.timezone);
    assertThresholds({ ...current, ...parsed });
    return parsed;
  }
}
