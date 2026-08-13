import { Type } from "class-transformer";
import { IsInt, IsOptional, Max, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { ScraperInputDto } from "@ever-jobs/models";

/**
 * Search criteria for a side-by-side source comparison.
 *
 * `siteType` is inherited from {@link ScraperInputDto}. When it is omitted,
 * every source currently registered with the API is compared.
 */
export class CompareJobsDto extends ScraperInputDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 10,
    description:
      "Requested source concurrency. The server configured limit remains the hard cap.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  concurrency?: number;
}
