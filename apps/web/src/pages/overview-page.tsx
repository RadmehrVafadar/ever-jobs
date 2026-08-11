import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  BellRing,
  Database,
  Clock3,
  Radar,
  Search,
  Server,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/auth-context";
import { compactNumber, formatDate, relativeTime } from "../lib/format";
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  MetricCard,
  MissingKeyBanner,
  PageHeader,
  Panel,
  PanelHeader,
  StatusBadge,
} from "../components/ui";

export function OverviewPage() {
  const { hasApiKey } = useAuth();
  const apiHealth = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => api.health(signal),
    refetchInterval: 30_000,
    retry: 1,
  });
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: ({ signal }) => api.overview(signal),
    enabled: hasApiKey,
    refetchInterval: 30_000,
  });
  const watches = useQuery({
    queryKey: ["watches"],
    queryFn: ({ signal }) => api.watches.list(signal),
    enabled: hasApiKey,
  });
  const deliveries = useQuery({
    queryKey: ["deliveries", "overview"],
    queryFn: ({ signal }) => api.notifications.deliveries({ limit: 6 }, signal),
    enabled: hasApiKey,
  });
  const primaryWatch =
    watches.data?.find((watch) => watch.enabled) ?? watches.data?.[0];
  const matches = useQuery({
    queryKey: ["matches", primaryWatch?.id, "overview"],
    queryFn: ({ signal }) =>
      api.watches.matches(primaryWatch!.id, { limit: 6 }, signal),
    enabled: Boolean(primaryWatch && hasApiKey),
  });
  const activeWatches = watches.data?.filter((watch) => watch.enabled) ?? [];
  const failedDeliveries =
    deliveries.data?.items.filter((delivery) => delivery.status === "failed")
      .length ?? 0;
  const tierOneDegraded =
    overview.data?.sourceCoverage.tier1Degraded ||
    watches.data?.some((watch) =>
      Object.values(watch.targetHealth ?? {}).some(
        (target) => target.tier === 1 && target.consecutiveHardFailures >= 3,
      ),
    );
  const apiStatus = apiHealth.isError
    ? "unavailable"
    : (overview.data?.api.status ?? apiHealth.data?.status ?? "unknown");

  return (
    <div className="page page--overview">
      {!hasApiKey ? <MissingKeyBanner /> : null}
      <PageHeader
        eyebrow="Local operator console"
        title="Your job signal, at a glance"
        description="Keep every watch, source, and delivery path in view without reaching for the command line."
        actions={
          <>
            <Link
              className="button button--secondary button--medium"
              to="/search"
            >
              <Search size={16} />
              Run a search
            </Link>
            <Link
              className="button button--primary button--medium"
              to="/watches"
            >
              Manage watches
              <ArrowRight size={16} />
            </Link>
          </>
        }
      />

      {tierOneDegraded ? (
        <div className="degraded-banner" role="alert">
          <span>
            <TriangleAlert size={20} />
          </span>
          <div>
            <strong>Tier 1 coverage needs attention</strong>
            <p>
              One or more priority targets have failed three consecutive checks.
            </p>
          </div>
          <Link to="/watches">
            Review coverage <ArrowRight size={15} />
          </Link>
        </div>
      ) : null}

      <section className="health-strip" aria-label="Service health">
        <HealthItem
          icon={<Server size={18} />}
          label="API"
          status={apiStatus}
        />
        <HealthItem
          icon={<Database size={18} />}
          label="Database"
          status={overview.data?.database.status ?? "unknown"}
        />
        <HealthItem
          icon={<Activity size={18} />}
          label="Worker"
          status={overview.data?.worker.status ?? "unknown"}
        />
        <HealthItem
          icon={<Clock3 size={18} />}
          label="Scheduler"
          status={overview.data?.scheduler.status ?? "unknown"}
        />
        <HealthItem
          icon={<BellRing size={18} />}
          label="Discord"
          status={overview.data?.notifications.status ?? "unknown"}
        />
        <HealthItem
          icon={<ShieldCheck size={18} />}
          label="Coverage"
          status={overview.data?.sourceCoverage.status ?? "unknown"}
        />
      </section>

      <section className="metric-grid" aria-label="Workspace totals">
        <MetricCard
          label="Active watches"
          value={compactNumber(
            overview.data?.counts?.activeWatches ?? activeWatches.length,
          )}
          detail={`${watches.data?.length ?? 0} configured`}
          icon={<Radar size={18} />}
        />
        <MetricCard
          label="Recent matches"
          value={compactNumber(
            overview.data?.counts?.recentMatches ?? matches.data?.total ?? 0,
          )}
          detail={
            primaryWatch ? `From ${primaryWatch.name}` : "No watch selected"
          }
          icon={<Search size={18} />}
        />
        <MetricCard
          label="Delivery failures"
          value={compactNumber(
            overview.data?.counts?.failedDeliveries ?? failedDeliveries,
          )}
          detail={
            failedDeliveries
              ? "Review notification history"
              : "No failures in this view"
          }
          icon={<BellRing size={18} />}
          tone={failedDeliveries ? "danger" : "success"}
        />
        <MetricCard
          label="Next scheduled run"
          value={nextRunLabel(activeWatches)}
          detail={nextRunName(activeWatches)}
          icon={<Clock3 size={18} />}
        />
      </section>

      <div className="overview-grid">
        <Panel className="overview-grid__wide">
          <PanelHeader
            title="Active watches"
            description="Persisted profiles currently eligible for automatic runs."
            action={
              <Link className="text-link" to="/watches">
                View all <ArrowRight size={14} />
              </Link>
            }
          />
          {!hasApiKey ? (
            <EmptyState
              title="Unlock watch controls"
              description="Add your admin API key in Settings to load persisted watches."
            />
          ) : watches.isPending ? (
            <LoadingState label="Loading watches" />
          ) : watches.isError ? (
            <ErrorState
              error={watches.error}
              onRetry={() => watches.refetch()}
            />
          ) : !activeWatches.length ? (
            <EmptyState
              title="No active watches"
              description="Create or resume a watch to start collecting job signals."
              action={
                <Link
                  className="button button--primary button--small"
                  to="/watches"
                >
                  Set up a watch
                </Link>
              }
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Watch</th>
                    <th>Sources</th>
                    <th>Last run</th>
                    <th>Next run</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {activeWatches.slice(0, 6).map((watch) => (
                    <tr key={watch.id}>
                      <td>
                        <div className="primary-cell">
                          <strong>{watch.name}</strong>
                          <span>{watch.description || "No description"}</span>
                        </div>
                      </td>
                      <td>
                        <span className="source-count">
                          {
                            watch.sourceTargets.filter(
                              (target) => target.enabled,
                            ).length
                          }
                        </span>
                      </td>
                      <td>{relativeTime(watch.lastRunAt)}</td>
                      <td>
                        {watch.nextRunAt
                          ? formatDate(watch.nextRunAt)
                          : "Not scheduled"}
                      </td>
                      <td>
                        <Link
                          className="row-link"
                          aria-label={`Open ${watch.name}`}
                          to={`/watches/${watch.id}`}
                        >
                          <ArrowRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Notification pulse"
            description="The latest delivery attempts across all routes."
            action={
              <Link className="text-link" to="/notifications">
                History
              </Link>
            }
          />
          {!hasApiKey ? (
            <EmptyState
              title="Delivery history is locked"
              description="Add your admin API key to see sanitized notification outcomes."
            />
          ) : deliveries.isPending ? (
            <LoadingState label="Loading deliveries" />
          ) : deliveries.isError ? (
            <ErrorState
              error={deliveries.error}
              onRetry={() => deliveries.refetch()}
            />
          ) : !deliveries.data.items.length ? (
            <EmptyState
              title="No deliveries yet"
              description="Delivery attempts will appear after an initialized watch detects a match."
            />
          ) : (
            <div className="activity-list">
              {deliveries.data.items.map((delivery) => (
                <div className="activity-row" key={delivery.id}>
                  <span
                    className={`activity-row__mark activity-row__mark--${delivery.status}`}
                  />
                  <div>
                    <strong>{delivery.destinationRef}</strong>
                    <span>
                      {delivery.notificationType} · attempt{" "}
                      {delivery.attemptCount}
                    </span>
                  </div>
                  <div>
                    <StatusBadge status={delivery.status} />
                    <time>{relativeTime(delivery.createdAt)}</time>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel className="overview-grid__wide">
          <PanelHeader
            title="Latest matches"
            description={
              primaryWatch
                ? `Most recent signals from ${primaryWatch.name}.`
                : "Select a watch to see matches."
            }
            action={
              <Link className="text-link" to="/matches">
                Open workspace <ArrowRight size={14} />
              </Link>
            }
          />
          {!primaryWatch ? (
            <EmptyState
              title="No watch to inspect"
              description="Create a watch and initialize its targets to collect matches."
            />
          ) : matches.isPending ? (
            <LoadingState label="Loading matches" />
          ) : matches.isError ? (
            <ErrorState
              error={matches.error}
              onRetry={() => matches.refetch()}
            />
          ) : !matches.data.items.length ? (
            <EmptyState
              title="No matches yet"
              description="This watch has not produced any eligible matches."
            />
          ) : (
            <div className="match-card-grid">
              {matches.data.items.map((match) => (
                <article className="match-compact" key={match.id}>
                  <div>
                    <strong>{match.score}</strong>
                    <span>score</span>
                  </div>
                  <section>
                    <p>{match.sourceTargetKey || "Unattributed source"}</p>
                    <small>
                      {match.matchedTerms.slice(0, 3).join(" · ") ||
                        "No matched terms recorded"}
                    </small>
                  </section>
                  <Badge tone={match.score >= 80 ? "accent" : "info"}>
                    {match.status}
                  </Badge>
                </article>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function HealthItem({
  icon,
  label,
  status,
}: {
  icon: ReactNode;
  label: string;
  status: string;
}) {
  return (
    <div className="health-item">
      <span className="health-item__icon">{icon}</span>
      <span>
        <small>{label}</small>
        <strong>{status === "unknown" ? "Waiting" : status}</strong>
      </span>
      <StatusBadge status={status} label="" />
    </div>
  );
}

function sortedNextRuns(
  watches: Array<{ nextRunAt?: string | null; name: string }>,
) {
  return watches
    .filter((watch) => watch.nextRunAt)
    .sort(
      (left, right) =>
        new Date(left.nextRunAt!).getTime() -
        new Date(right.nextRunAt!).getTime(),
    );
}

function nextRunLabel(
  watches: Array<{ nextRunAt?: string | null; name: string }>,
): string {
  const next = sortedNextRuns(watches)[0];
  return next ? relativeTime(next.nextRunAt) : "Not scheduled";
}

function nextRunName(
  watches: Array<{ nextRunAt?: string | null; name: string }>,
): string {
  return sortedNextRuns(watches)[0]?.name ?? "Resume a watch to schedule it";
}
