import { SourcePlugin, PluginRegistry } from '@ever-jobs/plugin';

import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  IScraper, ScraperInputDto, JobResponseDto, Site,
} from '@ever-jobs/models';

/**
 * Ramp — A finance automation platform offering corporate cards, expense management, bill pay, and treasury tools.
 *
 * Ramp is a financial operations platform that provides corporate cards,
 * expense management, bill payment, procurement, and treasury products for
 * businesses. The company automates finance workflows to help teams control
 * spend. Ramp is backed by investors including Founders Fund, Thrive
 * Capital, and Sequoia.
 *
 * Sector: Fintech - Spend management & payments. HQ: New York, New York, USA.
 *
 * Source: Ashby job board, company slug `ramp`
 * (`https://jobs.ashbyhq.com/ramp`). The company's live
 * postings are served by Ashby. Rather than re-implement Ashby parsing (and
 * risk drift), this plugin resolves the registered Ashby source plugin from
 * the `PluginRegistry` at runtime and delegates the fetch + field mapping to
 * it, then re-stamps the company identity (site, companyName, id prefix) onto
 * the results — so every Ashby field fix is inherited automatically. This
 * honours the "no plugin imports a peer plugin directly; discover via the
 * registry" rule.
 */
const COMPANY_SLUG = 'ramp';
const COMPANY_NAME = 'Ramp';

@SourcePlugin({
  site: Site.RAMP,
  name: COMPANY_NAME,
  category: 'company',
  watchMode: 'board',
})
@Injectable()
export class RampService implements IScraper {
  private readonly logger = new Logger(RampService.name);

  constructor(
    @Optional() private readonly registry?: PluginRegistry,
  ) {}

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    if (!this.registry) {
      const message =
        'Ramp source requires PluginRegistry injection to resolve Ashby';
      this.logger.error(message);
      throw new Error(message);
    }

    const ashby = this.registry.getScraper(Site.ASHBY);
    if (!ashby) {
      const message =
        'Ramp source requires the Ashby source plugin to be registered';
      this.logger.error(message);
      throw new Error(message);
    }

    this.logger.log(
      `Ramp: delegating to Ashby (slug ${COMPANY_SLUG})`,
    );

    const result = await ashby.scrape({
      ...input,
      companySlug: COMPANY_SLUG,
    } as ScraperInputDto);

    for (const job of result.jobs) {
      job.site = Site.RAMP;
      job.companyName = COMPANY_NAME;
      const delegatedId = job.id?.trim();
      if (!delegatedId) {
        throw new Error('Ramp received an Ashby job without a stable ID');
      }
      job.id = `ramp-${delegatedId.replace(/^(?:ashby|ramp)-/, '')}`;
    }

    this.logger.log(`Ramp: scraped ${result.jobs.length} jobs`);
    return result;
  }
}
