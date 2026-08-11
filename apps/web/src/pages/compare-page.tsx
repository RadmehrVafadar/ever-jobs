import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  Download,
  GitCompareArrows,
  Search,
  Timer,
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
  PageHeader,
  Panel,
  PanelHeader,
  StatusBadge,
} from "../components/ui";
import { downloadJson } from "../lib/download";
import { duration, percentage, sentenceCase } from "../lib/format";
import { SearchInput } from "../types";

export function ComparePage() {
  const [input, setInput] = useState<SearchInput>({
    searchTerm: "software engineer",
    location: "Toronto, Ontario",
    country: "CANADA",
    resultsWanted: 15,
    siteType: [],
  });
  const [concurrency, setConcurrency] = useState(4);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<
    "totalJobs" | "remoteJobs" | "withSalary" | "durationMs"
  >("totalJobs");
  const sourceHealth = useQuery({
    queryKey: ["source-health"],
    queryFn: ({ signal }) => api.sources.health(signal),
  });
  const compare = useMutation({
    mutationFn: () => api.jobs.compare({ ...input, concurrency }),
  });
  const results = useMemo(
    () =>
      [...(compare.data?.comparisons ?? [])].sort(
        (left, right) => right[sort] - left[sort],
      ),
    [compare.data, sort],
  );
  const sourceOptions =
    sourceHealth.data?.sources
      .map(({ site }) => site)
      .filter((site) => site.toLowerCase().includes(filter.toLowerCase()))
      .slice(0, 160) ?? [];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    compare.mutate();
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Source diagnostics"
        title="Compare sources"
        description="Run the same query against selected plugins and compare useful output, latency, and partial failures side by side."
        actions={
          compare.data ? (
            <Button
              variant="secondary"
              onClick={() =>
                downloadJson("radar-source-comparison.json", compare.data)
              }
            >
              <Download size={16} />
              Download report
            </Button>
          ) : undefined
        }
      />
      <Panel className="compare-builder">
        <form onSubmit={submit}>
          <div className="compare-builder__query">
            <Field label="Search term">
              <div className="input-with-icon">
                <Search size={17} />
                <input
                  value={input.searchTerm ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, searchTerm: event.target.value })
                  }
                />
              </div>
            </Field>
            <Field label="Location">
              <input
                value={input.location ?? ""}
                onChange={(event) =>
                  setInput({ ...input, location: event.target.value })
                }
              />
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
            <Field label="Concurrency" hint="Bounded from 1 to 10.">
              <input
                type="number"
                min={1}
                max={10}
                value={concurrency}
                onChange={(event) => setConcurrency(Number(event.target.value))}
              />
            </Field>
            <Button type="submit" loading={compare.isPending}>
              <GitCompareArrows size={16} />
              Run comparison
            </Button>
          </div>
          <div className="compare-sources">
            <div className="compare-sources__header">
              <div>
                <strong>Sources to compare</strong>
                <span>
                  {input.siteType?.length
                    ? `${input.siteType.length} selected`
                    : "All registered sources"}
                </span>
              </div>
              <label>
                <Search size={14} />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter source registry"
                />
              </label>
              <button
                type="button"
                onClick={() => setInput({ ...input, siteType: [] })}
              >
                Clear selection
              </button>
            </div>
            <div className="source-chip-grid">
              {sourceOptions.map((site) => (
                <label className="source-chip" key={site}>
                  <input
                    type="checkbox"
                    checked={input.siteType?.includes(site) ?? false}
                    onChange={(event) =>
                      setInput({
                        ...input,
                        siteType: event.target.checked
                          ? [...(input.siteType ?? []), site]
                          : input.siteType?.filter((value) => value !== site),
                      })
                    }
                  />
                  <span>{site}</span>
                </label>
              ))}
            </div>
          </div>
          <ErrorText error={compare.error} />
        </form>
      </Panel>

      {compare.isPending ? (
        <div className="compare-loading" role="status">
          <span>
            <i />
            <i />
            <i />
          </span>
          <h2>Comparing {input.siteType?.length || "all"} sources</h2>
          <p>
            Each plugin settles independently with a concurrency limit of{" "}
            {concurrency}.
          </p>
        </div>
      ) : null}
      {!compare.data && !compare.isPending ? (
        <Panel>
          <EmptyState
            title="No comparison run yet"
            description="Select a focused group of sources for the fastest, clearest comparison."
          />
        </Panel>
      ) : null}
      {compare.data ? (
        <div className="compare-results">
          {compare.data.sourcesFailed.length ? (
            <InlineNotice
              tone="warning"
              title={`${compare.data.sourcesFailed.length} sources did not complete`}
            >
              Successful sources are still included below. Expand the failure
              list for sanitized details.
            </InlineNotice>
          ) : null}
          <section className="metric-grid metric-grid--four">
            <div className="analysis-metric">
              <strong>{compare.data.totalJobs}</strong>
              <span>Total jobs</span>
            </div>
            <div className="analysis-metric">
              <strong>{compare.data.sourcesSucceeded.length}</strong>
              <span>Sources succeeded</span>
            </div>
            <div className="analysis-metric">
              <strong>{compare.data.sourcesFailed.length}</strong>
              <span>Sources failed</span>
            </div>
            <div className="analysis-metric">
              <strong>{compare.data.concurrency}</strong>
              <span>Concurrency</span>
            </div>
          </section>
          <Panel>
            <PanelHeader
              title="Source comparison"
              description={`${results.length} sources returned usable data.`}
              action={
                <Field label="Sort by">
                  <select
                    value={sort}
                    onChange={(event) =>
                      setSort(event.target.value as typeof sort)
                    }
                  >
                    <option value="totalJobs">Total jobs</option>
                    <option value="remoteJobs">Remote jobs</option>
                    <option value="withSalary">Salary coverage</option>
                    <option value="durationMs">Duration</option>
                  </select>
                </Field>
              }
            />
            {!results.length ? (
              <EmptyState
                title="No source returned jobs"
                description="Review the failures or broaden the query."
              />
            ) : (
              <div className="comparison-table-wrap">
                <table className="comparison-table">
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Total jobs</th>
                      <th>Remote</th>
                      <th>With salary</th>
                      <th>Companies</th>
                      <th>Duration</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result, index) => (
                      <tr key={result.site}>
                        <td>
                          <div className="rank-cell">
                            <span>{index + 1}</span>
                            <strong>{result.site}</strong>
                          </div>
                        </td>
                        <td>
                          <strong>{result.totalJobs}</strong>
                        </td>
                        <td>
                          {result.remoteJobs}
                          <small>
                            {percentage(
                              result.totalJobs
                                ? result.remoteJobs / result.totalJobs
                                : 0,
                            )}
                          </small>
                        </td>
                        <td>
                          {result.withSalary}
                          <small>
                            {percentage(
                              result.totalJobs
                                ? result.withSalary / result.totalJobs
                                : 0,
                            )}
                          </small>
                        </td>
                        <td>{result.uniqueCompanies}</td>
                        <td>
                          <Timer size={14} />
                          {duration(result.durationMs)}
                        </td>
                        <td>
                          <StatusBadge status="completed" label="Succeeded" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
          {compare.data.sourcesFailed.length ? (
            <Panel>
              <details className="failure-details">
                <summary>
                  <AlertTriangle size={17} />
                  Review {compare.data.sourcesFailed.length} source failures
                </summary>
                <div>
                  {compare.data.sourcesFailed.map((failure) => (
                    <article key={failure.source}>
                      <span>
                        <strong>{failure.source}</strong>
                        <small>{duration(failure.durationMs)}</small>
                      </span>
                      <p>{failure.error}</p>
                    </article>
                  ))}
                </div>
              </details>
            </Panel>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
