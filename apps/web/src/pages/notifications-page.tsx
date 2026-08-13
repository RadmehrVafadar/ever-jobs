import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  Plus,
  RotateCw,
  Route,
  Send,
  Trash2,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { NotificationRoutesEditor } from "../components/notification-routes-editor";
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
  Pagination,
  Panel,
  PanelHeader,
  StatusBadge,
  Tabs,
} from "../components/ui";
import { useAuth } from "../context/auth-context";
import { formatDate, relativeTime, sentenceCase } from "../lib/format";
import { DestinationSummary, JobWatch, NotificationRoute } from "../types";

type NotificationTab = "destinations" | "routes" | "deliveries";

export function NotificationsPage() {
  const { hasApiKey } = useAuth();
  const [tab, setTab] = useState<NotificationTab>("destinations");
  const destinations = useQuery({
    queryKey: ["destinations"],
    queryFn: ({ signal }) => api.destinations.list(signal),
    enabled: hasApiKey,
  });
  const deliveries = useQuery({
    queryKey: ["deliveries", "count"],
    queryFn: ({ signal }) => api.notifications.deliveries({ limit: 1 }, signal),
    enabled: hasApiKey,
  });
  const failed = useQuery({
    queryKey: ["deliveries", "failed-count"],
    queryFn: ({ signal }) =>
      api.notifications.deliveries({ limit: 1, status: "failed" }, signal),
    enabled: hasApiKey,
  });

  return (
    <div className="page">
      {!hasApiKey ? <MissingKeyBanner /> : null}
      <PageHeader
        eyebrow="Delivery control"
        title="Notifications"
        description="Keep webhook secrets separate from routing logic, then verify exactly where every signal lands."
        actions={
          <Button variant="secondary" onClick={() => setTab("destinations")}>
            <Plus size={16} />
            Add Discord channel
          </Button>
        }
      />
      <section className="notification-summary">
        <div>
          <span>
            <KeyRound size={18} />
          </span>
          <strong>
            {destinations.data?.filter((item) => item.configured).length ?? 0}
          </strong>
          <small>Configured destinations</small>
        </div>
        <div>
          <span>
            <Send size={18} />
          </span>
          <strong>{deliveries.data?.total ?? 0}</strong>
          <small>Total delivery attempts</small>
        </div>
        <div className={failed.data?.total ? "has-failures" : ""}>
          <span>
            <Bell size={18} />
          </span>
          <strong>{failed.data?.total ?? 0}</strong>
          <small>Failed deliveries</small>
        </div>
      </section>
      <div className="editor-tabs-wrap">
        <Tabs
          value={tab}
          onChange={(value) => setTab(value as NotificationTab)}
          tabs={[
            {
              value: "destinations",
              label: "Destinations",
              count: destinations.data?.length,
            },
            { value: "routes", label: "Routing rules" },
            {
              value: "deliveries",
              label: "Delivery history",
              count: deliveries.data?.total,
            },
          ]}
          label="Notification sections"
        />
      </div>
      {!hasApiKey ? (
        <Panel>
          <EmptyState
            title="Unlock notification operations"
            description="Add the admin API key in Settings for this browser tab before loading destinations, routes, or delivery history."
          />
        </Panel>
      ) : (
        <>
          {tab === "destinations" ? (
            <DestinationsPanel query={destinations} />
          ) : null}
          {tab === "routes" ? (
            <RoutesPanel destinations={destinations.data ?? []} />
          ) : null}
          {tab === "deliveries" ? <DeliveriesPanel /> : null}
        </>
      )}
    </div>
  );
}

function DestinationsPanel({ query }: { query: DestinationQuery }) {
  const queryClient = useQueryClient();
  const watches = useQuery({
    queryKey: ["watches"],
    queryFn: ({ signal }) => api.watches.list(signal),
  });
  const [editor, setEditor] = useState<{ open: boolean; alias?: string }>({
    open: false,
  });
  const [feedback, setFeedback] = useState<string>();
  const remove = useMutation({
    mutationFn: api.destinations.remove,
    onSuccess: async (_result, alias) => {
      setFeedback(`Removed ${alias}.`);
      await queryClient.invalidateQueries({ queryKey: ["destinations"] });
    },
  });
  const test = useMutation({
    mutationFn: ({ alias, watchId }: { alias: string; watchId: string }) =>
      api.destinations.test(alias, watchId),
    onSuccess: (result, { alias }) =>
      setFeedback(
        result.ok
          ? `Test delivered to ${alias}.`
          : `The ${alias} test was not delivered.`,
      ),
  });
  return (
    <Panel>
      <PanelHeader
        title="Discord destinations"
        description="Aliases are safe to store in watch JSON. Webhook URLs remain server-side."
        action={
          <Button size="small" onClick={() => setEditor({ open: true })}>
            <Plus size={15} />
            Add destination
          </Button>
        }
      />
      <InlineNotice tone="info" title="Secrets stay out of PostgreSQL">
        Environment values take precedence and are read-only here. Locally
        managed values are written atomically to the ignored .env.local file and
        are never returned by the API.
      </InlineNotice>
      {feedback ? <InlineNotice tone="success">{feedback}</InlineNotice> : null}
      <ErrorText error={remove.error ?? test.error} />
      {query.isPending ? (
        <LoadingState label="Loading destinations" />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : !query.data?.length ? (
        <EmptyState
          title="No Discord destinations"
          description="Add a named channel to start building routing rules."
          action={
            <Button size="small" onClick={() => setEditor({ open: true })}>
              <Plus size={15} />
              Add channel
            </Button>
          }
        />
      ) : (
        <div className="destination-grid">
          {query.data.map((destination) => {
            const alias = destination.alias;
            const readOnly = destination.source === "environment";
            return (
              <article className="destination-card" key={alias}>
                <header>
                  <span>
                    <Bell size={19} />
                  </span>
                  <div>
                    <h3>{alias}</h3>
                    <p>Discord webhook</p>
                  </div>
                  <StatusBadge
                    status={
                      destination.configured ? "configured" : "unavailable"
                    }
                  />
                </header>
                <dl>
                  <div>
                    <dt>Configuration</dt>
                    <dd>
                      {readOnly ? (
                        <>
                          <LockKeyhole size={13} /> Environment
                        </>
                      ) : destination.source === "local" ? (
                        "Local .env"
                      ) : (
                        "Not configured"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Webhook</dt>
                    <dd>
                      {destination.configured
                        ? "Configured · value hidden"
                        : "Missing"}
                    </dd>
                  </div>
                </dl>
                <footer>
                  <Button
                    size="small"
                    variant="secondary"
                    disabled={!watches.data?.length}
                    title={
                      watches.data?.length
                        ? `Use ${watches.data[0].name} for the test message`
                        : "Create a watch before sending a test"
                    }
                    onClick={() =>
                      test.mutate({ alias, watchId: watches.data![0].id })
                    }
                    loading={test.isPending && test.variables?.alias === alias}
                  >
                    <Send size={14} />
                    Send test
                  </Button>
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => setEditor({ open: true, alias })}
                    disabled={readOnly}
                  >
                    <RotateCw size={14} />
                    Rotate
                  </Button>
                  <button
                    className="icon-button icon-button--danger"
                    aria-label={`Delete ${alias}`}
                    disabled={readOnly}
                    onClick={() =>
                      window.confirm(
                        `Delete destination “${alias}”? It must not be referenced by any watch.`,
                      ) && remove.mutate(alias)
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}
      <DestinationModal
        open={editor.open}
        existingAlias={editor.alias}
        onClose={() => setEditor({ open: false })}
      />
    </Panel>
  );
}

interface DestinationQuery {
  data?: DestinationSummary[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch(): unknown;
}

function DestinationModal({
  open,
  existingAlias,
  onClose,
}: {
  open: boolean;
  existingAlias?: string;
  onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [alias, setAlias] = useState(existingAlias ?? "");
  const [webhookUrl, setWebhookUrl] = useState("");
  useEffect(() => {
    setAlias(existingAlias ?? "");
    setWebhookUrl("");
  }, [existingAlias, open]);
  const validAlias = /^[a-z][a-z0-9-]{0,63}$/.test(alias);
  const validWebhook =
    /^https:\/\/(?:(?:canary|ptb)\.)?discord\.com\/api\/webhooks\//i.test(
      webhookUrl,
    );
  const save = useMutation({
    mutationFn: () => api.destinations.upsert(alias, webhookUrl),
    onSuccess: async () => {
      setWebhookUrl("");
      await queryClient.invalidateQueries({ queryKey: ["destinations"] });
      onClose();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (validAlias && validWebhook) save.mutate();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        existingAlias ? `Rotate ${existingAlias}` : "Add a Discord destination"
      }
      description="The webhook is sent once to the local API and is never read back into the browser."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="destination-form"
            loading={save.isPending}
            disabled={!validAlias || !validWebhook}
          >
            {existingAlias ? "Rotate secret" : "Save destination"}
          </Button>
        </>
      }
    >
      <form id="destination-form" className="form-stack" onSubmit={submit}>
        <Field
          label="Destination alias"
          hint="Lowercase letters, numbers, and hyphens. It maps to a DISCORD_WEBHOOK_* key."
        >
          <input
            autoFocus={!existingAlias}
            value={alias}
            disabled={Boolean(existingAlias)}
            onChange={(event) =>
              setAlias(
                event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
              )
            }
            placeholder="tier-one"
          />
        </Field>
        <Field
          label="Discord webhook URL"
          hint="Only approved HTTPS Discord webhook hosts are accepted."
        >
          <input
            autoFocus={Boolean(existingAlias)}
            type="password"
            autoComplete="off"
            value={webhookUrl}
            onChange={(event) => setWebhookUrl(event.target.value)}
            placeholder="https://discord.com/api/webhooks/…"
          />
        </Field>
        {webhookUrl && !validWebhook ? (
          <InlineNotice tone="warning">
            Enter a valid HTTPS Discord webhook URL.
          </InlineNotice>
        ) : null}
        <ErrorText error={save.error} />
      </form>
    </Modal>
  );
}

function RoutesPanel({ destinations }: { destinations: DestinationSummary[] }) {
  const queryClient = useQueryClient();
  const watches = useQuery({
    queryKey: ["watches"],
    queryFn: ({ signal }) => api.watches.list(signal),
  });
  const [watchId, setWatchId] = useState("");
  const selected =
    watches.data?.find((watch) => watch.id === watchId) ?? watches.data?.[0];
  const [routes, setRoutes] = useState<NotificationRoute[]>([]);
  useEffect(() => {
    if (selected) {
      setWatchId(selected.id);
      setRoutes(selected.notificationRoutes ?? []);
    }
  }, [selected?.id, selected?.updatedAt]);
  const dirty = useMemo(
    () =>
      JSON.stringify(routes) !==
      JSON.stringify(selected?.notificationRoutes ?? []),
    [routes, selected],
  );
  const save = useMutation({
    mutationFn: () =>
      api.watches.apply(selected!.id, selected!.updatedAt, {
        notificationRoutes: routes,
      }),
    onSuccess: async () =>
      queryClient.invalidateQueries({ queryKey: ["watches"] }),
  });
  if (watches.isPending) return <LoadingState label="Loading watch routes" />;
  if (watches.isError) return <ErrorState error={watches.error} />;
  if (!watches.data.length)
    return (
      <EmptyState
        title="No watches configured"
        description="Create a watch before adding routing rules."
        action={
          <Link className="button button--primary button--small" to="/watches">
            Create watch
          </Link>
        }
      />
    );
  return (
    <Panel>
      <PanelHeader
        title="Routing rules"
        description="Choose a watch, then send tiers, urgency classes, and score bands to named destinations."
        action={
          <Button
            size="small"
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!dirty}
          >
            <Route size={15} />
            Save routes
          </Button>
        }
      />
      <div className="route-watch-select">
        <Field label="Watch">
          <select
            value={selected?.id}
            onChange={(event) => setWatchId(event.target.value)}
          >
            {watches.data.map((watch) => (
              <option value={watch.id} key={watch.id}>
                {watch.name}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <StatusBadge status={selected?.enabled ? "active" : "paused"} />
          <span>
            {routes.length} rules ·{" "}
            {routes.filter((route) => route.enabled).length} enabled
          </span>
        </div>
      </div>
      {save.isSuccess ? (
        <InlineNotice tone="success">
          Routing changes are live and did not require a source baseline.
        </InlineNotice>
      ) : null}
      <ErrorText error={save.error} />
      <NotificationRoutesEditor
        routes={routes}
        destinations={destinations}
        onChange={setRoutes}
      />
    </Panel>
  );
}

function DeliveriesPanel() {
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({
    status: "",
    notificationType: "",
    channel: "",
  });
  const deliveries = useQuery({
    queryKey: ["deliveries", filters, offset],
    queryFn: ({ signal }) =>
      api.notifications.deliveries({ ...filters, offset, limit: 30 }, signal),
  });
  return (
    <Panel>
      <PanelHeader
        title="Delivery history"
        description="Sanitized outcomes from the durable notification outbox."
      />
      <div className="filter-bar">
        <Field label="Status">
          <select
            value={filters.status}
            onChange={(event) => {
              setOffset(0);
              setFilters({ ...filters, status: event.target.value });
            }}
          >
            <option value="">All statuses</option>
            {["pending", "sent", "failed", "suppressed"].map((status) => (
              <option value={status} key={status}>
                {sentenceCase(status)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Urgency">
          <select
            value={filters.notificationType}
            onChange={(event) => {
              setOffset(0);
              setFilters({ ...filters, notificationType: event.target.value });
            }}
          >
            <option value="">All types</option>
            {["urgent", "standard", "digest"].map((type) => (
              <option value={type} key={type}>
                {sentenceCase(type)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Provider">
          <select
            value={filters.channel}
            onChange={(event) => {
              setOffset(0);
              setFilters({ ...filters, channel: event.target.value });
            }}
          >
            <option value="">All providers</option>
            <option value="discord">Discord</option>
            <option value="telegram">Telegram</option>
            <option value="webhook">Webhook</option>
          </select>
        </Field>
      </div>
      {deliveries.isPending ? (
        <LoadingState label="Loading delivery history" />
      ) : deliveries.isError ? (
        <ErrorState
          error={deliveries.error}
          onRetry={() => deliveries.refetch()}
        />
      ) : !deliveries.data.items.length ? (
        <EmptyState
          title="No deliveries match"
          description="Try a broader filter or wait for an eligible job match."
        />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Destination</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.data.items.map((delivery) => (
                  <tr key={delivery.id}>
                    <td>
                      <div className="primary-cell">
                        <strong>{formatDate(delivery.createdAt)}</strong>
                        <span>{relativeTime(delivery.createdAt)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="primary-cell">
                        <strong>{delivery.destinationRef}</strong>
                        <span>{delivery.provider}</span>
                      </div>
                    </td>
                    <td>
                      <Badge
                        tone={
                          delivery.notificationType === "urgent"
                            ? "accent"
                            : "neutral"
                        }
                      >
                        {delivery.notificationType}
                      </Badge>
                    </td>
                    <td>
                      <StatusBadge status={delivery.status} />
                    </td>
                    <td>{delivery.attemptCount}</td>
                    <td className="delivery-error">
                      {delivery.errorMessage ||
                        (delivery.sentAt
                          ? `Sent ${relativeTime(delivery.sentAt)}`
                          : delivery.nextAttemptAt
                            ? `Retry ${formatDate(delivery.nextAttemptAt)}`
                            : "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            offset={deliveries.data.offset}
            limit={deliveries.data.limit}
            total={deliveries.data.total}
            onChange={setOffset}
          />
        </>
      )}
    </Panel>
  );
}
