import { JobPostDto } from '@ever-jobs/models';
import { JobFingerprintService } from '../services/job-fingerprint.service';
import { JobScoringService } from '../services/job-scoring.service';
import { defaultInternshipWatch } from '../services/default-watch';
import { InMemoryWatchRepository } from '../persistence/in-memory-watch.repository';
import { DailyDigestService } from '../services/daily-digest.service';

describe('watcher primitives', () => {
  const fp = new JobFingerprintService();
  it('canonicalizes tracking URLs and keeps fingerprint stable', () => {
    const a = new JobPostDto({ site: 'greenhouse', id: '123', title: 'Software Developer Intern', companyName: 'Google', jobUrl: 'https://boards.greenhouse.io/x/jobs/123?utm_source=li' });
    const b = new JobPostDto({ site: ' GREENHOUSE ', id: '123', title: 'Other', companyName: 'Other', jobUrl: 'https://boards.greenhouse.io/x/jobs/123' });
    expect(fp.fingerprint(a)).toBe(fp.fingerprint(b));
    expect(fp.canonicalizeUrl(a.jobUrl)).toBe('https://boards.greenhouse.io/x/jobs/123');
  });
  it('distinguishes distinct canonical jobs without external ids', () => {
    const a = new JobPostDto({ site: 'lever', title: 'Backend Engineer Intern', companyName: 'Stripe', jobUrl: 'https://jobs.lever.co/stripe/a' });
    const b = new JobPostDto({ site: 'lever', title: 'Backend Engineer Intern', companyName: 'Stripe', jobUrl: 'https://jobs.lever.co/stripe/b' });
    expect(fp.fingerprint(a)).not.toBe(fp.fingerprint(b));
  });
  it('hashes normalized descriptions', () => { expect(fp.descriptionHash('Hello   World')).toBe(fp.descriptionHash(' hello world ')); });
  it('scores a Toronto software internship as urgent with explainable buckets', () => {
    const watch = defaultInternshipWatch() as any;
    const score = new JobScoringService().score(new JobPostDto({ site: 'source-company-google', title: 'Software Developer Intern', companyName: 'Google', description: 'Python distributed systems on Google Cloud Platform with Kubernetes and SQL', location: { city: 'Toronto', state: 'Ontario', country: 'Canada' } as any, workFromHomeType: 'Hybrid' }), watch);
    expect(score.total).toBeGreaterThanOrEqual(80); expect(score.matchedKeywords).toContain('software internship'); expect(score.location).toBeGreaterThan(0);
  });
  it('contextually excludes senior title matches', () => {
    const watch = defaultInternshipWatch() as any;
    const score = new JobScoringService().score(new JobPostDto({ title: 'Senior Software Engineer', companyName: 'Meta', description: 'mentor interns', location: { city: 'Toronto' } as any }), watch);
    expect(score.exclusionReason).toBe('Excluded seniority in title');
  });
  it('selects digest matches between digest and immediate thresholds', async () => {
    const repo = new InMemoryWatchRepository(); const watch = await repo.createWatch(defaultInternshipWatch());
    const job = (await repo.upsertObservedJob({ fingerprint: 'f', source: 'fake', title: 't', normalizedTitle: 't', firstSeenAt: new Date(), lastSeenAt: new Date() })).job;
    await repo.upsertMatch({ watchId: watch.id, observedJobId: job.id, score: 50, scoreBreakdown: { total: 50, role: 0, internship: 0, location: 0, company: 0, source: 0, skills: 0, matchedKeywords: [], missingRequired: [], reasons: [] }, matchedTerms: [], status: 'new', firstMatchedAt: new Date(), lastMatchedAt: new Date(), notificationState: 'pending' });
    await expect(new DailyDigestService(repo).selectDigestMatches(watch.id, 40, 60)).resolves.toHaveLength(1);
  });
});
