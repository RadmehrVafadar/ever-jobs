import { JobPostDto, JobResponseDto, LocationDto } from '@ever-jobs/models';

import {
  CANADIAN_EMPLOYER_SMOKE_TARGETS,
  employerGroupCount,
  failedSmokeReport,
  isAllowedDirectUrl,
  isGtaJob,
  isSummer2027Job,
  isTechnologyAdjacentRole,
  matchedRoleFamilies,
  runCanadianEmployerSmoke,
  summarizeSmokeResponse,
} from '../smoke-canadian-employers';

describe('Canadian employer live-smoke helpers', () => {
  it('covers exactly 20 employer groups through 22 official endpoints', () => {
    expect(CANADIAN_EMPLOYER_SMOKE_TARGETS).toHaveLength(22);
    expect(employerGroupCount()).toBe(20);
    expect(
      [...new Set(CANADIAN_EMPLOYER_SMOKE_TARGETS.map(({ employer }) => employer))].sort(),
    ).toEqual(
      [
        'Accenture Canada',
        'Aritzia',
        'BMO',
        'Bell',
        'CIBC',
        'Canada Goose',
        'Canadian Tire',
        'Deloitte Canada',
        'EY Canada',
        'Intact',
        'KPMG',
        'Loblaw',
        'Manulife',
        'PwC',
        'RBC',
        'Rogers',
        'Scotiabank',
        'Sun Life',
        'TD',
        'TELUS',
      ].sort(),
    );
    expect(
      CANADIAN_EMPLOYER_SMOKE_TARGETS.filter(({ employer }) => employer === 'Loblaw'),
    ).toHaveLength(3);
  });

  it('pins the 14 verified Workday board slugs', () => {
    expect(
      CANADIAN_EMPLOYER_SMOKE_TARGETS.filter(
        ({ adapter }) => adapter === 'workday',
      ).map(({ companySlug }) => companySlug),
    ).toEqual([
      'rbc:3:RBCEARLYTALENT1',
      'td:3:TD_Bank_Careers',
      'bmo:3:Campus',
      'cibc:3:campus',
      'pwc:3:Global_Campus_Careers',
      'aritzia:3:Calling_New_Graduates',
      'myview:3:loblaw_careers',
      'myview:3:pc_financial',
      'myview:3:sdm_careers',
      'canadiantirecorporation:3:Enterprise_External_Careers_Site',
      'canadagoose:3:CanadaGooseCareers',
      'manulife:3:MFCJH_Jobs',
      'sunlife:3:Campus',
      'intactfc:3:intactfc',
    ]);
  });

  it('pins vanity-domain company slugs to the preset target identities', () => {
    expect(
      Object.fromEntries(
        CANADIAN_EMPLOYER_SMOKE_TARGETS.filter(
          ({ adapter }) => adapter === 'successfactors',
        ).map(({ employer, companySlug }) => [employer, companySlug]),
      ),
    ).toEqual({
      Scotiabank: 'scotiabank',
      'Deloitte Canada': 'deloitte-ca',
      Bell: 'bell-ca',
      Rogers: 'rogers-ca',
      TELUS: 'telus-ca',
    });
  });

  it('uses unique target ids and complete direct-host allowlists', () => {
    const ids = CANADIAN_EMPLOYER_SMOKE_TARGETS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const target of CANADIAN_EMPLOYER_SMOKE_TARGETS) {
      expect(target.allowedDirectHosts.length).toBeGreaterThan(0);
      expect(target.allowedDirectHosts.every(Boolean)).toBe(true);
    }
  });

  it('recognizes strict GTA and Summer 2027 evidence', () => {
    const eligible = new JobPostDto({
      title: 'Technology Risk Co-op - Summer 2027',
      jobUrl: 'https://example.com/job/1',
      location: new LocationDto({ city: 'Richmond Hill', state: 'Ontario' }),
    });
    const wrongCity = new JobPostDto({
      title: 'Software Intern - Summer 2027',
      jobUrl: 'https://example.com/job/2',
      location: new LocationDto({ city: 'Waterloo', state: 'Ontario' }),
    });
    const dateRange = new JobPostDto({
      title: 'QA Co-op',
      description: 'Placement runs May 2027 through August 2027.',
      jobUrl: 'https://example.com/job/3',
      locations: [new LocationDto({ city: 'Toronto', state: 'ON' })],
    });

    expect(isGtaJob(eligible)).toBe(true);
    expect(isSummer2027Job(eligible)).toBe(true);
    expect(isGtaJob(wrongCity)).toBe(false);
    expect(isSummer2027Job(dateRange)).toBe(true);
    expect(isGtaJob(dateRange)).toBe(true);
  });

  it('requires HTTPS and an employer-owned allowlisted host', () => {
    expect(
      isAllowedDirectUrl(
        'https://rbc.wd3.myworkdayjobs.com/en-US/RBCEARLYTALENT1/job/1',
        ['rbc.wd3.myworkdayjobs.com'],
      ),
    ).toBe(true);
    expect(
      isAllowedDirectUrl('https://evil.example/rbc/job/1', [
        'rbc.wd3.myworkdayjobs.com',
      ]),
    ).toBe(false);
    expect(
      isAllowedDirectUrl('http://rbc.wd3.myworkdayjobs.com/job/1', [
        'rbc.wd3.myworkdayjobs.com',
      ]),
    ).toBe(false);
    expect(
      isAllowedDirectUrl(
        'https://accenture.wd103.myworkdayjobs.com/AccentureCareers/job/1',
        [
          'accenture.com',
          'accenture.wd*.myworkdayjobs.com',
          'teamcomtech.hua.hrsmart.com',
        ],
      ),
    ).toBe(true);
    expect(
      isAllowedDirectUrl(
        'https://teamcomtech.hua.hrsmart.com/hr/ats/JobSeeker/applyTo/1681',
        [
          'accenture.com',
          'accenture.wd*.myworkdayjobs.com',
          'teamcomtech.hua.hrsmart.com',
        ],
      ),
    ).toBe(true);
    expect(
      isAllowedDirectUrl(
        'https://not-accenture.wd103.myworkdayjobs.com/job/1',
        ['accenture.com', 'accenture.wd*.myworkdayjobs.com'],
      ),
    ).toBe(false);
  });

  it('recognizes every Spec 6004 technology role family', () => {
    const cases = [
      ['Software Engineering Intern', 'software-engineering'],
      ['Data Analyst Intern', 'data-ai'],
      ['Cybersecurity Intern', 'cybersecurity'],
      ['Cloud Platform Intern', 'cloud-platform-infrastructure'],
      ['QA Automation Co-op', 'qa-automation'],
      ['Technical Product Manager Intern', 'technical-product'],
      ['UX Product Designer Intern', 'ux-product-design'],
      ['Business Systems Analyst Co-op', 'systems-business-analysis'],
      ['IT Audit Co-op', 'technology-risk-it-audit'],
    ] as const;

    for (const [title, family] of cases) {
      const job = new JobPostDto({ title, jobUrl: 'https://example.com/job' });
      expect(matchedRoleFamilies(job)).toContain(family);
      expect(isTechnologyAdjacentRole(job)).toBe(true);
    }
  });

  it('guards generic product/business titles and non-technical programs', () => {
    const job = (title: string, description: string) =>
      new JobPostDto({ title, description, jobUrl: 'https://example.com/job' });

    expect(
      matchedRoleFamilies(
        job('Product Manager Intern', 'Support seasonal fashion assortment.'),
      ),
    ).toEqual([]);
    expect(
      matchedRoleFamilies(
        job('Product Manager Intern', 'Build a digital software platform.'),
      ),
    ).toContain('technical-product');
    expect(
      matchedRoleFamilies(
        job('Business Analyst Co-op', 'Prepare financial reporting packages.'),
      ),
    ).toEqual([]);
    expect(
      matchedRoleFamilies(
        job('Business Analyst Co-op', 'Improve digital systems and automation.'),
      ),
    ).toContain('systems-business-analysis');
    expect(
      isTechnologyAdjacentRole(
        job('Marketing Intern - Data Analytics', 'Plan campaigns.'),
      ),
    ).toBe(false);
    expect(
      isTechnologyAdjacentRole(
        job('Technology Risk Office Tour', 'Student recruiting event.'),
      ),
    ).toBe(false);
  });

  it('summarizes parsed, GTA, season, and direct URL counts honestly', () => {
    const target = CANADIAN_EMPLOYER_SMOKE_TARGETS[0];
    const response = new JobResponseDto([
      new JobPostDto({
        title: 'Software Engineering Intern, Summer 2027',
        jobUrl: 'https://rbc.wd3.myworkdayjobs.com/job/1',
        location: new LocationDto({ city: 'Toronto', state: 'Ontario' }),
      }),
      new JobPostDto({
        title: 'Software Engineering Intern, Fall 2027',
        jobUrl: 'https://not-rbc.example/job/2',
        location: new LocationDto({ city: 'Waterloo', state: 'Ontario' }),
      }),
    ]);
    (response as JobResponseDto & { totalResults: number }).totalResults = 91;

    expect(summarizeSmokeResponse(target, response, 12)).toEqual(
      expect.objectContaining({
        status: 'fail',
        officialResultCount: 91,
        parsedCount: 2,
        gtaCount: 1,
        summer2027Count: 1,
        roleMatchCount: 2,
        gtaSummer2027Count: 1,
        gtaSummer2027RoleMatchCount: 1,
        directUrlCount: 2,
        invalidDirectUrlCount: 1,
        durationMs: 12,
      }),
    );
  });

  it('reports an authoritative empty board separately', () => {
    const report = summarizeSmokeResponse(
      CANADIAN_EMPLOYER_SMOKE_TARGETS[0],
      new JobResponseDto([], { advertisedCount: 0 }),
      3,
    );
    expect(report.status).toBe('empty');
    expect(report.officialResultCount).toBe(0);
  });

  it('fails an empty response when the source does not advertise zero results', () => {
    const report = summarizeSmokeResponse(
      CANADIAN_EMPLOYER_SMOKE_TARGETS[0],
      new JobResponseDto([]),
      3,
    );
    expect(report).toMatchObject({
      status: 'fail',
      officialResultCount: null,
      error: 'Source returned no jobs without an authoritative zero result count',
    });
  });

  it('continues after a source failure and preserves an actionable error', async () => {
    const targets = CANADIAN_EMPLOYER_SMOKE_TARGETS.slice(0, 2);
    const reports = await runCanadianEmployerSmoke(targets, async (target) => {
      if (target.id === targets[0].id) throw new Error('parser drift');
      return new JobResponseDto([], { advertisedCount: 0 });
    });

    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ status: 'fail', error: 'parser drift' });
    expect(reports[1]).toMatchObject({ status: 'empty' });
    expect(failedSmokeReport(targets[0], 'blocked', 5)).toMatchObject({
      status: 'fail',
      error: 'blocked',
      durationMs: 5,
    });
  });
});
