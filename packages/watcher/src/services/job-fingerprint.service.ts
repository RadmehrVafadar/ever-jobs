import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { JobPostDto } from '@ever-jobs/models';

@Injectable()
export class JobFingerprintService {
  normalizeText(value?: string | null): string { return (value ?? '').trim().toLowerCase().replace(/[\u2010-\u2015]/g, '-').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' '); }
  normalizeLocation(value?: string | null): string { const t = this.normalizeText(value).replace(/greater toronto area/g, 'gta').replace(/toronto, on/g, 'toronto ontario').replace(/remote within canada/g, 'remote canada'); return t; }
  canonicalizeUrl(value?: string | null): string { if (!value) return ''; try { const url = new URL(value); url.hostname = url.hostname.toLowerCase(); ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gh_src','lever-source','source'].forEach((k) => url.searchParams.delete(k)); url.hash = ''; const rendered = url.toString(); return rendered.endsWith('/') ? rendered.slice(0, -1) : rendered; } catch { return this.normalizeText(value).replace(/\/+$/, ''); } }
  hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
  descriptionHash(description?: string | null): string | null { const normalized = this.normalizeText(description); return normalized ? this.hash(normalized) : null; }
  fingerprint(job: JobPostDto): string { const source = this.normalizeText(job.site ?? 'unknown'); const externalId = this.normalizeText(job.id ?? job.atsId ?? null); if (externalId) return this.hash(['external', source, externalId].join('|')); const loc = typeof job.location === 'string' ? job.location : [job.location?.city, job.location?.state, job.location?.country].filter(Boolean).join(' '); const identity = ['canonical', source, this.normalizeText(job.companyName), this.normalizeText(job.title), this.normalizeLocation(loc), this.canonicalizeUrl(job.applyUrl ?? job.jobUrlDirect ?? job.jobUrl)].join('|'); return this.hash(identity); }
}
