import type { AgentAdapter, Project } from "../types.ts";

/**
 * Generate a professional bio from analyzed projects.
 * Runs after all projects are analyzed, uses the full inventory
 * to write 3-4 sentences about who this person is.
 */
export async function generateBio(
  projects: Project[],
  adapter: AgentAdapter
): Promise<string> {
  const analyzed = projects.filter((p) => p.analysis);
  if (analyzed.length === 0) return "";

  // Build a compact summary for the LLM
  const projectSummaries = analyzed
    .slice(0, 30) // cap to avoid token overflow
    .map((p) => {
      const tech = p.analysis?.techStack?.join(", ") || p.language;
      const desc = p.analysis?.summary?.slice(0, 100) || "";
      const date = p.dateRange.start?.split("-")[0] || "?";
      return `- ${p.displayName} (${date}): ${tech}. ${desc}`;
    })
    .join("\n");

  // Language stats
  const langCounts = new Map<string, number>();
  for (const p of projects) {
    if (p.language !== "Unknown") {
      langCounts.set(p.language, (langCounts.get(p.language) || 0) + 1);
    }
  }
  const topLangs = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([l]) => l)
    .join(", ");

  // Framework stats
  const fwCounts = new Map<string, number>();
  for (const p of projects) {
    for (const fw of p.frameworks) {
      fwCounts.set(fw, (fwCounts.get(fw) || 0) + 1);
    }
  }
  const topFw = [...fwCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([f]) => f)
    .join(", ");

  const years = projects
    .map((p) => p.dateRange.start?.split("-")[0])
    .filter(Boolean)
    .sort();
  const firstYear = years[0] || "?";

  const prompt = [
    "Write a professional bio for a developer's portfolio. 3-4 sentences maximum.",
    "Write in third person. Be specific about their strengths based on the projects below.",
    "Do NOT use generic phrases like 'passionate developer' or 'problem solver'.",
    "Focus on: what they build, what tech they're strongest in, and what makes them unique.",
    "Return ONLY the bio text, no quotes, no labels, no markdown.",
    "",
    `Active since: ${firstYear}`,
    `Top languages: ${topLangs}`,
    `Top frameworks: ${topFw}`,
    `Total projects: ${projects.length} (${analyzed.length} analyzed)`,
    "",
    "Projects:",
    projectSummaries,
  ].join("\n");

  const context = {
    path: "",
    readme: "",
    dependencies: "",
    directoryTree: "",
    gitShortlog: "",
    recentCommits: prompt,
  };

  try {
    const result = await adapter.analyze(context);
    // The "summary" field will contain the bio since that's how the prompt works
    return result.summary || "";
  } catch {
    // Bio generation failed, not critical
    return "";
  }
}
