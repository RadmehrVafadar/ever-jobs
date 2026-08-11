import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { SourceHealth, WatchSourceTarget } from "../types";
import { blankTarget } from "../lib/watch-draft";
import { Badge, Button, Field, StatusBadge, TagInput, Toggle } from "./ui";

const FALLBACK_SOURCES = [
  "google_careers",
  "linkedin",
  "google",
  "ashby",
  "greenhouse",
  "lever",
  "workable",
  "smartrecruiters",
  "canadajobbank",
  "shopify",
  "wellfound",
  "remoteok",
];

export function SourceTargetsEditor({
  targets,
  sourceHealth,
  onChange,
}: {
  targets: WatchSourceTarget[];
  sourceHealth: SourceHealth[];
  onChange(targets: WatchSourceTarget[]): void;
}) {
  const [search, setSearch] = useState("");
  const [newSite, setNewSite] = useState("");
  const suggestions = useMemo(
    () =>
      [
        ...new Set([
          ...sourceHealth.map(({ site }) => site),
          ...FALLBACK_SOURCES,
        ]),
      ].sort(),
    [sourceHealth],
  );
  const visible = targets
    .map((target, index) => ({ target, index }))
    .filter(({ target }) =>
      [target.site, target.companyName, target.companySlug].some((value) =>
        value?.toLowerCase().includes(search.toLowerCase()),
      ),
    );

  const update = (index: number, patch: Partial<WatchSourceTarget>) => {
    onChange(
      targets.map((target, targetIndex) =>
        targetIndex === index ? { ...target, ...patch } : target,
      ),
    );
  };
  const updateScope = (
    index: number,
    patch: Partial<NonNullable<WatchSourceTarget["searchScope"]>>,
  ) => {
    const target = targets[index];
    update(index, {
      searchScope: {
        countryCodes: target.searchScope?.countryCodes ?? ["CA"],
        locations: target.searchScope?.locations ?? ["Canada"],
        ...target.searchScope,
        ...patch,
      },
    });
  };
  const add = () => {
    const site = newSite.trim();
    if (!site) return;
    onChange([...targets, blankTarget(site)]);
    setNewSite("");
  };

  return (
    <div className="targets-editor">
      <div className="targets-toolbar">
        <label className="search-input">
          <Search size={16} />
          <span className="sr-only">Filter configured sources</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter configured sources"
          />
        </label>
        <div className="add-target">
          <input
            list="source-suggestions"
            value={newSite}
            onChange={(event) => setNewSite(event.target.value)}
            placeholder="Choose or type a source"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <datalist id="source-suggestions">
            {suggestions.map((site) => (
              <option value={site} key={site} />
            ))}
          </datalist>
          <Button size="small" onClick={add} disabled={!newSite.trim()}>
            <Plus size={15} />
            Add source
          </Button>
        </div>
      </div>
      {!targets.length ? (
        <div className="routes-empty">
          <span>
            <Search size={20} />
          </span>
          <div>
            <strong>No source targets</strong>
            <p>Add at least one source before applying this profile.</p>
          </div>
        </div>
      ) : null}
      <div className="target-list">
        {visible.map(({ target, index }) => {
          const health = sourceHealth.find(({ site }) => site === target.site);
          const targetKey = target.companySlug
            ? `${target.site}:${target.companySlug}`
            : target.site;
          return (
            <details className="target-card" key={`${target.site}-${index}`}>
              <summary>
                <span
                  className={`target-card__tier target-card__tier--${target.tier}`}
                >
                  T{target.tier}
                </span>
                <span className="target-card__identity">
                  <strong>{target.companyName || target.site}</strong>
                  <small>{targetKey}</small>
                </span>
                <StatusBadge
                  status={
                    !target.enabled ? "disabled" : (health?.state ?? "unknown")
                  }
                  label={
                    !target.enabled
                      ? "Disabled"
                      : health
                        ? health.state
                        : "No runtime data"
                  }
                />
                <span className="target-card__interval">
                  Every {target.intervalMinutes} min
                </span>
                <ChevronDown className="target-card__chevron" size={17} />
              </summary>
              <div className="target-card__body">
                <div className="form-grid form-grid--four">
                  <Field label="Source ID">
                    <input
                      value={target.site}
                      list="source-suggestions"
                      onChange={(event) =>
                        update(index, { site: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Priority tier">
                    <select
                      value={target.tier}
                      onChange={(event) =>
                        update(index, {
                          tier: Number(event.target.value) as 1 | 2 | 3,
                        })
                      }
                    >
                      <option value={1}>Tier 1 · priority</option>
                      <option value={2}>Tier 2 · standard</option>
                      <option value={3}>Tier 3 · discovery</option>
                    </select>
                  </Field>
                  <Field label="Run interval">
                    <div className="input-suffix">
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={target.intervalMinutes}
                        onChange={(event) =>
                          update(index, {
                            intervalMinutes: Number(event.target.value),
                          })
                        }
                      />
                      <span>min</span>
                    </div>
                  </Field>
                  <Field label="Result limit">
                    <input
                      type="number"
                      min={1}
                      max={1000}
                      value={target.resultsWanted ?? ""}
                      placeholder="Source default"
                      onChange={(event) =>
                        update(index, {
                          resultsWanted: event.target.value
                            ? Number(event.target.value)
                            : undefined,
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="form-grid form-grid--two">
                  <Field label="Company name">
                    <input
                      value={target.companyName ?? ""}
                      onChange={(event) =>
                        update(index, {
                          companyName: event.target.value || undefined,
                        })
                      }
                      placeholder="Human-readable company"
                    />
                  </Field>
                  <Field label="Company slug">
                    <input
                      value={target.companySlug ?? ""}
                      onChange={(event) =>
                        update(index, {
                          companySlug: event.target.value || undefined,
                        })
                      }
                      placeholder="ATS tenant or board slug"
                    />
                  </Field>
                </div>
                <div className="target-scope">
                  <div className="target-scope__header">
                    <div>
                      <strong>Target search scope</strong>
                      <small>
                        Override the watch-wide geography and terms for this
                        source.
                      </small>
                    </div>
                    <Badge tone={target.searchScope ? "info" : "neutral"}>
                      {target.searchScope ? "Custom" : "Uses watch defaults"}
                    </Badge>
                  </div>
                  {target.searchScope ? (
                    <>
                      <div className="form-grid form-grid--two">
                        <TagInput
                          label="Country codes"
                          values={target.searchScope.countryCodes}
                          onChange={(countryCodes) =>
                            updateScope(index, {
                              countryCodes: countryCodes.map((code) =>
                                code.toUpperCase(),
                              ),
                            })
                          }
                          placeholder="CA"
                        />
                        <TagInput
                          label="Locations"
                          values={target.searchScope.locations}
                          onChange={(locations) =>
                            updateScope(index, { locations })
                          }
                          placeholder="Toronto, Ontario"
                        />
                      </div>
                      <TagInput
                        label="Search terms"
                        values={target.searchScope.searchTerms ?? []}
                        onChange={(searchTerms) =>
                          updateScope(index, {
                            searchTerms: searchTerms.length
                              ? searchTerms
                              : undefined,
                          })
                        }
                      />
                      <Toggle
                        checked={target.searchScope.strictLocations ?? false}
                        onChange={(strictLocations) =>
                          updateScope(index, { strictLocations })
                        }
                        label="Require listed locations"
                        description="Reject returned jobs that do not advertise at least one configured location."
                      />
                      <div className="inline-actions">
                        <Field label="Request budget">
                          <input
                            type="number"
                            min={1}
                            max={1000}
                            value={target.searchScope.maxRequestsPerRun ?? ""}
                            placeholder="No override"
                            onChange={(event) =>
                              updateScope(index, {
                                maxRequestsPerRun: event.target.value
                                  ? Number(event.target.value)
                                  : undefined,
                              })
                            }
                          />
                        </Field>
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() =>
                            update(index, { searchScope: undefined })
                          }
                        >
                          Use watch defaults
                        </Button>
                      </div>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => updateScope(index, {})}
                    >
                      Add a source-specific scope
                    </Button>
                  )}
                </div>
                <div className="target-card__footer">
                  <Toggle
                    checked={target.enabled}
                    onChange={(enabled) => update(index, { enabled })}
                    label="Source enabled"
                    description={
                      target.initializedAt
                        ? `Baselined ${new Date(target.initializedAt).toLocaleDateString()}`
                        : "A baseline is required before notifications."
                    }
                  />
                  <Button
                    variant="danger"
                    size="small"
                    onClick={() =>
                      window.confirm(`Remove ${targetKey} from this draft?`) &&
                      onChange(
                        targets.filter(
                          (_, targetIndex) => targetIndex !== index,
                        ),
                      )
                    }
                  >
                    <Trash2 size={15} />
                    Remove
                  </Button>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
