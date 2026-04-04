import { describe, test, expect } from "bun:test";
import { MarkdownRenderer } from "../src/lib/output/markdown-renderer.ts";
import type { Project, Inventory } from "../src/lib/types.ts";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "test-" + Math.random().toString(36).slice(2, 8),
    path: "/projects/test",
    displayName: "test-project",
    type: "node",
    language: "TypeScript",
    frameworks: ["React"],
    dateRange: { start: "2024-03-01", end: "2024-06-01", approximate: false },
    hasGit: true,
    commitCount: 42,
    authorCommitCount: 35,
    hasUncommittedChanges: false,
    lastCommit: "2024-06-01",
    markers: ["package.json"],
    size: { files: 20, lines: 3000 },
    tags: [],
    included: true,
    ...overrides,
  };
}

function makeInventory(projects: Project[], overrides: Partial<Inventory> = {}): Inventory {
  return {
    version: "1.0",
    lastScan: new Date().toISOString(),
    scanPaths: ["/projects"],
    projects,
    profile: { emails: [], emailsConfirmed: false },
    insights: {},
    ...overrides,
  };
}

const renderer = new MarkdownRenderer();

describe("MarkdownRenderer", () => {
  test("renders empty state", () => {
    const result = renderer.render(makeInventory([]), []);
    expect(result).toContain("No projects selected");
  });

  test("renders project with analysis", () => {
    const p = makeProject({
      id: "p1",
      analysis: {
        summary: "A great app.",
        techStack: ["TypeScript", "React"],
        contributions: ["Built the UI", "Added auth"],
        analyzedAt: "2024-01-01",
        analyzedBy: "claude",
      },
    });
    const result = renderer.render(makeInventory([p]), ["p1"]);
    expect(result).toContain("A great app.");
    expect(result).toContain("TypeScript, React");
    expect(result).toContain("Built the UI");
    expect(result).toContain("Added auth");
  });

  test("renders project without analysis", () => {
    const p = makeProject({ id: "p1" });
    const result = renderer.render(makeInventory([p]), ["p1"]);
    expect(result).toContain("test-project");
    expect(result).toContain("TypeScript");
    expect(result).toContain("42 commits");
  });

  test("groups by year", () => {
    const p2024 = makeProject({ id: "a", dateRange: { start: "2024-01-01", end: "2024-06-01", approximate: false } });
    const p2023 = makeProject({ id: "b", dateRange: { start: "2023-01-01", end: "2023-12-01", approximate: false } });
    const result = renderer.render(makeInventory([p2024, p2023]), ["a", "b"]);
    const idx2024 = result.indexOf("## 2024");
    const idx2023 = result.indexOf("## 2023");
    expect(idx2024).toBeLessThan(idx2023); // 2024 before 2023 (descending)
  });

  test("caps contributions at 5", () => {
    const p = makeProject({
      id: "p1",
      analysis: {
        summary: "Big project.",
        techStack: ["TS"],
        contributions: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"],
        analyzedAt: "2024-01-01",
        analyzedBy: "claude",
      },
    });
    const result = renderer.render(makeInventory([p]), ["p1"]);
    expect(result).toContain("Five");
    expect(result).not.toContain("Six");
  });

  test("disambiguates duplicate names with path", () => {
    const p1 = makeProject({ id: "a", displayName: "frontend", path: "/projects/app1/frontend" });
    const p2 = makeProject({ id: "b", displayName: "frontend", path: "/projects/app2/frontend" });
    const result = renderer.render(makeInventory([p1, p2]), ["a", "b"]);
    expect(result).toContain("frontend (");
  });

  test("shows 'by me' only when different from total", () => {
    const solo = makeProject({ id: "a", commitCount: 10, authorCommitCount: 10 });
    const collab = makeProject({ id: "b", commitCount: 100, authorCommitCount: 30 });
    const result = renderer.render(makeInventory([solo, collab]), ["a", "b"]);
    // Solo project should NOT show "by me"
    expect(result).toContain("10 commits");
    // Collab should show "by me"
    expect(result).toContain("30 by me");
  });

  test("generates summary with languages and frameworks", () => {
    const projects = [
      makeProject({ id: "a", language: "TypeScript", frameworks: ["React", "Next.js"] }),
      makeProject({ id: "b", language: "TypeScript", frameworks: ["React"] }),
      makeProject({ id: "c", language: "Rust", frameworks: [] }),
    ];
    const result = renderer.render(makeInventory(projects), ["a", "b", "c"]);
    expect(result).toContain("TypeScript");
    expect(result).toContain("Rust");
    expect(result).toContain("React");
    expect(result).toContain("3 projects");
  });

  test("pluralizes correctly", () => {
    const p = makeProject({ id: "a", commitCount: 1 });
    const result = renderer.render(makeInventory([p]), ["a"]);
    expect(result).toContain("1 commit");
    expect(result).not.toContain("1 commits");
  });

  test("skips removed projects", () => {
    const p = makeProject({ id: "a", tags: ["removed"] });
    const result = renderer.render(makeInventory([p]), ["a"]);
    expect(result).toContain("No projects selected");
  });

  test("handles approximate dates", () => {
    const p = makeProject({
      id: "a",
      dateRange: { start: "2023-05-01", end: "2023-08-01", approximate: true },
    });
    const result = renderer.render(makeInventory([p]), ["a"]);
    expect(result).toContain("~");
  });
});
