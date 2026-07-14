import { Injectable, Optional } from '@nestjs/common';
import { Country, DescriptionFormat, ScraperInputDto, Site } from '@ever-jobs/models';
import { JobWatch, WatchSourceExecutor } from '../interfaces/watch.types';
interface SearchJobsService { searchJobs(input: ScraperInputDto): Promise<any[]>; }
@Injectable()
export class JobsServiceWatchExecutor implements WatchSourceExecutor { constructor(@Optional() private readonly jobs?: SearchJobsService) {} async search(input: { watch: JobWatch; searchTerm: string; sources: string[] }) { if (!this.jobs) return []; return this.jobs.searchJobs(new ScraperInputDto({ searchTerm: input.searchTerm, googleSearchTerm: input.searchTerm, location: input.watch.locations[0] ?? 'Canada', siteType: input.sources as Site[], resultsWanted: 25, country: Country.CANADA, descriptionFormat: DescriptionFormat.MARKDOWN })); } }
