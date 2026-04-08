/**
 * Classify local clones vs upstream-oriented OSS forks vs personal fork lines,
 * and derive per-year sections for portfolio output.
 */

import type { OpenSourceContribution, Project, YearlyInsight, YearlyTheme } from "../types.ts";

/** Commits on a fork with no upstream PRs → treat as "your product line", not exploration. */
export const PERSONAL_FORK_AUTHOR_COMMIT_THRESHOLD = 15;

function yearOf(p: Project): string {
  return p.dateRange.end?.split("-")[0] || p.dateRange.start?.split("-")[0] || "Unknown";
}

/**
 * Fork the user develops independently: many local commits, no PRs toward parent.
 */
export function isPersonalForkLine(p: Project): boolean {
  return !!(
    p.isFork &&
    (p.upstreamPrCount ?? 0) === 0 &&
    (p.authorCommitCount ?? 0) >= PERSONAL_FORK_AUTHOR_COMMIT_THRESHOLD
  );
}

/**
 * Local checkout used for learning: no commits as the configured user, not a personal fork line,
 * and not an upstream-contribution fork (PRs toward parent are listed under OSS instead).
 */
export function isStudiedClone(p: Project): boolean {
  if (!p.hasGit || !p.remoteUrl?.trim()) return false;
  if (p.source === "github") return false;
  if ((p.authorCommitCount ?? 0) > 0) return false;
  if (isPersonalForkLine(p)) return false;
  if ((p.upstreamPrCount ?? 0) > 0) return false;
  return true;
}

/**
 * Show under open-source contributions: at least one PR on the parent repo authored by you.
 */
export function isUpstreamContribution(p: Project): boolean {
  return (p.upstreamPrCount ?? 0) > 0 && !!p.githubParentFullName;
}

function sortNames(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

function sortOss(entries: OpenSourceContribution[]): OpenSourceContribution[] {
  return [...entries].sort((a, b) => {
    if (b.pullRequestCount !== a.pullRequestCount) {
      return b.pullRequestCount - a.pullRequestCount;
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Group display names by calendar year (project activity end date, else start).
 */
export function studiedProjectsByYear(projects: Project[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const p of projects) {
    if (!isStudiedClone(p)) continue;
    const y = yearOf(p);
    if (y === "Unknown") continue;
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(p.displayName);
  }
  for (const [y, names] of map) {
    map.set(y, sortNames(names));
  }
  return map;
}

/**
 * Open-source (fork → upstream) entries grouped by year.
 */
export function openSourceContributionsByYear(projects: Project[]): Map<string, OpenSourceContribution[]> {
  const map = new Map<string, OpenSourceContribution[]>();
  for (const p of projects) {
    if (!isUpstreamContribution(p) || !p.githubParentFullName) continue;
    const y = yearOf(p);
    if (y === "Unknown") continue;
    const entry: OpenSourceContribution = {
      displayName: p.displayName,
      upstream: p.githubParentFullName,
      pullRequestCount: p.upstreamPrCount ?? 0,
    };
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(entry);
  }
  for (const [y, entries] of map) {
    map.set(y, sortOss(entries));
  }
  return map;
}

/**
 * Merge deterministic yearly sections into YearlyTheme and YearlyInsight.
 */
export function mergeYearlyEngagementSections(
  yearlyThemes: YearlyTheme[],
  yearlyInsights: YearlyInsight[] | undefined,
  projects: Project[]
): { yearlyThemes: YearlyTheme[]; yearlyInsights: YearlyInsight[] | undefined } {
  const studied = studiedProjectsByYear(projects);
  const oss = openSourceContributionsByYear(projects);

  const themes: YearlyTheme[] = yearlyThemes.map((t) => {
    const s = studied.get(t.year);
    const o = oss.get(t.year);
    return {
      ...t,
      ...(s && s.length > 0 ? { studiedProjects: s } : {}),
      ...(o && o.length > 0 ? { openSourceContributions: o } : {}),
    };
  });

  let insights: YearlyInsight[] | undefined = yearlyInsights;
  if (insights) {
    insights = insights.map((yi) => {
      const s = studied.get(yi.year);
      const o = oss.get(yi.year);
      return {
        ...yi,
        ...(s && s.length > 0 ? { studiedProjects: s } : {}),
        ...(o && o.length > 0 ? { openSourceContributions: o } : {}),
      };
    });
  }

  return { yearlyThemes: themes, yearlyInsights: insights };
}
