import { describe, test, expect } from "bun:test";
import type { Project } from "../src/lib/types.ts";
import {
  isPersonalForkLine,
  isStudiedClone,
  isUpstreamContribution,
  mergeYearlyEngagementSections,
  studiedProjectsByYear,
  openSourceContributionsByYear,
  PERSONAL_FORK_AUTHOR_COMMIT_THRESHOLD,
} from "../src/lib/discovery/project-engagement.ts";

function base(overrides: Partial<Project> = {}): Project {
  return {
    id: "id",
    path: "/tmp/p",
    displayName: "proj",
    type: "node",
    language: "TS",
    frameworks: [],
    dateRange: { start: "2024-01-01", end: "2024-06-01", approximate: false },
    hasGit: true,
    commitCount: 100,
    authorCommitCount: 0,
    hasUncommittedChanges: false,
    markers: [],
    size: { files: 1, lines: 10 },
    tags: [],
    included: true,
    remoteUrl: "https://github.com/me/some-lib",
    source: "local",
    ...overrides,
  };
}

describe("isStudiedClone", () => {
  test("true for local clone with zero author commits", () => {
    expect(isStudiedClone(base())).toBe(true);
  });

  test("false when source is github cloud listing", () => {
    expect(isStudiedClone(base({ source: "github" }))).toBe(false);
  });

  test("false when user has commits", () => {
    expect(isStudiedClone(base({ authorCommitCount: 3 }))).toBe(false);
  });

  test("false for personal fork line", () => {
    expect(
      isStudiedClone(
        base({
          isFork: true,
          upstreamPrCount: 0,
          authorCommitCount: PERSONAL_FORK_AUTHOR_COMMIT_THRESHOLD,
        })
      )
    ).toBe(false);
  });

  test("false when upstream PRs exist (listed under OSS)", () => {
    expect(
      isStudiedClone(
        base({
          isFork: true,
          githubParentFullName: "up/here",
          upstreamPrCount: 2,
        })
      )
    ).toBe(false);
  });
});

describe("isPersonalForkLine", () => {
  test("true when fork, no upstream PRs, many author commits", () => {
    expect(
      isPersonalForkLine(
        base({
          isFork: true,
          upstreamPrCount: 0,
          authorCommitCount: PERSONAL_FORK_AUTHOR_COMMIT_THRESHOLD,
        })
      )
    ).toBe(true);
  });

  test("false when upstream PRs exist", () => {
    expect(
      isPersonalForkLine(
        base({
          isFork: true,
          githubParentFullName: "a/b",
          upstreamPrCount: 1,
          authorCommitCount: 100,
        })
      )
    ).toBe(false);
  });
});

describe("isUpstreamContribution", () => {
  test("true when parent and PR count", () => {
    expect(
      isUpstreamContribution(
        base({
          githubParentFullName: "facebook/react",
          upstreamPrCount: 3,
        })
      )
    ).toBe(true);
  });

  test("false when PR count is zero", () => {
    expect(
      isUpstreamContribution(
        base({
          githubParentFullName: "a/b",
          upstreamPrCount: 0,
        })
      )
    ).toBe(false);
  });
});

describe("per-year maps", () => {
  test("groups studied and OSS by year", () => {
    const projects: Project[] = [
      base({
        displayName: "read-only",
        dateRange: { start: "2024-01-01", end: "2024-03-01", approximate: false },
      }),
      base({
        displayName: "my-fork",
        isFork: true,
        githubParentFullName: "org/upstream",
        upstreamPrCount: 2,
        dateRange: { start: "2023-01-01", end: "2023-12-01", approximate: false },
      }),
    ];
    expect(studiedProjectsByYear(projects).get("2024")).toEqual(["read-only"]);
    expect(openSourceContributionsByYear(projects).get("2023")?.[0]?.displayName).toBe("my-fork");
  });
});

describe("mergeYearlyEngagementSections", () => {
  test("adds studiedProjects and openSourceContributions to themes", () => {
    const projects: Project[] = [
      base({
        displayName: "study-me",
        dateRange: { start: "2024-01-01", end: "2024-06-01", approximate: false },
      }),
    ];
    const { yearlyThemes } = mergeYearlyEngagementSections(
      [{ year: "2024", focus: "x", topProjects: [] }],
      [{ year: "2024", focus: "", highlights: [], skills: [], domains: [], source: "metadata" }],
      projects
    );
    expect(yearlyThemes[0]!.studiedProjects).toEqual(["study-me"]);
  });
});
