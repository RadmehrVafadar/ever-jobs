import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger";
import {
  INTERNSHIP_ROLE_FAMILIES,
  InternshipRoleFamily,
} from "@ever-jobs/watcher";

const WATCH_MATCH_STATUSES = [
  "new",
  "reviewed",
  "applied",
  "dismissed",
  "interview",
  "rejected",
  "offer",
] as const;
const NOTIFICATION_STATUSES = [
  "pending",
  "sent",
  "failed",
  "suppressed",
] as const;
const WATCH_RUN_STATUSES = [
  "running",
  "completed",
  "failed",
  "partial",
] as const;

export class WatchSearchScopeDto {
  @ApiProperty({ type: [String], example: ["CA"] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  countryCodes!: string[];

  @ApiProperty({
    type: [String],
    example: ["Toronto, Ontario", "Greater Toronto Area", "Markham, Ontario"],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  locations!: string[];

  @ApiPropertyOptional({
    description:
      "Require at least one returned job location to match the configured locations.",
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  strictLocations?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  searchTerms?: string[];

  @ApiPropertyOptional({ minimum: 1, maximum: 1000, example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  maxRequestsPerRun?: number;
}

export class WatchSourceTargetDto {
  @ApiProperty({ example: "google_careers" })
  @IsString()
  @IsNotEmpty()
  site!: string;

  @ApiProperty({ enum: [1, 2, 3], example: 1 })
  @IsInt()
  @Min(1)
  @Max(3)
  tier!: 1 | 2 | 3;

  @ApiProperty({ example: 3, minimum: 1, maximum: 1440 })
  @IsInt()
  @Min(1)
  @Max(1_440)
  intervalMinutes!: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000, example: 500 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  resultsWanted?: number;

  @ApiPropertyOptional({ example: "shopify" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companySlug?: string;

  @ApiPropertyOptional({ example: "Wealthsimple" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  companyName?: string;

  @ApiPropertyOptional({ example: "https://jobs.example.ca" })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  @IsNotEmpty()
  @MaxLength(2_000)
  companyUrl?: string;

  @ApiPropertyOptional({ enum: ["board", "board-search", "query"] })
  @IsOptional()
  @IsIn(["board", "board-search", "query"])
  mode?: "board" | "board-search" | "query";

  @ApiPropertyOptional({ type: () => WatchSearchScopeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => WatchSearchScopeDto)
  searchScope?: WatchSearchScopeDto;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsISO8601({ strict: true })
  initializedAt?: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsISO8601({ strict: true })
  lastRunAt?: string | null;

  @ApiPropertyOptional({ format: "date-time", nullable: true })
  @IsOptional()
  @IsISO8601({ strict: true })
  nextRunAt?: string | null;
}

export class NotificationDestinationDto {
  @ApiProperty({ enum: ["discord", "telegram", "webhook"], example: "discord" })
  @IsIn(["discord", "telegram", "webhook"])
  type!: "discord" | "telegram" | "webhook";

  @ApiProperty({
    example: "default",
    description: "Non-secret reference resolved from server environment.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  destinationRef!: string;
}

export class NotificationRouteConditionsDto {
  @ApiPropertyOptional({ enum: [1, 2, 3], isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(3, { each: true })
  sourceTiers?: Array<1 | 2 | 3>;

  @ApiPropertyOptional({
    enum: ["urgent", "standard", "digest"],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(["urgent", "standard", "digest"], { each: true })
  notificationTypes?: Array<"urgent" | "standard" | "digest">;

  @ApiPropertyOptional({ minimum: 0, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  minimumScore?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  maximumScore?: number;
}

export class NotificationRouteDto {
  @ApiProperty({ example: "tier-one-urgent" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  id!: string;

  @ApiProperty({ example: "Tier 1 urgent roles" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiProperty({ default: true })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({ enum: ["discord", "telegram", "webhook"] })
  @IsIn(["discord", "telegram", "webhook"])
  provider!: "discord" | "telegram" | "webhook";

  @ApiProperty({ example: "tier-one" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  destinationRef!: string;

  @ApiPropertyOptional({ type: () => NotificationRouteConditionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => NotificationRouteConditionsDto)
  conditions?: NotificationRouteConditionsDto;
}

export class CreateWatchDto {
  @ApiProperty({ example: "Toronto and Canada Software Internships" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string | null;

  @ApiPropertyOptional({ example: "*/3 * * * *" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  schedule?: string | null;

  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 1440 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_440)
  intervalMinutes?: number;

  @ApiPropertyOptional({ example: "America/Toronto" })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone?: string;

  @ApiPropertyOptional({ type: [WatchSourceTargetDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @ValidateNested({ each: true })
  @Type(() => WatchSourceTargetDto)
  sourceTargets?: WatchSourceTargetDto[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @IsString({ each: true })
  sources?: string[];

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { type: "number" },
  })
  @IsOptional()
  @IsObject()
  sourceTiers?: Record<string, number>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @IsString({ each: true })
  companySlugs?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  companies?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  searchTerms?: string[];

  @ApiPropertyOptional({ enum: INTERNSHIP_ROLE_FAMILIES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(INTERNSHIP_ROLE_FAMILIES.length)
  @ArrayUnique()
  @IsIn(INTERNSHIP_ROLE_FAMILIES, { each: true })
  roleFamilies?: InternshipRoleFamily[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  requiredTerms?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @IsString({ each: true })
  preferredTerms?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @IsString({ each: true })
  excludedTerms?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  locations?: string[];

  @ApiPropertyOptional({ type: [String], example: ["CA"] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  countryCodes?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ["remote", "hybrid", "on-site"],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(["remote", "hybrid", "on-site"], { each: true })
  allowedWorkplaceTypes?: string[];

  @ApiPropertyOptional({ type: [String], example: ["internship", "co-op"] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(25)
  @IsString({ each: true })
  allowedEmploymentTypes?: string[];

  @ApiPropertyOptional({ minimum: 0, maximum: 500, example: 60 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  minimumScore?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 500, example: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  urgentScore?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 500, example: 40 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(500)
  digestScore?: number;

  @ApiPropertyOptional({ type: [NotificationDestinationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => NotificationDestinationDto)
  notificationChannels?: NotificationDestinationDto[];

  @ApiPropertyOptional({ type: [NotificationRouteDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NotificationRouteDto)
  notificationRoutes?: NotificationRouteDto[];

  @ApiPropertyOptional({
    enum: ["baseline", "recent-only", "notify-all"],
    default: "baseline",
  })
  @IsOptional()
  @IsIn(["baseline", "recent-only", "notify-all"])
  initializationMode?: "baseline" | "recent-only" | "notify-all";

  @ApiPropertyOptional({ minimum: 1, maximum: 10080, example: 180 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_080)
  recentWindowMinutes?: number;

  @ApiPropertyOptional({
    type: "object",
    additionalProperties: { type: "number" },
  })
  @IsOptional()
  @IsObject()
  weights?: Record<string, number>;
}

export class UpdateWatchDto extends PartialType(CreateWatchDto) {}

export class ApplyWatchDto {
  @ApiProperty({
    format: "date-time",
    description: "The updatedAt value from the draft's source watch.",
  })
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;

  @ApiProperty({ type: () => UpdateWatchDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => UpdateWatchDto)
  patch!: UpdateWatchDto;
}

export class InitializeWatchDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      "Target keys to baseline. Omit or pass an empty array to initialize all enabled targets.",
    example: ["ashby:wealthsimple", "google_careers"],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  targetKeys?: string[];
}

export class PaginationQueryDto {
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class WatchRunQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WATCH_RUN_STATUSES })
  @IsOptional()
  @IsIn(WATCH_RUN_STATUSES)
  status?: (typeof WATCH_RUN_STATUSES)[number];

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  startedAfter?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  startedBefore?: string;
}

export class WatchMatchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WATCH_MATCH_STATUSES })
  @IsOptional()
  @IsIn(WATCH_MATCH_STATUSES)
  status?: (typeof WATCH_MATCH_STATUSES)[number];

  @ApiPropertyOptional({ enum: NOTIFICATION_STATUSES })
  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  notificationState?: (typeof NOTIFICATION_STATUSES)[number];

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minimumScore?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maximumScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  company?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employmentType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workplaceType?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  matchedAfter?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  matchedBefore?: string;
}

export class ObservedJobQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  company?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  employmentType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workplaceType?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  firstSeenAfter?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  firstSeenBefore?: string;
}

export class NotificationDeliveryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  watchId?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  watchMatchId?: string;

  @ApiPropertyOptional({ enum: NOTIFICATION_STATUSES })
  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  status?: (typeof NOTIFICATION_STATUSES)[number];

  @ApiPropertyOptional({ enum: ["discord", "telegram", "webhook"] })
  @IsOptional()
  @IsIn(["discord", "telegram", "webhook"])
  channel?: string;

  @ApiPropertyOptional({ enum: ["urgent", "standard", "digest"] })
  @IsOptional()
  @IsIn(["urgent", "standard", "digest"])
  notificationType?: "urgent" | "standard" | "digest";

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  createdAfter?: string;

  @ApiPropertyOptional({ format: "date-time" })
  @IsOptional()
  @IsISO8601({ strict: true })
  createdBefore?: string;
}

export class UpdateMatchStatusDto {
  @ApiProperty({ enum: WATCH_MATCH_STATUSES })
  @IsIn(WATCH_MATCH_STATUSES)
  status!: (typeof WATCH_MATCH_STATUSES)[number];
}

export class DiscordNotificationTestDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  watchId!: string;

  @ApiPropertyOptional({
    enum: ["default", "DISCORD_WEBHOOK_URL"],
    default: "default",
  })
  @IsOptional()
  @IsIn(["default", "DISCORD_WEBHOOK_URL"])
  destinationRef?: "default" | "DISCORD_WEBHOOK_URL";
}

export class CompanyCoverageSummaryDto {
  @ApiProperty({ example: 26 })
  configured!: number;

  @ApiProperty({ example: 21 })
  active!: number;

  @ApiProperty({ example: 0 })
  disabled!: number;

  @ApiProperty({ example: 5 })
  uncovered!: number;

  @ApiProperty({ example: 16 })
  initialized!: number;

  @ApiProperty({ example: 1 })
  degraded!: number;
}

export class CompanyCoverageCompanyDto {
  @ApiProperty({ example: "Uber" })
  company!: string;

  @ApiProperty({ enum: ["active", "disabled", "uncovered"] })
  status!: "active" | "disabled" | "uncovered";

  @ApiProperty({ type: [String], example: ["uber"] })
  targetKeys!: string[];

  @ApiProperty({ example: false })
  initialized!: boolean;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  lastAttemptAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  lastSuccessAt!: Date | null;

  @ApiProperty({ type: String, format: "date-time", nullable: true })
  lastNonEmptyAt!: Date | null;

  @ApiProperty({ example: 0 })
  consecutiveHardFailures!: number;

  @ApiProperty({ example: false })
  degraded!: boolean;
}

export class CompanyCoverageReportDto {
  @ApiProperty({ format: "uuid" })
  watchId!: string;

  @ApiProperty({ type: () => CompanyCoverageSummaryDto })
  summary!: CompanyCoverageSummaryDto;

  @ApiProperty({ type: () => [CompanyCoverageCompanyDto] })
  companies!: CompanyCoverageCompanyDto[];
}
