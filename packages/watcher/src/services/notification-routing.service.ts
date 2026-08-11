import {
  JobWatch,
  NotificationDestination,
  NotificationRoute,
  NotificationRouteConditions,
  NotificationType,
  WatchMatch,
} from "../interfaces/watch.types";
import { watchSourceTargetKey } from "./watch-preset.service";

/**
 * Selects destinations without side effects. A configured route set is
 * authoritative, including when every route is disabled. Legacy destinations
 * are used only when notificationRoutes is absent or empty.
 */
export function selectNotificationDestinations(
  watch: JobWatch,
  match: WatchMatch,
  notificationType: NotificationType,
): NotificationDestination[] {
  const routes = watch.notificationRoutes ?? [];
  const sourceTier = sourceTierForMatch(watch, match);
  const destinations =
    routes.length > 0
      ? routes
          .filter(
            (route) =>
              route.enabled &&
              routeMatches(route, match, notificationType, sourceTier),
          )
          .map(routeDestination)
      : watch.notificationChannels;

  return deduplicateDestinations(destinations);
}

export function routeMatches(
  route: NotificationRoute,
  match: Pick<WatchMatch, "score">,
  notificationType: NotificationType,
  sourceTier: 1 | 2 | 3 | undefined,
): boolean {
  const conditions = route.conditions;
  if (!conditions) return true;
  return (
    matchesSourceTier(conditions, sourceTier) &&
    matchesNotificationType(conditions, notificationType) &&
    (conditions.minimumScore === undefined ||
      match.score >= conditions.minimumScore) &&
    (conditions.maximumScore === undefined ||
      match.score <= conditions.maximumScore)
  );
}

export function sourceTierForMatch(
  watch: Pick<JobWatch, "sourceTargets">,
  match: Pick<WatchMatch, "sourceTargetKey">,
): 1 | 2 | 3 | undefined {
  if (!match.sourceTargetKey) return undefined;
  return watch.sourceTargets.find(
    (target) => watchSourceTargetKey(target) === match.sourceTargetKey,
  )?.tier;
}

export function notificationDestinationRef(
  destination: NotificationDestination,
): string {
  return (
    destination.destinationRef?.trim() ||
    destination.secretRef?.trim() ||
    "default"
  );
}

function matchesSourceTier(
  conditions: NotificationRouteConditions,
  sourceTier: 1 | 2 | 3 | undefined,
): boolean {
  return (
    conditions.sourceTiers === undefined ||
    (sourceTier !== undefined && conditions.sourceTiers.includes(sourceTier))
  );
}

function matchesNotificationType(
  conditions: NotificationRouteConditions,
  notificationType: NotificationType,
): boolean {
  return (
    conditions.notificationTypes === undefined ||
    conditions.notificationTypes.includes(notificationType)
  );
}

function routeDestination(route: NotificationRoute): NotificationDestination {
  return {
    type: route.provider,
    destinationRef: route.destinationRef.trim(),
  };
}

function deduplicateDestinations(
  destinations: readonly NotificationDestination[],
): NotificationDestination[] {
  const unique = new Map<string, NotificationDestination>();
  for (const destination of destinations) {
    const destinationRef = notificationDestinationRef(destination);
    const key = `${destination.type}\u001f${destinationRef}`;
    if (!unique.has(key)) {
      unique.set(key, { ...destination, destinationRef });
    }
  }
  return [...unique.values()];
}
