import { Plus, Route, Trash2 } from "lucide-react";
import { type ReactNode } from "react";
import {
  DestinationSummary,
  NotificationRoute,
  NotificationType,
} from "../types";
import { blankRoute } from "../lib/watch-draft";
import { Badge, Button, Field, Toggle } from "./ui";

const TIERS = [1, 2, 3] as const;
const TYPES: NotificationType[] = ["urgent", "standard", "digest"];

export function NotificationRoutesEditor({
  routes,
  destinations = [],
  onChange,
  compact = false,
}: {
  routes: NotificationRoute[];
  destinations?: DestinationSummary[];
  onChange(routes: NotificationRoute[]): void;
  compact?: boolean;
}) {
  const update = (index: number, patch: Partial<NotificationRoute>) => {
    onChange(
      routes.map((route, routeIndex) =>
        routeIndex === index ? { ...route, ...patch } : route,
      ),
    );
  };
  const updateConditions = (
    index: number,
    patch: Partial<NonNullable<NotificationRoute["conditions"]>>,
  ) => {
    const route = routes[index];
    const conditions = { ...(route.conditions ?? {}), ...patch };
    const clean = Object.fromEntries(
      Object.entries(conditions).filter(
        ([, value]) =>
          value !== undefined && (!Array.isArray(value) || value.length),
      ),
    );
    update(index, { conditions: clean });
  };

  return (
    <div className={`routes-editor ${compact ? "routes-editor--compact" : ""}`}>
      {!routes.length ? (
        <div className="routes-empty">
          <span>
            <Route size={20} />
          </span>
          <div>
            <strong>No conditional routes</strong>
            <p>
              Without routes, legacy notification channels keep receiving every
              eligible match.
            </p>
          </div>
        </div>
      ) : null}
      {routes.map((route, index) => (
        <article className="route-card" key={route.id}>
          <header>
            <div className="route-card__ordinal">{index + 1}</div>
            <div>
              <strong>{route.name || "Untitled route"}</strong>
              <span>
                Rules combine with AND; choices inside a rule combine with OR.
              </span>
            </div>
            <Badge tone={route.enabled ? "success" : "neutral"}>
              {route.enabled ? "Enabled" : "Disabled"}
            </Badge>
            <button
              type="button"
              className="icon-button icon-button--danger"
              aria-label={`Remove route ${route.name}`}
              onClick={() =>
                window.confirm(`Remove route “${route.name}”?`) &&
                onChange(routes.filter((_, routeIndex) => routeIndex !== index))
              }
            >
              <Trash2 size={16} />
            </button>
          </header>
          <div className="route-card__body">
            <div className="form-grid form-grid--three">
              <Field label="Route name">
                <input
                  value={route.name}
                  maxLength={200}
                  onChange={(event) =>
                    update(index, { name: event.target.value })
                  }
                />
              </Field>
              <Field label="Provider">
                <select
                  value={route.provider}
                  onChange={(event) =>
                    update(index, {
                      provider: event.target
                        .value as NotificationRoute["provider"],
                    })
                  }
                >
                  <option value="discord">Discord</option>
                  <option value="telegram">Telegram</option>
                  <option value="webhook">Webhook</option>
                </select>
              </Field>
              <Field label="Destination">
                <input
                  list={`destinations-${route.id}`}
                  value={route.destinationRef}
                  onChange={(event) =>
                    update(index, { destinationRef: event.target.value })
                  }
                  placeholder="default"
                />
                <datalist id={`destinations-${route.id}`}>
                  {destinations.map((destination) => (
                    <option value={destination.alias} key={destination.alias} />
                  ))}
                </datalist>
              </Field>
            </div>
            <div className="route-rules">
              <RuleGroup
                label="Source tiers"
                description="Match any selected tier"
              >
                {TIERS.map((tier) => (
                  <label className="check-chip" key={tier}>
                    <input
                      type="checkbox"
                      checked={
                        route.conditions?.sourceTiers?.includes(tier) ?? false
                      }
                      onChange={(event) => {
                        const current = route.conditions?.sourceTiers ?? [];
                        updateConditions(index, {
                          sourceTiers: event.target.checked
                            ? [...current, tier].sort()
                            : current.filter((item) => item !== tier),
                        });
                      }}
                    />
                    Tier {tier}
                  </label>
                ))}
              </RuleGroup>
              <RuleGroup
                label="Notification type"
                description="Match any selected urgency"
              >
                {TYPES.map((type) => (
                  <label className="check-chip" key={type}>
                    <input
                      type="checkbox"
                      checked={
                        route.conditions?.notificationTypes?.includes(type) ??
                        false
                      }
                      onChange={(event) => {
                        const current =
                          route.conditions?.notificationTypes ?? [];
                        updateConditions(index, {
                          notificationTypes: event.target.checked
                            ? [...current, type]
                            : current.filter((item) => item !== type),
                        });
                      }}
                    />
                    {type}
                  </label>
                ))}
              </RuleGroup>
              <div className="score-range">
                <Field label="Minimum score">
                  <input
                    type="number"
                    min={0}
                    max={500}
                    placeholder="Any"
                    value={route.conditions?.minimumScore ?? ""}
                    onChange={(event) =>
                      updateConditions(index, {
                        minimumScore:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </Field>
                <span>to</span>
                <Field label="Maximum score">
                  <input
                    type="number"
                    min={0}
                    max={500}
                    placeholder="Any"
                    value={route.conditions?.maximumScore ?? ""}
                    onChange={(event) =>
                      updateConditions(index, {
                        maximumScore:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </Field>
              </div>
            </div>
            <Toggle
              checked={route.enabled}
              onChange={(enabled) => update(index, { enabled })}
              label="Route enabled"
              description="Disabled routes remain saved but do not receive matches."
            />
          </div>
        </article>
      ))}
      <Button
        variant="secondary"
        size="small"
        onClick={() => onChange([...routes, blankRoute()])}
      >
        <Plus size={15} />
        Add route
      </Button>
    </div>
  );
}

function RuleGroup({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="rule-group">
      <legend>{label}</legend>
      <small>{description}</small>
      <div>{children}</div>
    </fieldset>
  );
}
