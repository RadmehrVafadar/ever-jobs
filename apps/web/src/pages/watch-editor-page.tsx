import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BarChart3,
  Bell,
  Braces,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Clock3,
  Download,
  FileDiff,
  Gauge,
  MapPin,
  Play,
  Radar,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuth } from "../context/auth-context";
import { AdvancedJsonEditor } from "../components/advanced-json-editor";
import { NotificationRoutesEditor } from "../components/notification-routes-editor";
import { SourceTargetsEditor } from "../components/source-targets-editor";
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
  Panel,
  PanelHeader,
  StatusBadge,
  Tabs,
  TagInput,
  Toggle,
} from "../components/ui";
import { downloadJson } from "../lib/download";
import {
  duration,
  formatDate,
  percentage,
  relativeTime,
  sentenceCase,
} from "../lib/format";
import {
  diffWatch,
  DraftDiff,
  editableWatch,
  EditableWatch,
  isTargetInitialized,
  validateDraft,
} from "../lib/watch-draft";
import { JobWatch, WatchApplyResponse, WatchRun } from "../types";

type EditorTab =
  | "profile"
  | "sources"
  | "scoring"
  | "notifications"
  | "activity"
  | "json";
const TABS: Array<{ value: EditorTab; label: string }> = [
  { value: "profile", label: "Profile" },
  { value: "sources", label: "Sources" },
  { value: "scoring", label: "Scoring" },
  { value: "notifications", label: "Notifications" },
  { value: "activity", label: "Activity" },
  { value: "json", label: "Advanced JSON" },
];

export function WatchEditorPage() {
  const { hasApiKey } = useAuth();
  const { watchId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [original, setOriginal] = useState<EditableWatch>();
  const [draft, setDraft] = useState<EditableWatch>();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [applyResult, setApplyResult] = useState<WatchApplyResponse>();
  const [baselineComplete, setBaselineComplete] = useState(false);
  const [baselineIssue, setBaselineIssue] = useState<string>();
  const requestedTab = searchParams.get("tab") as EditorTab | null;
  const tab = TABS.some(({ value }) => value === requestedTab)
    ? requestedTab!
    : "profile";

  const watch = useQuery({
    queryKey: ["watch", watchId],
    queryFn: ({ signal }) => api.watches.get(watchId, signal),
    enabled: Boolean(watchId && hasApiKey),
  });
  const sourceHealth = useQuery({
    queryKey: ["source-health"],
    queryFn: ({ signal }) => api.sources.health(signal),
    enabled: hasApiKey,
  });
  const destinations = useQuery({
    queryKey: ["destinations"],
    queryFn: ({ signal }) => api.destinations.list(signal),
    enabled: hasApiKey,
  });
  const presets = useQuery({
    queryKey: ["watch-presets"],
    queryFn: ({ signal }) => api.presets.list(signal),
    enabled: hasApiKey,
  });
  const preview = useQuery({
    queryKey: ["preset-preview", selectedPreset, watchId],
    queryFn: ({ signal }) =>
      api.presets.preview(selectedPreset, watchId, signal),
    enabled: hasApiKey && presetOpen && Boolean(selectedPreset),
  });

  useEffect(() => {
    if (!watch.data) return;
    const next = editableWatch(normalizeWatch(watch.data));
    setOriginal(next);
    setDraft(next);
  }, [watch.data?.id, watch.data?.updatedAt]);

  const diffs = useMemo(
    () => (original && draft ? diffWatch(original, draft) : []),
    [original, draft],
  );
  const errors = useMemo(() => (draft ? validateDraft(draft) : []), [draft]);
  const hasBehaviorChanges = diffs.some(
    ({ behaviorChanging }) => behaviorChanging,
  );
  const uninitializedTargetKeys = useMemo(
    () =>
      (watch.data?.sourceTargets ?? [])
        .filter(
          (target) =>
            target.enabled &&
            !isTargetInitialized(target, watch.data?.initializedAt),
        )
        .map((target) =>
          target.companySlug
            ? `${target.site}:${target.companySlug}`
            : target.site,
        ),
    [watch.data],
  );
  const needsBaseline = uninitializedTargetKeys.length > 0;
  const update = <K extends keyof EditableWatch>(
    field: K,
    value: EditableWatch[K],
  ) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  const apply = useMutation({
    mutationFn: () => {
      if (!watch.data || !draft) throw new Error("Watch has not loaded.");
      const patch = Object.fromEntries(
        diffs.map(({ path }) => [path, draft[path as keyof EditableWatch]]),
      ) as Partial<EditableWatch>;
      return api.watches.apply(watchId, watch.data.updatedAt, patch);
    },
    onSuccess: async (result) => {
      setReviewOpen(false);
      setApplyResult(result);
      setBaselineComplete(false);
      const next = editableWatch(normalizeWatch(result.watch));
      setOriginal(next);
      setDraft(next);
      queryClient.setQueryData(["watch", watchId], result.watch);
      await queryClient.invalidateQueries({ queryKey: ["watches"] });
    },
  });
  const runtimeAction = useMutation({
    mutationFn: async (action: "pause" | "resume" | "run") => {
      if (action === "pause") return api.watches.pause(watchId);
      if (action === "resume") return api.watches.resume(watchId);
      return api.watches.run(watchId);
    },
    onSuccess: async (_result, action) => {
      if (action === "resume") setApplyResult(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["watch", watchId] }),
        queryClient.invalidateQueries({ queryKey: ["watches"] }),
        queryClient.invalidateQueries({ queryKey: ["watch-runs", watchId] }),
      ]);
    },
  });
  const initialize = useMutation({
    mutationFn: (targetKeys: string[]) =>
      api.watches.initialize(watchId, targetKeys),
    onSuccess: async (run) => {
      const completed = run.status === "completed";
      setBaselineComplete(completed);
      setBaselineIssue(
        completed
          ? undefined
          : run.status === "failed"
            ? run.errorSummary ||
              "The baseline failed. Resolve the run error before resuming this watch."
            : "The baseline completed only partially. Review source failures and initialize the remaining targets before resuming.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["watch", watchId] }),
        queryClient.invalidateQueries({ queryKey: ["watch-runs", watchId] }),
        queryClient.invalidateQueries({
          queryKey: ["watch-coverage", watchId],
        }),
      ]);
    },
  });
  const presetApply = useMutation({
    mutationFn: () => api.presets.apply(selectedPreset, watchId),
    onSuccess: async (result) => {
      setPresetOpen(false);
      if (result.watch) {
        setApplyResult({
          watch: result.watch,
          diff: [],
          systemChanges: [],
          changed: result.applied,
          behaviorChanged: result.targetKeysRequiringInitialization.length > 0,
          paused: true,
          pausedByApply: false,
          resumeRequired: result.targetKeysRequiringInitialization.length > 0,
          targetKeysRequiringInitialization:
            result.targetKeysRequiringInitialization,
        });
        queryClient.setQueryData(["watch", watchId], result.watch);
      }
      await queryClient.invalidateQueries({ queryKey: ["watch", watchId] });
    },
  });

  if (!hasApiKey) {
    return (
      <div className="page">
        <MissingKeyBanner />
        <Panel>
          <EmptyState
            title="Unlock this watch profile"
            description="Add the admin API key in Settings for this browser tab before loading or editing persisted watch data."
          />
        </Panel>
      </div>
    );
  }
  if (watch.isError)
    return (
      <div className="page">
        <ErrorState error={watch.error} onRetry={() => watch.refetch()} />
      </div>
    );
  if (watch.isPending || !draft || !original)
    return (
      <div className="page">
        <LoadingState label="Loading watch profile" />
      </div>
    );

  return (
    <div className="page page--editor">
      <Link className="back-link" to="/watches">
        <ArrowLeft size={15} />
        All watches
      </Link>
      <header className="editor-header">
        <div>
          <div className="editor-header__title">
            <h1>{watch.data.name}</h1>
            <StatusBadge status={watch.data.enabled ? "active" : "paused"} />
          </div>
          <p>
            {watch.data.sourceTargets.length} targets · {watch.data.timezone} ·
            updated {relativeTime(watch.data.updatedAt)}
          </p>
        </div>
        <div className="editor-header__actions">
          <Button
            variant="ghost"
            onClick={() =>
              downloadJson(`${slug(watch.data.name)}.watch.json`, draft)
            }
          >
            <Download size={16} />
            Export
          </Button>
          <Button
            variant="secondary"
            title={
              watch.data.enabled
                ? "Pause this watch before applying a preset"
                : undefined
            }
            onClick={() => {
              setSelectedPreset(presets.data?.[0]?.id ?? "");
              setPresetOpen(true);
            }}
            disabled={!presets.data?.length || watch.data.enabled}
          >
            <Sparkles size={16} />
            Apply preset
          </Button>
          <Button
            variant="secondary"
            loading={runtimeAction.isPending || initialize.isPending}
            onClick={() => {
              if (watch.data.enabled) runtimeAction.mutate("pause");
              else if (needsBaseline)
                initialize.mutate(uninitializedTargetKeys);
              else runtimeAction.mutate("resume");
            }}
          >
            {watch.data.enabled ? (
              <CirclePause size={16} />
            ) : needsBaseline ? (
              <Sparkles size={16} />
            ) : (
              <CirclePlay size={16} />
            )}
            {watch.data.enabled
              ? "Pause"
              : needsBaseline
                ? "Initialize targets"
                : "Start watcher"}
          </Button>
          <Button
            onClick={() => setReviewOpen(true)}
            disabled={!diffs.length || errors.length > 0}
          >
            <FileDiff size={16} />
            Review changes
            {diffs.length ? (
              <span className="button-count">{diffs.length}</span>
            ) : null}
          </Button>
        </div>
      </header>

      {applyResult?.resumeRequired || needsBaseline ? (
        <div className="activation-banner">
          <span>
            <Target size={21} />
          </span>
          <div>
            <strong>
              {baselineComplete
                ? "Baseline complete — ready to resume"
                : "Changes applied safely; watcher remains paused"}
            </strong>
            <p>
              {baselineComplete
                ? "Review the latest baseline run, then explicitly resume when you’re ready for notifications."
                : `${(applyResult?.targetKeysRequiringInitialization ?? uninitializedTargetKeys).length} enabled targets need a no-notification baseline before this profile can resume.`}
            </p>
            <div className="target-key-list">
              {(
                applyResult?.targetKeysRequiringInitialization ??
                uninitializedTargetKeys
              )
                .slice(0, 8)
                .map((key) => (
                  <code key={key}>{key}</code>
                ))}
            </div>
          </div>
          {baselineComplete ? (
            <Button
              onClick={() => runtimeAction.mutate("resume")}
              loading={runtimeAction.isPending}
            >
              <CirclePlay size={16} />
              Resume watch
            </Button>
          ) : (
            <Button
              onClick={() =>
                initialize.mutate(
                  applyResult?.targetKeysRequiringInitialization ??
                    uninitializedTargetKeys,
                )
              }
              loading={initialize.isPending}
            >
              <Sparkles size={16} />
              Run safe baseline
            </Button>
          )}
        </div>
      ) : applyResult ? (
        <InlineNotice tone="success">
          Changes are live. This update did not require a new baseline.
        </InlineNotice>
      ) : null}
      {baselineIssue ? (
        <InlineNotice tone="danger" title="Baseline not complete">
          {baselineIssue}
        </InlineNotice>
      ) : null}
      <ErrorText
        error={apply.error ?? runtimeAction.error ?? initialize.error}
      />
      {errors.length ? (
        <InlineNotice tone="warning" title="Draft needs attention">
          {errors.join(" ")}
        </InlineNotice>
      ) : null}

      <div className="editor-tabs-wrap">
        <Tabs
          value={tab}
          onChange={(value) =>
            setSearchParams(value === "profile" ? {} : { tab: value })
          }
          tabs={TABS}
          label="Watch editor sections"
        />
        {diffs.length ? (
          <span className="unsaved-pill">
            <span />
            {diffs.length} unsaved {diffs.length === 1 ? "change" : "changes"}
          </span>
        ) : (
          <span className="saved-pill">
            <CheckCircle2 size={14} />
            Saved
          </span>
        )}
      </div>

      {tab === "profile" ? (
        <ProfileSection draft={draft} update={update} />
      ) : null}
      {tab === "sources" ? (
        <Panel>
          <PanelHeader
            title="Source targets"
            description="Assign a cadence, priority tier, company board, and search scope to every source."
          />
          <SourceTargetsEditor
            targets={draft.sourceTargets}
            sourceHealth={sourceHealth.data?.sources ?? []}
            defaultIntervalMinutes={draft.intervalMinutes}
            defaultCountryCodes={draft.countryCodes}
            defaultLocations={draft.locations}
            onChange={(targets) => update("sourceTargets", targets)}
          />
        </Panel>
      ) : null}
      {tab === "scoring" ? (
        <ScoringSection draft={draft} update={update} />
      ) : null}
      {tab === "notifications" ? (
        <Panel>
          <PanelHeader
            title="Notification routing"
            description="A match can reach multiple destinations, but overlapping rules never duplicate a delivery to the same channel."
          />
          <InlineNotice tone="info" title="Routing behavior">
            Rules use AND across tier, urgency, and score. If there are no
            routes, legacy channels continue receiving all eligible
            notifications.
          </InlineNotice>
          <NotificationRoutesEditor
            routes={draft.notificationRoutes ?? []}
            destinations={destinations.data ?? []}
            onChange={(routes) => update("notificationRoutes", routes)}
          />
          <div className="legacy-channels">
            <h3>Legacy fallback channels</h3>
            <p>
              Kept for compatibility. Use routing rules for precise delivery.
            </p>
            <TagInput
              label="Discord destination references"
              values={draft.notificationChannels
                .filter(({ type }) => type === "discord")
                .map(({ destinationRef }) => destinationRef)}
              onChange={(values) =>
                update(
                  "notificationChannels",
                  values.map((destinationRef) => ({
                    type: "discord",
                    destinationRef,
                  })),
                )
              }
              placeholder="default"
            />
          </div>
        </Panel>
      ) : null}
      {tab === "activity" ? <ActivitySection watch={watch.data} /> : null}
      {tab === "json" ? (
        <Panel>
          <PanelHeader
            title="Advanced JSON"
            description="Inspect, import, or download the exact API-compatible configuration."
          />
          <AdvancedJsonEditor
            draft={draft}
            watchName={draft.name}
            onImport={setDraft}
          />
        </Panel>
      ) : null}

      <ReviewChangesModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        diffs={diffs}
        errors={errors}
        behaviorChanging={hasBehaviorChanges}
        loading={apply.isPending}
        error={apply.error}
        onApply={() => apply.mutate()}
      />
      <PresetModal
        open={presetOpen}
        onClose={() => setPresetOpen(false)}
        presets={presets.data ?? []}
        selected={selectedPreset}
        onSelect={setSelectedPreset}
        preview={preview.data}
        loading={preview.isPending || presetApply.isPending}
        error={preview.error ?? presetApply.error}
        onApply={() => presetApply.mutate()}
      />
    </div>
  );
}

function ProfileSection({ draft, update }: EditorProps) {
  return (
    <div className="editor-section-grid">
      <Panel>
        <PanelHeader
          title="Profile details"
          description="The identity and default cadence for this watch."
        />
        <div className="form-stack">
          <Field label="Watch name">
            <input
              value={draft.name}
              maxLength={200}
              onChange={(event) => update("name", event.target.value)}
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={4}
              maxLength={2000}
              value={draft.description ?? ""}
              onChange={(event) =>
                update("description", event.target.value || null)
              }
            />
          </Field>
          <div className="form-grid form-grid--three">
            <Field label="Default interval">
              <div className="input-suffix">
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={draft.intervalMinutes}
                  onChange={(event) =>
                    update("intervalMinutes", Number(event.target.value))
                  }
                />
                <span>min</span>
              </div>
            </Field>
            <Field
              label="Cron schedule"
              hint="Optional; interval remains the fallback."
            >
              <input
                value={draft.schedule ?? ""}
                placeholder="*/30 * * * *"
                onChange={(event) =>
                  update("schedule", event.target.value || null)
                }
              />
            </Field>
            <Field label="Timezone">
              <input
                value={draft.timezone}
                onChange={(event) => update("timezone", event.target.value)}
              />
            </Field>
          </div>
          <InlineNotice tone="info">
            Pause and resume are explicit actions in the page header, so
            execution state is never hidden inside an Apply operation.
          </InlineNotice>
        </div>
      </Panel>
      <Panel>
        <PanelHeader
          title="Search intent"
          description="Plain-language terms become consistent watch JSON."
        />
        <div className="form-stack">
          <TagInput
            label="Search terms"
            values={draft.searchTerms}
            onChange={(values) => update("searchTerms", values)}
            placeholder="software engineer intern"
          />
          <div className="form-grid form-grid--two">
            <TagInput
              label="Required terms"
              values={draft.requiredTerms}
              onChange={(values) => update("requiredTerms", values)}
              placeholder="internship"
            />
            <TagInput
              label="Preferred terms"
              values={draft.preferredTerms}
              onChange={(values) => update("preferredTerms", values)}
              placeholder="TypeScript"
            />
          </div>
          <TagInput
            label="Excluded terms"
            values={draft.excludedTerms}
            onChange={(values) => update("excludedTerms", values)}
            placeholder="senior"
          />
          <TagInput
            label="Target companies"
            values={draft.companies}
            onChange={(values) => update("companies", values)}
            placeholder="Shopify"
          />
        </div>
      </Panel>
      <Panel>
        <PanelHeader
          title="Geography"
          description="Set watch-wide locations. Individual sources may override this scope."
        />
        <div className="form-stack">
          <TagInput
            label="Locations"
            values={draft.locations}
            onChange={(values) => update("locations", values)}
            placeholder="Toronto, Ontario"
          />
          <TagInput
            label="Country codes"
            values={draft.countryCodes}
            onChange={(values) =>
              update(
                "countryCodes",
                values.map((code) => code.toUpperCase()),
              )
            }
            placeholder="CA"
            hint="Use two-letter country codes."
          />
          <div className="choice-grid">
            {["remote", "hybrid", "on-site"].map((type) => (
              <label className="choice-card" key={type}>
                <input
                  type="checkbox"
                  checked={draft.allowedWorkplaceTypes.includes(type)}
                  onChange={(event) =>
                    update(
                      "allowedWorkplaceTypes",
                      event.target.checked
                        ? [...draft.allowedWorkplaceTypes, type]
                        : draft.allowedWorkplaceTypes.filter(
                            (item) => item !== type,
                          ),
                    )
                  }
                />
                <MapPin size={17} />
                <span>
                  <strong>{sentenceCase(type)}</strong>
                  <small>Allow this workplace type</small>
                </span>
              </label>
            ))}
          </div>
          <TagInput
            label="Employment types"
            values={draft.allowedEmploymentTypes}
            onChange={(values) => update("allowedEmploymentTypes", values)}
            placeholder="internship"
          />
        </div>
      </Panel>
      <Panel>
        <PanelHeader
          title="Initialization safety"
          description="Control what qualifies as recent when first enabling a source."
        />
        <div className="form-stack">
          <Field label="Initialization mode">
            <select
              value={draft.initializationMode}
              onChange={(event) =>
                update(
                  "initializationMode",
                  event.target.value as EditableWatch["initializationMode"],
                )
              }
            >
              <option value="baseline">
                Baseline · never alert on existing jobs
              </option>
              <option value="recent-only">
                Recent only · alert inside window
              </option>
              <option value="notify-all">Notify all · explicit opt-in</option>
            </select>
          </Field>
          <Field label="Recent window">
            <div className="input-suffix">
              <input
                type="number"
                min={1}
                max={10080}
                value={draft.recentWindowMinutes ?? 180}
                onChange={(event) =>
                  update("recentWindowMinutes", Number(event.target.value))
                }
              />
              <span>min</span>
            </div>
          </Field>
          <InlineNotice tone="warning">
            The GUI always uses a no-notification baseline after changes to
            sources, filters, scoring, or eligibility.
          </InlineNotice>
        </div>
      </Panel>
    </div>
  );
}

function ScoringSection({ draft, update }: EditorProps) {
  const weights = draft.weights ?? {};
  return (
    <div className="editor-section-grid">
      <Panel>
        <PanelHeader
          title="Notification thresholds"
          description="Scores are inclusive at each boundary."
        />
        <div className="threshold-stack">
          <Threshold
            value={draft.urgentScore}
            color="coral"
            label="Urgent"
            detail="Send immediately through urgent routes"
            onChange={(value) => update("urgentScore", value)}
          />
          <Threshold
            value={draft.minimumScore}
            color="blue"
            label="Standard"
            detail="Eligible for standard notification"
            onChange={(value) => update("minimumScore", value)}
          />
          <Threshold
            value={draft.digestScore}
            color="gold"
            label="Digest"
            detail="Collect for summary delivery"
            onChange={(value) => update("digestScore", value)}
          />
        </div>
      </Panel>
      <Panel>
        <PanelHeader
          title="Score weights"
          description="Tune how much each signal contributes to a match."
        />
        <div className="weight-grid">
          {[
            "role",
            "internship",
            "location",
            "company",
            "source",
            "skills",
          ].map((key) => (
            <Field label={sentenceCase(key)} key={key}>
              <div className="input-suffix">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={weights[key] ?? ""}
                  placeholder="Default"
                  onChange={(event) => {
                    const next = { ...weights };
                    if (event.target.value === "") delete next[key];
                    else next[key] = Number(event.target.value);
                    update("weights", next);
                  }}
                />
                <span>pts</span>
              </div>
            </Field>
          ))}
        </div>
      </Panel>
      <Panel className="editor-grid-span">
        <PanelHeader
          title="Threshold preview"
          description="A quick map of which delivery class each score enters."
        />
        <div className="score-preview" aria-label="Score threshold preview">
          <div style={{ width: `${Math.min(100, draft.digestScore)}%` }}>
            <span>Silent</span>
            <small>0–{Math.max(0, draft.digestScore - 1)}</small>
          </div>
          <div
            style={{
              width: `${Math.max(4, draft.minimumScore - draft.digestScore)}%`,
            }}
          >
            <span>Digest</span>
            <small>
              {draft.digestScore}–
              {Math.max(draft.digestScore, draft.minimumScore - 1)}
            </small>
          </div>
          <div
            style={{
              width: `${Math.max(4, draft.urgentScore - draft.minimumScore)}%`,
            }}
          >
            <span>Standard</span>
            <small>
              {draft.minimumScore}–
              {Math.max(draft.minimumScore, draft.urgentScore - 1)}
            </small>
          </div>
          <div className="is-urgent" style={{ flex: 1 }}>
            <span>Urgent</span>
            <small>{draft.urgentScore}+</small>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ActivitySection({ watch }: { watch: JobWatch }) {
  const metrics = useQuery({
    queryKey: ["watch-metrics", watch.id],
    queryFn: ({ signal }) => api.watches.metrics(watch.id, signal),
  });
  const coverage = useQuery({
    queryKey: ["watch-coverage", watch.id],
    queryFn: ({ signal }) => api.watches.coverage(watch.id, signal),
  });
  const runs = useQuery({
    queryKey: ["watch-runs", watch.id],
    queryFn: ({ signal }) => api.watches.runs(watch.id, { limit: 20 }, signal),
  });
  if (metrics.isPending || coverage.isPending || runs.isPending)
    return <LoadingState label="Loading activity" />;
  if (metrics.isError || coverage.isError || runs.isError)
    return <ErrorState error={metrics.error ?? coverage.error ?? runs.error} />;
  return (
    <div className="activity-layout">
      <section className="metric-grid metric-grid--four">
        <div className="activity-metric">
          <Target size={18} />
          <span>
            <strong>{metrics.data.jobsDiscoveredToday}</strong>
            <small>Matches today</small>
          </span>
        </div>
        <div className="activity-metric">
          <Bell size={18} />
          <span>
            <strong>{metrics.data.notificationsSent}</strong>
            <small>Notifications sent</small>
          </span>
        </div>
        <div className="activity-metric">
          <BarChart3 size={18} />
          <span>
            <strong>{metrics.data.applicationsSubmitted}</strong>
            <small>Applications tracked</small>
          </span>
        </div>
        <div className="activity-metric">
          <Gauge size={18} />
          <span>
            <strong>
              {coverage.data.summary.active}/{coverage.data.summary.configured}
            </strong>
            <small>Companies active</small>
          </span>
        </div>
      </section>
      <div className="editor-section-grid">
        <Panel>
          <PanelHeader
            title="Company coverage"
            description={`${coverage.data.summary.initialized} initialized · ${coverage.data.summary.degraded} degraded`}
          />
          {!coverage.data.companies.length ? (
            <EmptyState
              title="No company coverage"
              description="Add named companies or branded source targets to populate coverage."
            />
          ) : (
            <div className="coverage-list">
              {coverage.data.companies.slice(0, 12).map((company) => (
                <div key={company.company}>
                  <span>
                    <strong>{company.company}</strong>
                    <small>
                      {company.targetKeys.join(", ") || "No target"}
                    </small>
                  </span>
                  <StatusBadge
                    status={company.degraded ? "degraded" : company.status}
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel>
          <PanelHeader
            title="Match distribution"
            description={`${metrics.data.scope.matches} persisted matches`}
          />
          <div className="distribution-list">
            {Object.entries(metrics.data.matchesByScore).map(
              ([band, count]) => (
                <div key={band}>
                  <span>{sentenceCase(band)}</span>
                  <div>
                    <span
                      style={{
                        width: `${Math.max(3, (count / Math.max(1, metrics.data.scope.matches)) * 100)}%`,
                      }}
                    />
                  </div>
                  <strong>{count}</strong>
                </div>
              ),
            )}
          </div>
        </Panel>
        <Panel className="editor-grid-span">
          <PanelHeader
            title="Run history"
            description="Latest scheduler and manual executions."
          />
          {!runs.data.items.length ? (
            <EmptyState
              title="No runs yet"
              description="Initialize the watch or run it manually to create history."
            />
          ) : (
            <RunTable runs={runs.data.items} />
          )}
        </Panel>
      </div>
    </div>
  );
}

function RunTable({ runs }: { runs: WatchRun[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Started</th>
            <th>Status</th>
            <th>Sources</th>
            <th>Fetched</th>
            <th>Matches</th>
            <th>Sent</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{formatDate(run.startedAt)}</td>
              <td>
                <StatusBadge status={run.status} />
              </td>
              <td>
                {run.sourcesSucceeded.length}/{run.sourcesRequested.length}
              </td>
              <td>{run.jobsFetched}</td>
              <td>{run.matchesCreated}</td>
              <td>{run.notificationsSent}</td>
              <td>{duration(run.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Threshold({
  value,
  label,
  detail,
  color,
  onChange,
}: {
  value: number;
  label: string;
  detail: string;
  color: string;
  onChange(value: number): void;
}) {
  return (
    <label className="threshold">
      <span className={`threshold__mark threshold__mark--${color}`} />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <input
        type="number"
        min={0}
        max={500}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

interface EditorProps {
  draft: EditableWatch;
  update<K extends keyof EditableWatch>(
    field: K,
    value: EditableWatch[K],
  ): void;
}

function ReviewChangesModal({
  open,
  onClose,
  diffs,
  errors,
  behaviorChanging,
  loading,
  error,
  onApply,
}: {
  open: boolean;
  onClose(): void;
  diffs: DraftDiff[];
  errors: string[];
  behaviorChanging: boolean;
  loading: boolean;
  error: unknown;
  onApply(): void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="wide"
      title="Review changes"
      description="Nothing is written until you apply this exact field-level patch."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep editing
          </Button>
          <Button
            onClick={onApply}
            loading={loading}
            disabled={!diffs.length || Boolean(errors.length)}
          >
            <Save size={16} />
            Apply {diffs.length} changes
          </Button>
        </>
      }
    >
      {behaviorChanging ? (
        <InlineNotice tone="warning" title="A fresh baseline is required">
          This patch changes sources, filters, eligibility, or scoring. Applying
          it pauses the watch and resets enabled targets for safe
          initialization.
        </InlineNotice>
      ) : (
        <InlineNotice tone="success" title="Safe live update">
          These metadata, schedule, or routing changes can apply without a new
          baseline.
        </InlineNotice>
      )}
      <div className="diff-list">
        {diffs.map((diff) => (
          <article key={diff.path}>
            <header>
              <strong>{sentenceCase(diff.path)}</strong>
              {diff.behaviorChanging ? (
                <Badge tone="warning">Baseline</Badge>
              ) : (
                <Badge tone="success">Live</Badge>
              )}
            </header>
            <div>
              <span>
                <small>Before</small>
                <code>{diffValue(diff.before)}</code>
              </span>
              <span>
                <small>After</small>
                <code>{diffValue(diff.after)}</code>
              </span>
            </div>
          </article>
        ))}
      </div>
      <ErrorText error={error} />
    </Modal>
  );
}

function PresetModal({
  open,
  onClose,
  presets,
  selected,
  onSelect,
  preview,
  loading,
  error,
  onApply,
}: {
  open: boolean;
  onClose(): void;
  presets: Array<{
    id: string;
    name: string;
    version: number;
    description?: string;
  }>;
  selected: string;
  onSelect(value: string): void;
  preview?: import("../types").WatchPresetPreview;
  loading: boolean;
  error: unknown;
  onApply(): void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Preview a versioned preset"
      description="Preset application merges with operator-authored values and shows initialization impact."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onApply} loading={loading} disabled={!selected}>
            Apply preset
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <Field label="Preset">
          <select
            value={selected}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">Choose a preset</option>
            {presets.map((preset) => (
              <option value={preset.id} key={preset.id}>
                {preset.name} · v{preset.version}
              </option>
            ))}
          </select>
        </Field>
        {preview ? (
          <div className="preset-preview">
            <span>
              <Sparkles size={19} />
            </span>
            <div>
              <h3>{preview.preset.name}</h3>
              <p>
                Version {preview.preset.version} applies to the current paused
                watch; its preview shows merged fields and replaced geography.
              </p>
              {preview.targetKeysRequiringInitialization.length ? (
                <Badge tone="warning">
                  {preview.targetKeysRequiringInitialization.length} targets
                  need baseline
                </Badge>
              ) : (
                <Badge tone="success">No baseline impact</Badge>
              )}
              <pre>
                {JSON.stringify(
                  { fields: preview.fields, targets: preview.targets },
                  null,
                  2,
                )}
              </pre>
            </div>
          </div>
        ) : selected && loading ? (
          <LoadingState label="Building preset preview" />
        ) : null}
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

function normalizeWatch(watch: JobWatch): JobWatch {
  return {
    ...watch,
    notificationRoutes: watch.notificationRoutes ?? [],
    notificationChannels: watch.notificationChannels ?? [],
    sourceTargets: watch.sourceTargets ?? [],
    sources: watch.sources ?? [],
    sourceTiers: watch.sourceTiers ?? {},
    companySlugs: watch.companySlugs ?? [],
    companies: watch.companies ?? [],
    searchTerms: watch.searchTerms ?? [],
    requiredTerms: watch.requiredTerms ?? [],
    preferredTerms: watch.preferredTerms ?? [],
    excludedTerms: watch.excludedTerms ?? [],
    locations: watch.locations ?? [],
    countryCodes: watch.countryCodes ?? [],
    allowedWorkplaceTypes: watch.allowedWorkplaceTypes ?? [],
    allowedEmploymentTypes: watch.allowedEmploymentTypes ?? [],
  };
}

function diffValue(value: unknown): string {
  if (Array.isArray(value))
    return value.length
      ? `${value.length} items · ${JSON.stringify(value).slice(0, 110)}${JSON.stringify(value).length > 110 ? "…" : ""}`
      : "Empty";
  if (value && typeof value === "object") {
    const text = JSON.stringify(value);
    return `${Object.keys(value as Record<string, unknown>).length} fields · ${text.slice(0, 110)}${text.length > 110 ? "…" : ""}`;
  }
  return value === undefined ? "Not set" : JSON.stringify(value);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "watch"
  );
}
