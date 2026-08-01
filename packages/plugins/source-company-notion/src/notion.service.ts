import { SourcePlugin, PluginRegistry } from '@ever-jobs/plugin';

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  IScraper, ScraperInputDto, JobResponseDto, Site,
} from '@ever-jobs/models';

/**
 * Notion — Connected workspace combining notes, docs, wikis, databases, and project management.
 *
 * Notion is a productivity software company that builds a single connected
 * workspace for notes, documents, wikis, databases, and project and task
 * management. It also offers Notion AI and Notion Calendar within the same
 * product suite. The company is headquartered in San Francisco.
 *
 * Sector: Productivity & collaboration software. HQ: San Francisco, California, USA.
 *
 * Source: Ashby job board, company slug `notion`
 * (`https://jobs.ashbyhq.com/notion`). The company's live
 * postings are served by Ashby. Rather than re-implement Ashby parsing (and
 * risk drift), this plugin resolves the registered Ashby source plugin from
 * the `PluginRegistry` at runtime and delegates the fetch + field mapping to
 * it, then re-stamps the company identity (site, companyName, id prefix) onto
 * the results — so every Ashby field fix is inherited automatically. This
 * honours the "no plugin imports a peer plugin directly; discover via the
 * registry" rule.
 */
const COMPANY_SLUG = 'notion';
const COMPANY_NAME = 'Notion';

@SourcePlugin({
  site: Site.NOTION,
  name: COMPANY_NAME,
  category: 'company',
  watchMode: 'board',
})
@Injectable()
export class NotionService implements IScraper {
  private readonly logger = new Logger(NotionService.name);

  constructor(
    @Optional() private readonly registry?: PluginRegistry,
  ) {}

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    if (!this.registry) {
      const message =
        'Notion source requires PluginRegistry injection to resolve Ashby';
      this.logger.error(message);
      throw new Error(message);
    }

    const ashby = this.registry.getScraper(Site.ASHBY);
    if (!ashby) {
      const message =
        'Notion source requires the Ashby source plugin to be registered';
      this.logger.error(message);
      throw new Error(message);
    }

    this.logger.log(
      `Notion: delegating to Ashby (slug ${COMPANY_SLUG})`,
    );

    const result = await ashby.scrape({
      ...input,
      companySlug: COMPANY_SLUG,
    } as ScraperInputDto);

    for (const job of result.jobs) {
      job.site = Site.NOTION;
      job.companyName = COMPANY_NAME;
      const delegatedId = job.id?.trim();
      if (!delegatedId) {
        throw new Error('Notion received an Ashby job without a stable ID');
      }
      job.id = `notion-${delegatedId.replace(/^(?:ashby|notion)-/, '')}`;
    }

    this.logger.log(`Notion: scraped ${result.jobs.length} jobs`);
    return result;
  }
}
