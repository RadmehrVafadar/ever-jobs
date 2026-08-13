import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  CheckCircle2,
  MapPin,
  Search,
  SlidersHorizontal,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  MissingKeyBanner,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  PanelHeader,
  StatusBadge,
  Tabs,
} from "../components/ui";
import { useAuth } from "../context/auth-context";
import {
  duration,
  formatDate,
  relativeTime,
  sentenceCase,
} from "../lib/format";
import { ObservedJob, WatchMatch, WatchMatchStatus } from "../types";

type WorkspaceTab = "matches" | "runs" | "jobs";
const MATCH_STATUSES: WatchMatchStatus[] = [
  "new",
  "reviewed",
  "applied",
  "interview",
  "rejected",
  "offer",
  "dismissed",
];

export function MatchesPage() {
  const { hasApiKey } = useAuth();
  const [tab, setTab] = useState<WorkspaceTab>("matches");
  const [watchId, setWatchId] = useState("");
  const watches = useQuery({
    queryKey: ["watches"],
    queryFn: ({ signal }) => api.watches.list(signal),
    enabled: hasApiKey,
  });
  useEffect(() => {
    if (!watchId && watches.data?.[0]) setWatchId(watches.data[0].id);
  }, [watchId, watches.data]);
  const selected = watches.data?.find((watch) => watch.id === watchId);

  return (
    <div className="page">
      {!hasApiKey ? <MissingKeyBanner /> : null}
      <PageHeader
        eyebrow="Review workspace"
        title="Matches & jobs"
        description="Triage scored matches, inspect their evidence, update application status, and audit run history."
      />
      <div className="workspace-toolbar">
        <Field label="Watch profile">
          <select
            value={watchId}
            onChange={(event) => setWatchId(event.target.value)}
            disabled={!watches.data?.length}
          >
            <option value="">Choose a watch</option>
            {watches.data?.map((watch) => (
              <option value={watch.id} key={watch.id}>
                {watch.name}
              </option>
            ))}
          </select>
        </Field>
        {selected ? (
          <div>
            <StatusBadge status={selected.enabled ? "active" : "paused"} />
            <span>
              {selected.sourceTargets.length} targets · last run{" "}
              {relativeTime(selected.lastRunAt)}
            </span>
          </div>
        ) : null}
      </div>
      <div className="editor-tabs-wrap">
        <Tabs
          value={tab}
          onChange={(value) => setTab(value as WorkspaceTab)}
          tabs={[
            { value: "matches", label: "Matches" },
            { value: "runs", label: "Run history" },
            { value: "jobs", label: "Observed jobs" },
          ]}
        />
      </div>
      {!hasApiKey ? (
        <Panel>
          <EmptyState
            title="Unlock the review workspace"
            description="Add your admin API key in Settings to load persisted job data."
          />
        </Panel>
      ) : watches.isPending ? (
        <LoadingState label="Loading watches" />
      ) : watches.isError ? (
        <ErrorState error={watches.error} />
      ) : !watches.data.length ? (
        <Panel>
          <EmptyState
            title="No watches yet"
            description="Create a watch before reviewing matches and runs."
            action={
              <Link
                className="button button--primary button--small"
                to="/watches"
              >
                Create watch
              </Link>
            }
          />
        </Panel>
      ) : (
        <>
          {tab === "matches" ? <MatchesPanel watchId={watchId} /> : null}
          {tab === "runs" ? <RunsPanel watchId={watchId} /> : null}
          {tab === "jobs" ? <ObservedJobsPanel /> : null}
        </>
      )}
    </div>
  );
}

function MatchesPanel({ watchId }: { watchId: string }) {
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({
    status: "",
    notificationState: "",
    source: "",
    company: "",
    minimumScore: "",
  });
  const [selected, setSelected] = useState<WatchMatch>();
  const matches = useQuery({
    queryKey: ["matches", watchId, filters, offset],
    queryFn: ({ signal }) =>
      api.watches.matches(watchId, { ...filters, offset, limit: 30 }, signal),
    enabled: Boolean(watchId),
  });
  return (
    <Panel>
      <PanelHeader
        title="Scored matches"
        description="Filters apply to persisted match and notification state."
      />
      <div className="filter-bar filter-bar--five">
        <Field label="Workflow">
          <select
            value={filters.status}
            onChange={(event) => {
              setOffset(0);
              setFilters({ ...filters, status: event.target.value });
            }}
          >
            <option value="">All statuses</option>
            {MATCH_STATUSES.map((status) => (
              <option key={status} value={status}>
                {sentenceCase(status)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notification">
          <select
            value={filters.notificationState}
            onChange={(event) => {
              setOffset(0);
              setFilters({ ...filters, notificationState: event.target.value });
            }}
          >
            <option value="">All states</option>
            {["pending", "sent", "failed", "suppressed"].map((status) => (
              <option key={status} value={status}>
                {sentenceCase(status)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Source">
          <input
            value={filters.source}
            onChange={(event) =>
              setFilters({ ...filters, source: event.target.value })
            }
            placeholder="ashby"
          />
        </Field>
        <Field label="Company">
          <input
            value={filters.company}
            onChange={(event) =>
              setFilters({ ...filters, company: event.target.value })
            }
            placeholder="Shopify"
          />
        </Field>
        <Field label="Minimum score">
          <input
            type="number"
            min={0}
            value={filters.minimumScore}
            onChange={(event) =>
              setFilters({ ...filters, minimumScore: event.target.value })
            }
            placeholder="0"
          />
        </Field>
      </div>
      {matches.isPending ? (
        <LoadingState label="Loading matches" />
      ) : matches.isError ? (
        <ErrorState error={matches.error} onRetry={() => matches.refetch()} />
      ) : !matches.data.items.length ? (
        <EmptyState
          title="No matches found"
          description="Adjust the filters or run and initialize this watch."
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="matches-table">
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Source target</th>
                  <th>Matched evidence</th>
                  <th>Workflow</th>
                  <th>Notification</th>
                  <th>Matched</th>
                </tr>
              </thead>
              <tbody>
                {matches.data.items.map((match) => (
                  <tr
                    key={match.id}
                    className="is-clickable"
                    onClick={() => setSelected(match)}
                  >
                    <td>
                      <span
                        className={`score-badge ${match.score >= 80 ? "is-urgent" : match.score >= 60 ? "is-standard" : ""}`}
                      >
                        {match.score}
                      </span>
                    </td>
                    <td>
                      <div className="primary-cell">
                        <strong>
                          {match.sourceTargetKey || "Unknown target"}
                        </strong>
                        <span>
                          {match.scoreBreakdown.matchedCountry ||
                            match.scoreBreakdown.geographyDecision ||
                            "No geography decision"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="term-list">
                        {match.matchedTerms.slice(0, 3).map((term) => (
                          <Badge key={term}>{term}</Badge>
                        ))}
                        {!match.matchedTerms.length ? "—" : null}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={match.status} />
                    </td>
                    <td>
                      <StatusBadge status={match.notificationState} />
                    </td>
                    <td>{relativeTime(match.firstMatchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            offset={matches.data.offset}
            limit={matches.data.limit}
            total={matches.data.total}
            onChange={setOffset}
          />
        </>
      )}
      <MatchDetailModal
        watchId={watchId}
        match={selected}
        onClose={() => setSelected(undefined)}
      />
    </Panel>
  );
}

function MatchDetailModal({
  watchId,
  match,
  onClose,
}: {
  watchId: string;
  match?: WatchMatch;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const job = useQuery({
    queryKey: ["observed-job", match?.observedJobId],
    queryFn: ({ signal }) => api.observedJobs.get(match!.observedJobId, signal),
    enabled: Boolean(match),
  });
  const updateStatus = useMutation({
    mutationFn: (status: WatchMatchStatus) =>
      api.watches.updateMatchStatus(watchId, match!.id, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["matches", watchId] });
      onClose();
    },
  });
  const breakdown = match?.scoreBreakdown;
  return (
    <Modal
      open={Boolean(match)}
      onClose={onClose}
      width="wide"
      title={job.data?.title || "Match details"}
      description={
        job.data
          ? `${job.data.company || "Unknown company"} · ${job.data.location || "Location not listed"}`
          : "Loading the matched job record…"
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {job.data?.applicationUrl || job.data?.jobUrl ? (
            <a
              className="button button--primary button--medium"
              target="_blank"
              rel="noreferrer"
              href={job.data.applicationUrl || job.data.jobUrl || "#"}
            >
              Open application <ArrowUpRight size={15} />
            </a>
          ) : null}
        </>
      }
    >
      {!match || !breakdown ? null : (
        <div className="match-detail">
          <section className="match-detail__score">
            <div>
              <strong>{match.score}</strong>
              <small>Total score</small>
            </div>
            <div className="score-bars">
              {(
                [
                  "role",
                  "internship",
                  "location",
                  "company",
                  "source",
                  "skills",
                ] as const
              ).map((key) => (
                <div key={key}>
                  <span>{sentenceCase(key)}</span>
                  <div>
                    <i
                      style={{
                        width: `${Math.min(100, Math.max(0, breakdown[key]) * 3.3)}%`,
                      }}
                    />
                  </div>
                  <strong>{breakdown[key]}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="match-detail__job">
            {job.isPending ? (
              <LoadingState label="Loading job" />
            ) : job.isError ? (
              <ErrorState error={job.error} />
            ) : job.data ? (
              <JobSummary job={job.data} />
            ) : null}
            <div className="workflow-control">
              <Field label="Application workflow">
                <select
                  value={match.status}
                  disabled={updateStatus.isPending}
                  onChange={(event) =>
                    updateStatus.mutate(event.target.value as WatchMatchStatus)
                  }
                >
                  {MATCH_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {sentenceCase(status)}
                    </option>
                  ))}
                </select>
              </Field>
              <StatusBadge
                status={match.notificationState}
                label={`Notification ${match.notificationState}`}
              />
            </div>
          </section>
          <section className="match-evidence">
            <h3>Why this matched</h3>
            <ul>
              {breakdown.reasons.map((reason) => (
                <li key={reason}>
                  <CheckCircle2 size={15} />
                  {reason}
                </li>
              ))}
            </ul>
            {breakdown.missingRequired.length ? (
              <div>
                <strong>Missing required evidence</strong>
                <p>{breakdown.missingRequired.join(", ")}</p>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </Modal>
  );
}

function JobSummary({ job }: { job: ObservedJob }) {
  return (
    <div className="job-summary">
      <div>
        <Building2 size={16} />
        <span>
          <small>Company</small>
          <strong>{job.company || "Unknown"}</strong>
        </span>
      </div>
      <div>
        <MapPin size={16} />
        <span>
          <small>Location</small>
          <strong>{job.location || "Not listed"}</strong>
        </span>
      </div>
      <div>
        <BriefcaseBusiness size={16} />
        <span>
          <small>Type</small>
          <strong>
            {job.employmentType || job.workplaceType || "Not listed"}
          </strong>
        </span>
      </div>
      <div>
        <CalendarClock size={16} />
        <span>
          <small>First seen</small>
          <strong>{formatDate(job.firstSeenAt)}</strong>
        </span>
      </div>
    </div>
  );
}

function RunsPanel({ watchId }: { watchId: string }) {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const runs = useQuery({
    queryKey: ["watch-runs", watchId, status, offset],
    queryFn: ({ signal }) =>
      api.watches.runs(watchId, { status, offset, limit: 30 }, signal),
    enabled: Boolean(watchId),
  });
  return (
    <Panel>
      <PanelHeader
        title="Run history"
        description="Scheduler and manual executions, including partial-source outcomes."
        action={
          <Field label="Status">
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">All statuses</option>
              {["running", "completed", "partial", "failed"].map((item) => (
                <option key={item} value={item}>
                  {sentenceCase(item)}
                </option>
              ))}
            </select>
          </Field>
        }
      />
      {runs.isPending ? (
        <LoadingState label="Loading runs" />
      ) : runs.isError ? (
        <ErrorState error={runs.error} />
      ) : !runs.data.items.length ? (
        <EmptyState
          title="No runs found"
          description="Initialize the selected watch or run it manually."
        />
      ) : (
        <>
          <div className="run-card-list">
            {runs.data.items.map((run) => (
              <article key={run.id}>
                <header>
                  <div>
                    <StatusBadge status={run.status} />
                    <strong>{formatDate(run.startedAt)}</strong>
                  </div>
                  <span>{duration(run.durationMs)}</span>
                </header>
                <div>
                  <span>
                    <small>Jobs fetched</small>
                    <strong>{run.jobsFetched}</strong>
                  </span>
                  <span>
                    <small>New jobs</small>
                    <strong>{run.newJobsDetected}</strong>
                  </span>
                  <span>
                    <small>Matches</small>
                    <strong>{run.matchesCreated}</strong>
                  </span>
                  <span>
                    <small>Notifications</small>
                    <strong>{run.notificationsSent}</strong>
                  </span>
                </div>
                <footer>
                  <span>
                    {run.sourcesSucceeded.length}/{run.sourcesRequested.length}{" "}
                    sources succeeded
                  </span>
                  {run.errorSummary ? <p>{run.errorSummary}</p> : null}
                </footer>
              </article>
            ))}
          </div>
          <Pagination
            offset={runs.data.offset}
            limit={runs.data.limit}
            total={runs.data.total}
            onChange={setOffset}
          />
        </>
      )}
    </Panel>
  );
}

function ObservedJobsPanel() {
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({
    company: "",
    source: "",
    location: "",
    workplaceType: "",
  });
  const [selected, setSelected] = useState<ObservedJob>();
  const jobs = useQuery({
    queryKey: ["observed-jobs", filters, offset],
    queryFn: ({ signal }) =>
      api.observedJobs.list({ ...filters, offset, limit: 30 }, signal),
  });
  return (
    <Panel>
      <PanelHeader
        title="Observed jobs"
        description="Sanitized canonical observations shared across watches."
      />
      <div className="filter-bar">
        <Field label="Company">
          <input
            value={filters.company}
            onChange={(event) =>
              setFilters({ ...filters, company: event.target.value })
            }
          />
        </Field>
        <Field label="Source">
          <input
            value={filters.source}
            onChange={(event) =>
              setFilters({ ...filters, source: event.target.value })
            }
          />
        </Field>
        <Field label="Location">
          <input
            value={filters.location}
            onChange={(event) =>
              setFilters({ ...filters, location: event.target.value })
            }
          />
        </Field>
        <Field label="Workplace">
          <select
            value={filters.workplaceType}
            onChange={(event) =>
              setFilters({ ...filters, workplaceType: event.target.value })
            }
          >
            <option value="">All</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="on-site">On-site</option>
          </select>
        </Field>
      </div>
      {jobs.isPending ? (
        <LoadingState label="Loading observed jobs" />
      ) : jobs.isError ? (
        <ErrorState error={jobs.error} />
      ) : !jobs.data.items.length ? (
        <EmptyState
          title="No observed jobs"
          description="Run a watch to populate the canonical observation store."
        />
      ) : (
        <>
          <div className="job-list">
            {jobs.data.items.map((job) => (
              <button key={job.id} onClick={() => setSelected(job)}>
                <span className="job-list__icon">
                  <BriefcaseBusiness size={17} />
                </span>
                <span>
                  <strong>{job.title}</strong>
                  <small>
                    {job.company || "Unknown company"} ·{" "}
                    {job.location || "Location not listed"}
                  </small>
                </span>
                <Badge>{job.source}</Badge>
                <time>{relativeTime(job.firstSeenAt)}</time>
              </button>
            ))}
          </div>
          <Pagination
            offset={jobs.data.offset}
            limit={jobs.data.limit}
            total={jobs.data.total}
            onChange={setOffset}
          />
        </>
      )}
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
        title={selected?.title || "Job detail"}
        description={
          selected
            ? `${selected.company || "Unknown company"} · ${selected.source}`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setSelected(undefined)}>
              Close
            </Button>
            {selected?.jobUrl ? (
              <a
                className="button button--primary button--medium"
                href={selected.jobUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open listing <ArrowUpRight size={15} />
              </a>
            ) : null}
          </>
        }
      >
        {selected ? (
          <div className="observed-detail">
            <JobSummary job={selected} />
            <div>
              <h3>Description</h3>
              <p>
                {selected.description ||
                  "No description was retained for this observation."}
              </p>
            </div>
            <dl>
              <div>
                <dt>Source target</dt>
                <dd>{selected.sourceTargetKey || "—"}</dd>
              </div>
              <div>
                <dt>Episode</dt>
                <dd>{selected.canonicalEpisodeKey || "—"}</dd>
              </div>
              <div>
                <dt>Last seen</dt>
                <dd>{formatDate(selected.lastSeenAt)}</dd>
              </div>
              <div>
                <dt>Workplace</dt>
                <dd>{selected.workplaceType || "—"}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </Modal>
    </Panel>
  );
}
