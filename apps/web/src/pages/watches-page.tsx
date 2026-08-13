import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CirclePause,
  CirclePlay,
  Clock3,
  Copy,
  MoreHorizontal,
  Plus,
  Radar,
  RotateCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/auth-context";
import { formatDate, relativeTime } from "../lib/format";
import { cloneWatchPayload, isTargetInitialized } from "../lib/watch-draft";
import { JobWatch } from "../types";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ErrorText,
  Field,
  InlineNotice,
  LoadingState,
  MissingKeyBanner,
  Modal,
  PageHeader,
  Panel,
  PanelHeader,
  StatusBadge,
} from "../components/ui";

export function WatchesPage() {
  const { hasApiKey } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "paused">("all");
  const [feedback, setFeedback] = useState<string>();
  const [openMenu, setOpenMenu] = useState<string>();
  const watches = useQuery({
    queryKey: ["watches"],
    queryFn: ({ signal }) => api.watches.list(signal),
    enabled: hasApiKey,
  });
  const presets = useQuery({
    queryKey: ["watch-presets"],
    queryFn: ({ signal }) => api.presets.list(signal),
    enabled: hasApiKey,
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["watches"] });

  const action = useMutation({
    mutationFn: async ({
      type,
      watch,
    }: {
      type: "pause" | "resume" | "run" | "initialize" | "clone" | "delete";
      watch: JobWatch;
    }) => {
      switch (type) {
        case "pause":
          return api.watches.pause(watch.id);
        case "resume":
          return api.watches.resume(watch.id);
        case "run":
          return api.watches.run(watch.id);
        case "initialize":
          return api.watches.initialize(watch.id);
        case "clone":
          return api.watches.clone(cloneWatchPayload(watch));
        case "delete":
          return api.watches.remove(watch.id);
      }
    },
    onSuccess: async (_result, variables) => {
      setOpenMenu(undefined);
      setFeedback(
        variables.type === "run"
          ? `Run started for ${variables.watch.name}.`
          : variables.type === "initialize"
            ? `Baseline completed for ${variables.watch.name}.`
            : variables.type === "clone"
              ? `Created a paused copy of ${variables.watch.name}.`
              : variables.type === "delete"
                ? `Deleted ${variables.watch.name}.`
                : `${variables.watch.name} ${variables.type === "pause" ? "paused" : "resumed"}.`,
      );
      await invalidate();
    },
  });
  const defaultMutation = useMutation({
    mutationFn: api.watches.createDefault,
    onSuccess: async (watch) => {
      await invalidate();
      navigate(`/watches/${watch.id}`);
    },
  });
  const visible = useMemo(
    () =>
      (watches.data ?? []).filter(
        (watch) =>
          filter === "all" ||
          (filter === "active" ? watch.enabled : !watch.enabled),
      ),
    [watches.data, filter],
  );

  return (
    <div className="page">
      {!hasApiKey ? <MissingKeyBanner /> : null}
      <PageHeader
        eyebrow="Watcher"
        title="Watches"
        description="Build, baseline, and schedule persistent job profiles from one place."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => defaultMutation.mutate()}
              loading={defaultMutation.isPending}
              disabled={!hasApiKey}
            >
              <Sparkles size={16} />
              Use Canadian Tech Internships preset
            </Button>
            <Button onClick={() => setCreateOpen(true)} disabled={!hasApiKey}>
              <Plus size={16} />
              New watch
            </Button>
          </>
        }
      />
      {feedback ? <InlineNotice tone="success">{feedback}</InlineNotice> : null}
      <ErrorText error={action.error ?? defaultMutation.error} />

      <section className="metric-grid metric-grid--three">
        <div className="watch-summary">
          <span>
            <Radar size={17} />
          </span>
          <div>
            <strong>{watches.data?.length ?? 0}</strong>
            <small>Total profiles</small>
          </div>
        </div>
        <div className="watch-summary">
          <span>
            <CirclePlay size={17} />
          </span>
          <div>
            <strong>
              {watches.data?.filter((watch) => watch.enabled).length ?? 0}
            </strong>
            <small>Actively scheduled</small>
          </div>
        </div>
        <div className="watch-summary">
          <span>
            <Clock3 size={17} />
          </span>
          <div>
            <strong>
              {watches.data?.filter((watch) =>
                watch.sourceTargets.some(
                  (target) =>
                    target.enabled &&
                    !isTargetInitialized(target, watch.initializedAt),
                ),
              ).length ?? 0}
            </strong>
            <small>Need baseline</small>
          </div>
        </div>
      </section>

      <Panel>
        <PanelHeader
          title="Configured watches"
          description="Start watcher resumes a persisted profile; it does not spawn another process."
          action={
            <div className="segmented" aria-label="Filter watches">
              {(["all", "active", "paused"] as const).map((value) => (
                <button
                  key={value}
                  className={filter === value ? "is-active" : ""}
                  onClick={() => setFilter(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          }
        />
        {!hasApiKey ? (
          <EmptyState
            title="Unlock watcher controls"
            description="Watches are protected by the admin API key. Add it in Settings for this tab."
          />
        ) : watches.isPending ? (
          <LoadingState label="Loading watches" />
        ) : watches.isError ? (
          <ErrorState error={watches.error} onRetry={() => watches.refetch()} />
        ) : !visible.length ? (
          <EmptyState
            title={
              filter === "all"
                ? "No watches configured"
                : `No ${filter} watches`
            }
            description={
              filter === "all"
                ? "Start with a blank profile or use the safe default preset."
                : "Change the filter or update a watch state."
            }
            action={
              filter === "all" ? (
                <Button size="small" onClick={() => setCreateOpen(true)}>
                  <Plus size={15} />
                  Create watch
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="watch-list">
            {visible.map((watch) => {
              const initializedTargets = watch.sourceTargets.filter((target) =>
                isTargetInitialized(target, watch.initializedAt),
              ).length;
              const degraded = Object.values(watch.targetHealth ?? {}).filter(
                (target) => target.consecutiveHardFailures >= 3,
              ).length;
              const needsBaseline = watch.sourceTargets.some(
                (target) =>
                  target.enabled &&
                  !isTargetInitialized(target, watch.initializedAt),
              );
              return (
                <article className="watch-row" key={watch.id}>
                  <div
                    className={`watch-row__state ${watch.enabled ? "is-active" : ""}`}
                  >
                    <Radar size={20} />
                  </div>
                  <div className="watch-row__identity">
                    <div>
                      <Link to={`/watches/${watch.id}`}>{watch.name}</Link>
                      <StatusBadge
                        status={watch.enabled ? "active" : "paused"}
                      />
                    </div>
                    <p>{watch.description || "No description provided."}</p>
                    <div className="watch-row__meta">
                      <span>
                        {
                          watch.sourceTargets.filter((target) => target.enabled)
                            .length
                        }{" "}
                        enabled sources
                      </span>
                      <span>
                        {initializedTargets}/{watch.sourceTargets.length}{" "}
                        baselined
                      </span>
                      <span>Every {watch.intervalMinutes} min</span>
                    </div>
                  </div>
                  <div className="watch-row__schedule">
                    <small>Next run</small>
                    <strong>
                      {watch.enabled ? formatDate(watch.nextRunAt) : "Paused"}
                    </strong>
                    <span>Last ran {relativeTime(watch.lastRunAt)}</span>
                  </div>
                  <div className="watch-row__coverage">
                    <small>Coverage</small>
                    <Badge tone={degraded ? "danger" : "success"}>
                      {degraded ? `${degraded} degraded` : "Healthy"}
                    </Badge>
                  </div>
                  <div className="watch-row__actions">
                    {!watch.enabled && needsBaseline ? (
                      <Link
                        className="button button--secondary button--small"
                        to={`/watches/${watch.id}?tab=sources`}
                        title="Initialize enabled targets before resuming"
                      >
                        <Sparkles size={15} />
                        Initialize
                      </Link>
                    ) : (
                      <Button
                        variant={watch.enabled ? "secondary" : "primary"}
                        size="small"
                        loading={
                          action.isPending &&
                          action.variables?.watch.id === watch.id &&
                          ["pause", "resume"].includes(action.variables.type)
                        }
                        onClick={() =>
                          action.mutate({
                            type: watch.enabled ? "pause" : "resume",
                            watch,
                          })
                        }
                      >
                        {watch.enabled ? (
                          <CirclePause size={15} />
                        ) : (
                          <CirclePlay size={15} />
                        )}
                        {watch.enabled ? "Pause" : "Start watcher"}
                      </Button>
                    )}
                    <div className="menu">
                      <button
                        className="icon-button"
                        aria-label={`More actions for ${watch.name}`}
                        aria-expanded={openMenu === watch.id}
                        onClick={() =>
                          setOpenMenu(
                            openMenu === watch.id ? undefined : watch.id,
                          )
                        }
                      >
                        <MoreHorizontal size={18} />
                      </button>
                      {openMenu === watch.id ? (
                        <div className="menu__popover">
                          <button
                            onClick={() =>
                              action.mutate({ type: "run", watch })
                            }
                          >
                            <RotateCw size={15} />
                            Run now
                          </button>
                          <button
                            onClick={() =>
                              action.mutate({ type: "initialize", watch })
                            }
                          >
                            <Sparkles size={15} />
                            Initialize all targets
                          </button>
                          <button
                            onClick={() =>
                              action.mutate({ type: "clone", watch })
                            }
                          >
                            <Copy size={15} />
                            Make a copy
                          </button>
                          <Link to={`/watches/${watch.id}`}>
                            Edit profile <ArrowRight size={15} />
                          </Link>
                          <button
                            className="is-danger"
                            onClick={() => {
                              if (
                                window.confirm(
                                  `Delete “${watch.name}” and all dependent history? This cannot be undone.`,
                                )
                              )
                                action.mutate({ type: "delete", watch });
                            }}
                          >
                            <Trash2 size={15} />
                            Delete watch
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Panel>

      {presets.data?.length ? (
        <Panel>
          <PanelHeader
            title="Available presets"
            description="Versioned starting points maintained by rad.ar."
          />
          <div className="preset-grid">
            {presets.data.map((preset) => (
              <article key={preset.id}>
                <span>
                  <Sparkles size={17} />
                </span>
                <div>
                  <h3>{preset.name}</h3>
                  <p>
                    {preset.description ||
                      "A versioned rad.ar watch configuration."}
                  </p>
                  <small>Version {preset.version}</small>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      ) : null}

      <CreateWatchModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function CreateWatchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose(): void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(30);
  const [timezone, setTimezone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto",
  );
  const create = useMutation({
    mutationFn: () =>
      api.watches.create({
        name,
        description: description || null,
        intervalMinutes,
        timezone,
        enabled: false,
      }),
    onSuccess: async (watch) => {
      await queryClient.invalidateQueries({ queryKey: ["watches"] });
      onClose();
      navigate(`/watches/${watch.id}`);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) create.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a blank watch"
      description="Start paused, then add sources and filters before the first baseline."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="create-watch" loading={create.isPending}>
            Create watch
          </Button>
        </>
      }
    >
      <form id="create-watch" className="form-stack" onSubmit={submit}>
        <Field label="Watch name">
          <input
            autoFocus
            required
            maxLength={200}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Toronto product engineering"
          />
        </Field>
        <Field label="Description" hint="Optional context for future you.">
          <textarea
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Roles, locations, and intent for this watch."
          />
        </Field>
        <div className="form-grid form-grid--two">
          <Field label="Default interval">
            <div className="input-suffix">
              <input
                type="number"
                min={1}
                max={1440}
                value={intervalMinutes}
                onChange={(event) =>
                  setIntervalMinutes(Number(event.target.value))
                }
              />
              <span>minutes</span>
            </div>
          </Field>
          <Field label="Timezone">
            <input
              required
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </Field>
        </div>
        <ErrorText error={create.error} />
      </form>
    </Modal>
  );
}
