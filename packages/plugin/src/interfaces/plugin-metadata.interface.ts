import { Site } from "@ever-jobs/models";

/**
 * Metadata describing a source plugin.
 * Attached via the @SourcePlugin() decorator.
 */
export interface IPluginMetadata {
  /** The Site enum value this plugin handles */
  site: Site;

  /** Human-readable name for display and logging */
  name: string;

  /**
   * Category of the source plugin.
   * Used for filtering, grouping, and documentation.
   */
  category: PluginCategory;

  /**
   * Whether this is an ATS (Applicant Tracking System) source
   * that requires a companySlug to target a specific company board.
   * @default false
   */
  isAts?: boolean;

  /**
   * Optional description of the plugin's capabilities or limitations.
   */
  description?: string;

  /**
   * How the watcher should schedule this source.
   *
   * Board sources are fetched once and filtered after normalization. Query
   * sources receive the bounded search-term/location request matrix. When
   * omitted, watcher planning retains its compatibility heuristic.
   */
  watchMode?: SourceWatchMode;
}

export type SourceWatchMode = "board" | "query";

export type PluginCategory =
  | "job-board"
  | "ats"
  | "company"
  | "niche"
  | "government"
  | "remote"
  | "regional"
  | "freelance";
