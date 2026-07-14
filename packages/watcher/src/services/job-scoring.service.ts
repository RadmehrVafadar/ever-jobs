import { Injectable } from '@nestjs/common';
import { JobPostDto } from '@ever-jobs/models';
import { JobWatch, ScoreBreakdown } from '../interfaces/watch.types';

@Injectable()
export class JobScoringService {
  score(job: JobPostDto, watch: JobWatch): ScoreBreakdown {
    const title = (job.title ?? '').toLowerCase(); const desc = (job.description ?? '').toLowerCase(); const company = (job.companyName ?? '').toLowerCase();
    const loc = [typeof job.location === 'string' ? job.location : job.location?.city, typeof job.location === 'string' ? '' : job.location?.state, typeof job.location === 'string' ? '' : job.location?.country, job.workFromHomeType].filter(Boolean).join(' ').toLowerCase();
    const text = `${title} ${desc} ${company} ${loc}`; const reasons: string[] = []; const matched = new Set<string>(); const missingRequired: string[] = [];
    const hardExclusion = this.exclusionReason(title, desc, loc, watch.excludedTerms); if (hardExclusion) return { total: 0, role: 0, internship: 0, location: 0, company: 0, source: 0, skills: 0, matchedKeywords: [], missingRequired: [], exclusionReason: hardExclusion, reasons: [] };
    let role = 0; if (/software (engineer|developer).*(intern|co-?op|student)|(?:intern|co-?op).*software (engineer|developer)/.test(title)) { role += 30; reasons.push('Exact software internship title match'); matched.add('software internship'); }
    if (/software (engineering|engineer|development|developer)/.test(text)) { role += 20; matched.add('software engineering'); }
    if (/(backend|platform|infrastructure|cloud|security|devops|site reliability|\bsre\b)/.test(text)) { role += 15; matched.add('target engineering specialty'); }
    if (/full[- ]?stack/.test(text)) role += 10; if (/(machine learning|data engineer)/.test(text)) role += 8;
    let internship = 0; if (/(internship|\bintern\b|co-?op|student|university|campus|early career)/.test(text)) { internship += 25; matched.add('internship indicator'); } else missingRequired.push('internship indicator');
    let location = 0; if (/toronto/.test(loc)) location += 25; else if (/gta|greater toronto/.test(loc)) location += 25; else if (/ontario/.test(loc)) location += 18; else if (/remote.*canada|canada.*remote/.test(loc)) location += 20; else if (/canada/.test(loc)) location += 12; if (/hybrid.*toronto|toronto.*hybrid|on-site.*toronto|toronto.*on-site/.test(loc)) location += 5;
    let companyScore = 0; if (/(google|amazon|meta)/.test(company)) companyScore += 25; else if (/(shopify|wealthsimple|microsoft|apple|nvidia|stripe|openai)/.test(company)) companyScore += 20; else if (watch.companies.some((c) => company.includes(c.toLowerCase()))) companyScore += 10;
    const source = /source-company|greenhouse|lever|ashby|workday|smartrecruiters|google|amazon|meta|shopify|wealthsimple/.test(String(job.site).toLowerCase()) ? 10 : 0;
    const skillPatterns: Array<[RegExp, number, string]> = [[/\bpython\b/,8,'Python'],[/\bjava\b/,8,'Java'],[/\bgo(lang)?\b/,8,'Go'],[/typescript/,6,'TypeScript'],[/\bc\+\+\b|\bc\b/,5,'C/C++'],[/docker/,7,'Docker'],[/kubernetes/,7,'Kubernetes'],[/terraform/,7,'Terraform'],[/\bgcp\b|google cloud|\bcloud\b/,7,'Cloud'],[/kafka/,8,'Kafka'],[/postgresql|\bsql\b/,5,'SQL'],[/distributed systems/,10,'Distributed systems'],[/\biam\b|auth0|authorization|rbac|identity/,10,'Identity'],[/security/,8,'Security'],[/react|next\.js/,4,'React/Next.js']];
    let skills = 0; for (const [re, pts, label] of skillPatterns) if (re.test(text)) { skills += pts; matched.add(label); }
    skills = Math.min(skills, 45); const total = role + internship + location + companyScore + source + skills;
    return { total, role, internship, location, company: companyScore, source, skills, matchedKeywords: [...matched], missingRequired, reasons };
  }
  private exclusionReason(title: string, desc: string, loc: string, terms: string[]): string | undefined { const seniorTitle = /\b(senior|staff|principal|manager|director|architect)\b/.test(title); if (seniorTitle) return 'Excluded seniority in title'; if (/\b(5\+|7\+|10\+) years\b/.test(`${title} ${desc}`)) return 'Excluded experience requirement'; if (/united states only|us only|usa only|must reside in the united states|no canadian applicants/.test(loc + ' ' + desc)) return 'Excluded location restriction'; for (const term of terms) if (term && `${title} ${loc}`.includes(term.toLowerCase())) return `Excluded term: ${term}`; return undefined; }
}
