import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Check,
  Download,
  FileJson,
  MapPin,
  Search,
  Sparkles,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { api } from "../api/client";
import {
  Badge,
  Button,
  EmptyState,
  ErrorText,
  Field,
  InlineNotice,
  Modal,
  PageHeader,
  Panel,
  PanelHeader,
  Pagination,
  StatusBadge,
  Tabs,
  Toggle,
} from "../components/ui";
import { downloadJson, downloadText, jobsToCsv } from "../lib/download";
import { formatDate, locationLabel, sentenceCase } from "../lib/format";
import { JobPost, SearchInput } from "../types";

const DEFAULT_INPUT: SearchInput = {
  siteType: [],
  searchTerm: "software engineer",
  location: "Toronto, Ontario",
  country: "CANADA",
  distance: 50,
  isRemote: false,
  resultsWanted: 25,
  hoursOld: 168,
  descriptionFormat: "markdown",
  requestTimeout: 60,
};

export function SearchPage() {
  const [input, setInput] = useState<SearchInput>(DEFAULT_INPUT);
  const [dedup, setDedup] = useState(true);
  const [liveness, setLiveness] = useState(false);
  const [legitimacy, setLegitimacy] = useState(false);
  const [resultTab, setResultTab] = useState<
    "results" | "analysis" | "companies"
  >("results");
  const [jsonOpen, setJsonOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobPost>();
  const [jobOffset, setJobOffset] = useState(0);
  const sources = useQuery({
    queryKey: ["source-health"],
    queryFn: ({ signal }) => api.sources.health(signal),
  });
  const search = useMutation({
    mutationFn: () =>
      api.jobs.search(cleanInput(input), { dedup, liveness, legitimacy }),
    onSuccess: () => {
      setResultTab("results");
      setJobOffset(0);
    },
  });
  const analysis = useMutation({
    mutationFn: () => api.jobs.analyze(cleanInput(input)),
    onSuccess: () => setResultTab("analysis"),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    search.mutate();
  };
  const jobs = search.data?.jobs ?? [];

  return (
    <div className="page page--search">
      <PageHeader
        eyebrow="Live source query"
        title="Search & analyze"
        description="Use the same scraper input as the CLI, with browser-native results, company intelligence, and downloads."
        actions={
          <Button variant="secondary" onClick={() => setJsonOpen(true)}>
            <FileJson size={16} />
            Import JSON
          </Button>
        }
      />
      <div className="search-layout">
        <Panel className="search-form-panel">
          <PanelHeader
            title="Search criteria"
            description="Selected sources run through the existing bounded-concurrency API."
          />
          <form className="form-stack" onSubmit={submit}>
            <Field label="What role are you looking for?">
              <div className="input-with-icon">
                <Search size={17} />
                <input
                  autoFocus
                  value={input.searchTerm ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, searchTerm: event.target.value })
                  }
                  placeholder="software engineer intern"
                />
              </div>
            </Field>
            <Field label="Location">
              <div className="input-with-icon">
                <MapPin size={17} />
                <input
                  value={input.location ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, location: event.target.value })
                  }
                  placeholder="Toronto, Ontario"
                />
              </div>
            </Field>
            <SourcePicker
              sources={sources.data?.sources.map(({ site }) => site) ?? []}
              selected={input.siteType ?? []}
              onChange={(siteType) => setInput({ ...input, siteType })}
            />
            <div className="form-grid form-grid--two">
              <Field label="Country">
                <select
                  value={input.country ?? "USA"}
                  onChange={(event) =>
                    setInput({ ...input, country: event.target.value })
                  }
                >
                  {[
                    "USA",
                    "CANADA",
                    "US_CANADA",
                    "WORLDWIDE",
                    "UK",
                    "AUSTRALIA",
                    "GERMANY",
                    "FRANCE",
                    "INDIA",
                    "NETHERLANDS",
                  ].map((country) => (
                    <option value={country} key={country}>
                      {sentenceCase(country)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Job type">
                <select
                  value={input.jobType ?? ""}
                  onChange={(event) =>
                    setInput({
                      ...input,
                      jobType: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">Any type</option>
                  {[
                    "fulltime",
                    "parttime",
                    "internship",
                    "contract",
                    "temporary",
                    "summer",
                    "volunteer",
                  ].map((type) => (
                    <option value={type} key={type}>
                      {sentenceCase(type)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Results per source">
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={input.resultsWanted ?? 15}
                  onChange={(event) =>
                    setInput({
                      ...input,
                      resultsWanted: Number(event.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Maximum listing age">
                <div className="input-suffix">
                  <input
                    type="number"
                    min={1}
                    value={input.hoursOld ?? ""}
                    placeholder="Any"
                    onChange={(event) =>
                      setInput({
                        ...input,
                        hoursOld: event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      })
                    }
                  />
                  <span>hours</span>
                </div>
              </Field>
            </div>
            <details className="advanced-fields">
              <summary>Advanced options</summary>
              <div className="form-stack">
                <div className="form-grid form-grid--two">
                  <Field
                    label="Company slug"
                    hint="For ATS sources such as Ashby or Greenhouse."
                  >
                    <input
                      value={input.companySlug ?? ""}
                      onChange={(event) =>
                        setInput({
                          ...input,
                          companySlug: event.target.value || undefined,
                        })
                      }
                    />
                  </Field>
                  <Field label="Search radius">
                    <div className="input-suffix">
                      <input
                        type="number"
                        min={0}
                        value={input.distance ?? 50}
                        onChange={(event) =>
                          setInput({
                            ...input,
                            distance: Number(event.target.value),
                          })
                        }
                      />
                      <span>miles</span>
                    </div>
                  </Field>
                </div>
                <Toggle
                  checked={Boolean(input.isRemote)}
                  onChange={(isRemote) => setInput({ ...input, isRemote })}
                  label="Remote jobs only"
                />
                <Toggle
                  checked={Boolean(input.easyApply)}
                  onChange={(easyApply) => setInput({ ...input, easyApply })}
                  label="Easy apply only"
                />
                <Toggle
                  checked={dedup}
                  onChange={setDedup}
                  label="Cross-source deduplication"
                  description="Collapse identical and near-duplicate postings."
                />
                <Toggle
                  checked={liveness}
                  onChange={setLiveness}
                  label="Check listing liveness"
                  description="Adds external probes and may take longer."
                />
                <Toggle
                  checked={legitimacy}
                  onChange={setLegitimacy}
                  label="Evaluate legitimacy"
                  description="Add corpus-based confidence signals."
                />
              </div>
            </details>
            <ErrorText error={search.error ?? analysis.error} />
            <div className="search-form__actions">
              <Button type="submit" loading={search.isPending}>
                <Search size={16} />
                Search sources
              </Button>
              <Button
                type="button"
                variant="secondary"
                loading={analysis.isPending}
                onClick={() => analysis.mutate()}
              >
                <Sparkles size={16} />
                Analyze market
              </Button>
            </div>
          </form>
        </Panel>

        <section className="search-results">
          {!search.data &&
          !analysis.data &&
          !search.isPending &&
          !analysis.isPending ? (
            <div className="search-welcome">
              <span>
                <Search size={26} />
              </span>
              <h2>Search the rad.ar source registry</h2>
              <p>
                Choose one or more sources, or leave the selection empty to
                query every registered plugin.
              </p>
              <div>
                <small>Try</small>
                {[
                  "software engineer intern",
                  "platform engineer",
                  "product designer",
                ].map((term) => (
                  <button
                    key={term}
                    onClick={() => setInput({ ...input, searchTerm: term })}
                  >
                    {term}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {search.isPending || analysis.isPending ? (
            <SearchLoading analysis={analysis.isPending} />
          ) : null}
          {search.data || analysis.data ? (
            <>
              <div className="results-header">
                <div>
                  <p className="eyebrow">Query complete</p>
                  <h2>
                    {search.data
                      ? `${search.data.count} jobs found`
                      : `${analysis.data?.summary.totalJobs ?? 0} jobs analyzed`}
                  </h2>
                  <p>
                    {input.searchTerm || "All roles"} ·{" "}
                    {input.location || "Any location"}
                  </p>
                </div>
                <div>
                  {jobs.length ? (
                    <>
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={() => downloadJson("radar-jobs.json", jobs)}
                      >
                        <Download size={15} />
                        JSON
                      </Button>
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={() =>
                          downloadText(
                            "radar-jobs.csv",
                            jobsToCsv(jobs),
                            "text/csv",
                          )
                        }
                      >
                        <Download size={15} />
                        CSV
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="editor-tabs-wrap">
                <Tabs
                  value={resultTab}
                  onChange={(value) => setResultTab(value as typeof resultTab)}
                  tabs={[
                    { value: "results", label: "Jobs", count: jobs.length },
                    { value: "analysis", label: "Analysis" },
                    {
                      value: "companies",
                      label: "Companies",
                      count: analysis.data?.companies.length,
                    },
                  ]}
                />
              </div>
              {resultTab === "results" ? (
                <JobResults
                  jobs={jobs}
                  offset={jobOffset}
                  onOffset={setJobOffset}
                  onSelect={setSelectedJob}
                />
              ) : null}
              {resultTab === "analysis" ? (
                <AnalysisView
                  data={analysis.data}
                  onRun={() => analysis.mutate()}
                  loading={analysis.isPending}
                />
              ) : null}
              {resultTab === "companies" ? (
                <CompanyView
                  companies={analysis.data?.companies ?? []}
                  onRun={() => analysis.mutate()}
                  loading={analysis.isPending}
                />
              ) : null}
            </>
          ) : null}
        </section>
      </div>
      <SearchJsonModal
        open={jsonOpen}
        input={input}
        onClose={() => setJsonOpen(false)}
        onImport={setInput}
      />
      <JobDetailModal
        job={selectedJob}
        onClose={() => setSelectedJob(undefined)}
      />
    </div>
  );
}

function SourcePicker({
  sources,
  selected,
  onChange,
}: {
  sources: string[];
  selected: string[];
  onChange(values: string[]): void;
}) {
  const [filter, setFilter] = useState("");
  const options = useMemo(
    () =>
      sources
        .filter((site) => site.toLowerCase().includes(filter.toLowerCase()))
        .slice(0, 100),
    [sources, filter],
  );
  return (
    <div className="field source-picker">
      <span className="field__label">Sources</span>
      <details>
        <summary>
          <span>
            {selected.length
              ? `${selected.length} selected`
              : "All registered sources"}
          </span>
          <small>Choose sources</small>
        </summary>
        <div className="source-picker__popover">
          <label>
            <Search size={15} />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter sources"
            />
          </label>
          <div>
            {options.map((site) => (
              <label key={site}>
                <input
                  type="checkbox"
                  checked={selected.includes(site)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, site]
                        : selected.filter((value) => value !== site),
                    )
                  }
                />
                <span>{site}</span>
                {selected.includes(site) ? <Check size={14} /> : null}
              </label>
            ))}
          </div>
          <footer>
            <button type="button" onClick={() => onChange([])}>
              Clear · use all
            </button>
            <span>{sources.length} registered</span>
          </footer>
        </div>
      </details>
    </div>
  );
}

function JobResults({
  jobs,
  offset,
  onOffset,
  onSelect,
}: {
  jobs: JobPost[];
  offset: number;
  onOffset(value: number): void;
  onSelect(job: JobPost): void;
}) {
  if (!jobs.length)
    return (
      <Panel>
        <EmptyState
          title="No jobs returned"
          description="Broaden the search, select different sources, or increase the listing age."
        />
      </Panel>
    );
  const limit = 20;
  const visible = jobs.slice(offset, offset + limit);
  return (
    <>
      <div className="search-job-list">
        {visible.map((job, index) => (
          <article
            key={job.id || `${job.site}-${job.jobUrl}-${offset + index}`}
          >
            <header>
              <div className="job-source-mark">
                {(job.site || "?").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <button onClick={() => onSelect(job)}>{job.title}</button>
                <p>{job.companyName || "Company not listed"}</p>
              </div>
              <Badge>{job.site || "unknown"}</Badge>
            </header>
            <div className="job-facts">
              <span>
                <MapPin size={14} />
                {locationLabel(job.location)}
              </span>
              <span>
                <BriefcaseBusiness size={14} />
                {job.jobType?.join(", ") ||
                  job.employmentType ||
                  "Type not listed"}
              </span>
              {job.datePosted ? (
                <span>{formatDate(job.datePosted, { year: "numeric" })}</span>
              ) : null}
            </div>
            <footer>
              {job.compensation?.minAmount ? (
                <strong>{salary(job)}</strong>
              ) : (
                <span>Salary not listed</span>
              )}
              <div>
                {job.isRemote ? <Badge tone="info">Remote</Badge> : null}
                {job.liveness ? (
                  <StatusBadge status={job.liveness.state} />
                ) : null}
                <a
                  href={job.applyUrl || job.jobUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View job <ArrowUpRight size={14} />
                </a>
              </div>
            </footer>
          </article>
        ))}
      </div>
      <Pagination
        offset={offset}
        limit={limit}
        total={jobs.length}
        onChange={onOffset}
      />
    </>
  );
}

function AnalysisView({
  data,
  onRun,
  loading,
}: {
  data?: Awaited<ReturnType<typeof api.jobs.analyze>>;
  onRun(): void;
  loading: boolean;
}) {
  if (!data)
    return (
      <Panel>
        <EmptyState
          title="Analysis not run"
          description="Analyze this query for salary, location, source, and company intelligence."
          action={
            <Button size="small" onClick={onRun} loading={loading}>
              <Sparkles size={15} />
              Run analysis
            </Button>
          }
        />
      </Panel>
    );
  const { summary } = data;
  return (
    <div className="analysis-view">
      <section className="metric-grid metric-grid--four">
        <div className="analysis-metric">
          <strong>{summary.totalJobs}</strong>
          <span>Total jobs</span>
        </div>
        <div className="analysis-metric">
          <strong>{summary.remotePercentage.toFixed(0)}%</strong>
          <span>Remote</span>
        </div>
        <div className="analysis-metric">
          <strong>{summary.withSalaryCount}</strong>
          <span>With salary</span>
        </div>
        <div className="analysis-metric">
          <strong>
            {summary.salaryStats
              ? `${summary.salaryStats.currency} ${Math.round(summary.salaryStats.avgSalary / 1000)}k`
              : "—"}
          </strong>
          <span>Average salary</span>
        </div>
      </section>
      <div className="analysis-grid">
        <Panel>
          <PanelHeader title="Jobs by source" />
          <Distribution data={summary.bySite} />
        </Panel>
        <Panel>
          <PanelHeader title="Jobs by location" />
          <Distribution data={summary.byLocation} />
        </Panel>
        <Panel className="analysis-grid__wide">
          <PanelHeader title="Source comparison" />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Total</th>
                  <th>Remote</th>
                  <th>With salary</th>
                  <th>Companies</th>
                </tr>
              </thead>
              <tbody>
                {data.siteComparison.map((site) => (
                  <tr key={site.site}>
                    <td>
                      <strong>{site.site}</strong>
                    </td>
                    <td>{site.totalJobs}</td>
                    <td>{site.remoteJobs}</td>
                    <td>{site.withSalary}</td>
                    <td>{site.uniqueCompanies}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function CompanyView({
  companies,
  onRun,
  loading,
}: {
  companies: Awaited<ReturnType<typeof api.jobs.analyze>>["companies"];
  onRun(): void;
  loading: boolean;
}) {
  if (!companies.length)
    return (
      <Panel>
        <EmptyState
          title="No company intelligence yet"
          description="Run analysis to group open roles by company."
          action={
            <Button size="small" onClick={onRun} loading={loading}>
              Analyze companies
            </Button>
          }
        />
      </Panel>
    );
  return (
    <div className="company-grid">
      {companies.map((company) => (
        <article key={company.companyName}>
          <header>
            <span>
              <Building2 size={18} />
            </span>
            <div>
              <h3>{company.companyName}</h3>
              <p>
                {company.openPositions} open{" "}
                {company.openPositions === 1 ? "role" : "roles"}
              </p>
            </div>
          </header>
          <dl>
            <div>
              <dt>Locations</dt>
              <dd>
                {company.locations.slice(0, 3).join(" · ") || "Not listed"}
              </dd>
            </div>
            <div>
              <dt>Roles</dt>
              <dd>{company.roles.slice(0, 3).join(" · ")}</dd>
            </div>
          </dl>
          {company.companyUrl ? (
            <a href={company.companyUrl} target="_blank" rel="noreferrer">
              Company site <ArrowUpRight size={14} />
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function Distribution({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 10);
  const max = Math.max(1, ...entries.map(([, value]) => value));
  return (
    <div className="distribution-list">
      {entries.map(([key, value]) => (
        <div key={key}>
          <span>{key}</span>
          <div>
            <span style={{ width: `${(value / max) * 100}%` }} />
          </div>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function SearchJsonModal({
  open,
  input,
  onClose,
  onImport,
}: {
  open: boolean;
  input: SearchInput;
  onClose(): void;
  onImport(value: SearchInput): void;
}) {
  const [content, setContent] = useState(JSON.stringify(input, null, 2));
  const [error, setError] = useState<Error>();
  const apply = () => {
    try {
      const value = JSON.parse(content);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Search JSON must be an object.");
      onImport({ ...DEFAULT_INPUT, ...value });
      setError(undefined);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("Invalid JSON."));
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import search JSON"
      description="Paste the same ScraperInputDto shape used by the CLI’s stdin mode."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>Import query</Button>
        </>
      }
    >
      <textarea
        className="code-editor code-editor--short"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        spellCheck={false}
      />
      <ErrorText error={error} />
    </Modal>
  );
}

function JobDetailModal({ job, onClose }: { job?: JobPost; onClose(): void }) {
  return (
    <Modal
      open={Boolean(job)}
      onClose={onClose}
      width="wide"
      title={job?.title || "Job detail"}
      description={
        job
          ? `${job.companyName || "Company not listed"} · ${locationLabel(job.location)}`
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {job ? (
            <a
              className="button button--primary button--medium"
              href={job.applyUrl || job.jobUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open application <ArrowUpRight size={15} />
            </a>
          ) : null}
        </>
      }
    >
      {job ? (
        <div className="job-modal">
          <div className="job-modal__facts">
            <Badge>{job.site || "unknown"}</Badge>
            {job.isRemote ? <Badge tone="info">Remote</Badge> : null}
            {job.legitimacy ? (
              <StatusBadge status={job.legitimacy.state} />
            ) : null}
            <span>{salary(job)}</span>
          </div>
          <h3>Description</h3>
          <p>
            {job.description || "No description was returned by this source."}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

function SearchLoading({ analysis }: { analysis: boolean }) {
  return (
    <div className="search-loading" role="status">
      <span className="search-loading__radar">
        <i />
        <i />
        <i />
      </span>
      <h2>{analysis ? "Analyzing the market" : "Searching sources"}</h2>
      <p>
        Requests are bounded and settled independently, so one source failure
        won’t hide successful results.
      </p>
    </div>
  );
}

function salary(job: JobPost): string {
  const value = job.compensation;
  if (!value?.minAmount && !value?.maxAmount) return "Salary not listed";
  const format = (amount?: number | null) =>
    amount
      ? new Intl.NumberFormat(undefined, {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(amount)
      : "?";
  return `${value.currency || "$"} ${format(value.minAmount)}–${format(value.maxAmount)}${value.interval ? ` / ${value.interval}` : ""}`;
}

function cleanInput(input: SearchInput): SearchInput {
  return Object.fromEntries(
    Object.entries(input).filter(
      ([, value]) =>
        value !== "" &&
        value !== undefined &&
        (!Array.isArray(value) || value.length),
    ),
  ) as SearchInput;
}
