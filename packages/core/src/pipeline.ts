/**
 * Shared pipeline logic for generate and publish commands.
 * UI components (pickers) stay in the commands — this is pure logic.
 *
 * Implementation lives in `./pipeline/`; this file re-exports for stable import paths.
 */

export { shouldSkipPhases } from "./pipeline/skip-phases.ts";

export type { ScanCallbacks, ScanMergeOptions } from "./pipeline/scan-merge.ts";
export { scanAndMerge, enrichGitHubData } from "./pipeline/scan-merge.ts";

export {
  collectEmails,
  recountAndTag,
  detectProjectGroups,
  detectProjectGroupsFromRemotes,
} from "./pipeline/emails-and-groups.ts";

export type { AnalysisResult, ProjectStatus } from "./pipeline/analyze.ts";
export { analyzeProjects, countUnanalyzed } from "./pipeline/analyze.ts";

export type {
  GitHubCloudPhaseCallbacks,
  GitHubCloudPhaseDeps,
  GitHubCloudPhaseInput,
  GitHubCloudPhaseResult,
} from "./pipeline/github-cloud-phase.ts";
export { mergeGitHubCloudIntoScanResult } from "./pipeline/github-cloud-phase.ts";
