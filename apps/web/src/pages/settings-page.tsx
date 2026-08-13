import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Laptop,
  LockKeyhole,
  PlugZap,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Unplug,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import {
  Button,
  EmptyState,
  ErrorState,
  ErrorText,
  Field,
  InlineNotice,
  PageHeader,
  Panel,
  PanelHeader,
  StatusBadge,
} from "../components/ui";
import { useAuth } from "../context/auth-context";
import { duration, percentage, sentenceCase } from "../lib/format";

export function SettingsPage() {
  const { apiKey, hasApiKey, saveApiKey, clearApiKey } = useAuth();
  const queryClient = useQueryClient();
  const [draftKey, setDraftKey] = useState(apiKey);
  const [visible, setVisible] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraftKey(apiKey), [apiKey]);
  const connection = useMutation({ mutationFn: () => api.watches.list() });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    saveApiKey(draftKey);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2_000);
    await queryClient.invalidateQueries();
    connection.mutate();
  };
  const clear = async () => {
    clearApiKey();
    setDraftKey("");
    connection.reset();
    await queryClient.invalidateQueries();
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Local workspace"
        title="Settings"
        description="Manage this browser tab’s operator access and inspect the local service topology."
      />
      <div className="settings-layout">
        <Panel>
          <PanelHeader
            title="Admin API key"
            description="Required for watches, destinations, notification history, and source controls."
          />
          <div className="security-callout">
            <span>
              <LockKeyhole size={21} />
            </span>
            <div>
              <strong>Session-only by design</strong>
              <p>
                The key is held in sessionStorage for this browser tab. It is
                never included in exported JSON or application records, and
                disappears when the tab session ends.
              </p>
            </div>
          </div>
          <form className="key-form" onSubmit={submit}>
            <Field label="API key">
              <div className="password-input">
                <KeyRound size={16} />
                <input
                  type={visible ? "text" : "password"}
                  autoComplete="off"
                  value={draftKey}
                  onChange={(event) => setDraftKey(event.target.value)}
                  placeholder="Paste your configured admin key"
                />
                <button
                  type="button"
                  aria-label={visible ? "Hide API key" : "Show API key"}
                  onClick={() => setVisible((value) => !value)}
                >
                  {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </Field>
            <div className="key-form__footer">
              <div>
                {hasApiKey ? (
                  <StatusBadge
                    status="configured"
                    label="Key stored for this tab"
                  />
                ) : (
                  <StatusBadge status="unavailable" label="No key stored" />
                )}
                {connection.isSuccess ? (
                  <StatusBadge
                    status="healthy"
                    label={`Connected · ${connection.data.length} watches`}
                  />
                ) : null}
              </div>
              <div>
                {hasApiKey ? (
                  <Button type="button" variant="danger" onClick={clear}>
                    <Trash2 size={15} />
                    Clear key
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  disabled={!draftKey.trim()}
                  loading={connection.isPending}
                >
                  {saved ? <CheckCircle2 size={16} /> : <KeyRound size={16} />}
                  {saved ? "Saved" : "Save & test"}
                </Button>
              </div>
            </div>
            <ErrorText error={connection.error} />
          </form>
        </Panel>

        <Panel>
          <PanelHeader
            title="Local service map"
            description="The one-command GUI stack binds every operator surface to loopback."
          />
          <div className="topology-list">
            <Topology
              port="3000"
              name="Operator GUI"
              detail="This React application"
              status="healthy"
            />
            <Topology
              port="3001"
              name="API & MCP host"
              detail="Search, analytics, watches"
              status="healthy"
            />
            <Topology
              port="3002"
              name="Watcher worker"
              detail="Scheduler and delivery health"
              status="unknown"
            />
            <Topology
              port="5432"
              name="PostgreSQL"
              detail="Durable watcher state"
              status="unknown"
            />
          </div>
          <InlineNotice tone="info">
            The GUI controls persisted watch state. Start watcher means resume a
            profile; the browser never spawns or restarts the worker.
          </InlineNotice>
        </Panel>

        <Panel className="settings-layout__wide">
          <SourceRegistry />
        </Panel>

        <Panel>
          <PanelHeader title="Security posture" />
          <div className="settings-checklist">
            <div>
              <ShieldCheck size={18} />
              <span>
                <strong>Loopback binding</strong>
                <small>Not exposed on the network by default</small>
              </span>
            </div>
            <div>
              <KeyRound size={18} />
              <span>
                <strong>Authenticated mutations</strong>
                <small>Admin routes require x-api-key</small>
              </span>
            </div>
            <div>
              <LockKeyhole size={18} />
              <span>
                <strong>Secret isolation</strong>
                <small>Webhook values never enter PostgreSQL</small>
              </span>
            </div>
            <div>
              <Laptop size={18} />
              <span>
                <strong>Single operator</strong>
                <small>No accounts or remote access in this release</small>
              </span>
            </div>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Developer references"
            description="Open the generated local API documentation."
          />
          <div className="reference-links">
            <a
              href="http://127.0.0.1:3001/docs"
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <BookOpen size={18} />
              </span>
              <div>
                <strong>API reference</strong>
                <small>Scalar · interactive REST contracts</small>
              </div>
              <ExternalLink size={15} />
            </a>
            <a
              href="http://127.0.0.1:3001/swg"
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <BookOpen size={18} />
              </span>
              <div>
                <strong>OpenAPI explorer</strong>
                <small>Swagger UI · schemas and examples</small>
              </div>
              <ExternalLink size={15} />
            </a>
            <a
              href="http://127.0.0.1:3001/graphql"
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <PlugZap size={18} />
              </span>
              <div>
                <strong>GraphQL endpoint</strong>
                <small>API query surface</small>
              </div>
              <ExternalLink size={15} />
            </a>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SourceRegistry() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const health = useQuery({
    queryKey: ["source-health"],
    queryFn: ({ signal }) => api.sources.health(signal),
  });
  const action = useMutation({
    mutationFn: ({
      site,
      action,
    }: {
      site: string;
      action: "open" | "reset";
    }) =>
      action === "open"
        ? api.sources.openCircuit(site)
        : api.sources.resetCircuit(site),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["source-health"] }),
  });
  const rows =
    health.data?.sources.filter(({ site }) =>
      site.toLowerCase().includes(filter.toLowerCase()),
    ) ?? [];
  return (
    <>
      <PanelHeader
        title="Source registry & circuits"
        description="Inspect per-process source health and reset a circuit after resolving an upstream issue."
        action={
          <Field label="Filter sources">
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search source ID"
            />
          </Field>
        }
      />
      {health.isPending ? (
        <div className="source-registry-loading">Loading source registry…</div>
      ) : health.isError ? (
        <ErrorState error={health.error} />
      ) : !rows.length ? (
        <EmptyState
          title="No source health rows"
          description="The API did not report any registered sources."
        />
      ) : (
        <div className="table-wrap source-registry">
          <table>
            <thead>
              <tr>
                <th>Source</th>
                <th>State</th>
                <th>Success</th>
                <th>p95 latency</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((source) => (
                <tr key={source.site}>
                  <td>
                    <strong>{source.site}</strong>
                  </td>
                  <td>
                    <StatusBadge status={source.state} />
                  </td>
                  <td>{percentage(source.successRate)}</td>
                  <td>{duration(source.p95LatencyMs)}</td>
                  <td>
                    <Button
                      size="small"
                      variant={source.state === "open" ? "primary" : "ghost"}
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          site: source.site,
                          action: source.state === "open" ? "reset" : "open",
                        })
                      }
                    >
                      {source.state === "open" ? (
                        <RotateCcw size={14} />
                      ) : (
                        <Unplug size={14} />
                      )}
                      {source.state === "open" ? "Reset" : "Force open"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorText error={action.error} />
    </>
  );
}

function Topology({
  port,
  name,
  detail,
  status,
}: {
  port: string;
  name: string;
  detail: string;
  status: string;
}) {
  return (
    <div>
      <span className="topology-list__line">
        <CircleDot size={17} />
      </span>
      <code>{port}</code>
      <span>
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>
      <StatusBadge
        status={status}
        label={status === "unknown" ? "Runtime check" : "Connected"}
      />
    </div>
  );
}
