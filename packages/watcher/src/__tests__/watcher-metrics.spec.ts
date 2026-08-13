import { WatcherMetricsService } from "../services/watcher-metrics.service";

describe("WatcherMetricsService company coverage", () => {
  it("publishes all five coverage summary counts with bounded labels", async () => {
    const metrics = new WatcherMetricsService();

    metrics.setCompanyCoverage("watch-1", {
      configured: 26,
      active: 21,
      disabled: 0,
      uncovered: 5,
      initialized: 16,
      degraded: 2,
    });

    const text = await metrics.render();
    expect(text).toMatch(
      /ever_jobs_watcher_company_coverage\{watch_id="watch-1",status="configured"\} 26\b/,
    );
    expect(text).toMatch(
      /ever_jobs_watcher_company_coverage\{watch_id="watch-1",status="active"\} 21\b/,
    );
    expect(text).toMatch(
      /ever_jobs_watcher_company_coverage\{watch_id="watch-1",status="disabled"\} 0\b/,
    );
    expect(text).toMatch(
      /ever_jobs_watcher_company_coverage\{watch_id="watch-1",status="uncovered"\} 5\b/,
    );
    expect(text).toMatch(
      /ever_jobs_watcher_company_coverage\{watch_id="watch-1",status="initialized"\} 16\b/,
    );
    expect(text).toMatch(
      /ever_jobs_watcher_company_coverage\{watch_id="watch-1",status="degraded"\} 2\b/,
    );
  });

  it("overwrites a watch's existing status samples", async () => {
    const metrics = new WatcherMetricsService();
    metrics.setCompanyCoverage("watch-1", {
      configured: 26,
      active: 21,
      disabled: 0,
      uncovered: 5,
      initialized: 16,
      degraded: 2,
    });

    metrics.setCompanyCoverage("watch-1", {
      configured: 26,
      active: 20,
      disabled: 1,
      uncovered: 5,
      initialized: 17,
      degraded: 0,
    });

    const text = await metrics.render();
    expect(text).toMatch(
      /ever_jobs_watcher_company_coverage\{watch_id="watch-1",status="active"\} 20\b/,
    );
    expect(text).toMatch(
      /ever_jobs_watcher_company_coverage\{watch_id="watch-1",status="disabled"\} 1\b/,
    );
    expect(text).not.toMatch(
      /ever_jobs_watcher_company_coverage\{watch_id="watch-1",status="active"\} 21\b/,
    );
  });

  it("drops stale label sets when durable watches are resynchronized", async () => {
    const metrics = new WatcherMetricsService();
    metrics.setCompanyCoverage("deleted-watch", {
      configured: 1,
      active: 1,
      disabled: 0,
      uncovered: 0,
      initialized: 1,
      degraded: 0,
    });

    metrics.syncCompanyCoverage([
      {
        watchId: "current-watch",
        counts: {
          configured: 3,
          active: 2,
          disabled: 0,
          uncovered: 1,
          initialized: 0,
          degraded: 0,
        },
      },
    ]);

    const text = await metrics.render();
    expect(text).not.toContain('watch_id="deleted-watch"');
    expect(text).toContain('watch_id="current-watch",status="active"} 2');
  });
});
