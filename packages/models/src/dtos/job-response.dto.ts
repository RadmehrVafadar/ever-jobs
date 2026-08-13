import { JobPostDto } from './job-post.dto';

export class JobResponseDto {
  jobs: JobPostDto[];
  /**
   * Optional count advertised by the official upstream board before the
   * adapter's result cap, normalization, or post-fetch filtering is applied.
   */
  advertisedCount?: number | null;

  constructor(
    jobs: JobPostDto[] = [],
    metadata: { advertisedCount?: number | null } = {},
  ) {
    this.jobs = jobs;
    if (metadata.advertisedCount !== undefined) {
      this.advertisedCount = metadata.advertisedCount;
    }
  }
}
