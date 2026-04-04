import React, { useEffect, useState, useCallback } from "react";
import { Text, Box, useInput } from "ink";
import { readInventory, writeInventory } from "../lib/inventory/store.ts";
import { resolveAdapter } from "../lib/analysis/resolve-adapter.ts";
import { ProjectSelector } from "./ProjectSelector.tsx";
import { EmailPicker } from "./EmailPicker.tsx";
import { AgentPicker } from "./AgentPicker.tsx";
import {
  scanAndMerge,
  collectEmails,
  recountAndTag,
  analyzeProjects,
} from "../lib/pipeline.ts";
import type { Project, Inventory, AgentAdapter } from "../lib/types.ts";

export interface PipelineOptions {
  directory: string;
  all?: boolean;
  email?: string;
  agent?: string;
  noCache?: boolean;
  dryRun?: boolean;
}

export interface PipelineResult {
  projects: Project[];
  inventory: Inventory;
  adapter: AgentAdapter;
}

interface Props {
  options: PipelineOptions;
  onComplete: (result: PipelineResult) => void;
  onError: (error: string) => void;
}

type Phase =
  | "scanning" | "picking-emails" | "recounting" | "selecting"
  | "picking-agent" | "analyzing" | "analysis-failed" | "done";

/**
 * Reusable pipeline component: scan → emails → recount → select → agent → analyze.
 * Commands provide onComplete to do their specific thing with the results.
 */
export function Pipeline({ options, onComplete, onError }: Props) {
  const { directory, all: selectAll, email, agent = "auto", noCache, dryRun } = options;

  const [phase, setPhase] = useState<Phase>("scanning");
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<Project[]>([]);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [resolvedAdapter, setResolvedAdapter] = useState<AgentAdapter | null>(null);

  // Scan progress
  const [scanCount, setScanCount] = useState(0);
  const [scanDir, setScanDir] = useState("");
  const [lastFound, setLastFound] = useState("");

  // Email picker state
  const [emailCounts, setEmailCounts] = useState<Map<string, number>>(new Map());
  const [gitConfigEmails, setGitConfigEmails] = useState<Set<string>>(new Set());
  const [confirmedEmails, setConfirmedEmails] = useState<string[]>([]);

  // Analysis progress
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [current, setCurrent] = useState("");

  // Phase 1: Scan
  useEffect(() => {
    async function scan() {
      try {
        const result = await scanAndMerge(directory, {
          onProjectFound: (p, total) => { setScanCount(total); setLastFound(p.displayName); },
          onDirectoryEnter: (dir) => { setScanDir(dir.replace(directory, "").replace(/^\//, "") || "."); },
        });

        if (result.projects.length === 0) {
          onError(`No projects found in ${directory}`);
          return;
        }

        setInventory(result.inventory);
        setAllProjects(result.projects);

        if (email) {
          setConfirmedEmails(email.split(",").map((e) => e.trim()));
          setPhase("recounting");
          return;
        }

        const emails = await collectEmails(result.projects, result.inventory.profile.emails);
        setEmailCounts(emails.emailCounts);
        setGitConfigEmails(emails.preSelected);

        if (emails.emailCounts.size === 0) {
          setConfirmedEmails([]);
          setPhase("selecting");
          return;
        }
        setPhase("picking-emails");
      } catch (err: any) { onError(err.message); }
    }
    scan();
  }, [directory, email]);

  // Email picker
  const handleEmailPick = useCallback(async (selected: string[], save: boolean) => {
    setConfirmedEmails(selected);
    if (save && inventory) {
      inventory.profile.emails = selected;
      inventory.profile.emailsConfirmed = true;
      await writeInventory(inventory);
    }
    setPhase("recounting");
  }, [inventory]);

  // Phase 2: Recount
  useEffect(() => {
    if (phase !== "recounting") return;
    async function recount() {
      try {
        const updated = await recountAndTag(allProjects, confirmedEmails);
        setAllProjects(updated);
        if (inventory) await writeInventory(inventory);
        if (selectAll) { setSelectedProjects(updated); setPhase("picking-agent"); }
        else setPhase("selecting");
      } catch (err: any) { onError(err.message); }
    }
    recount();
  }, [phase, confirmedEmails, allProjects, inventory, selectAll]);

  // Project selection — save included/excluded to inventory
  const handleSelection = useCallback(async (selected: Project[]) => {
    if (selected.length === 0) { onError("No projects selected."); return; }
    const selectedIds = new Set(selected.map((p) => p.id));
    for (const p of allProjects) {
      p.included = selectedIds.has(p.id);
      p.tags = p.tags.filter((t) => t !== "new");
    }
    if (inventory) await writeInventory(inventory);
    setSelectedProjects(selected);
    if (agent !== "auto") {
      try {
        const { adapter } = await resolveAdapter(agent);
        setResolvedAdapter(adapter);
        setPhase("analyzing");
      } catch (err: any) { onError(err.message); }
      return;
    }
    setPhase("picking-agent");
  }, [agent]);

  // Agent picker
  const handleAgentPick = useCallback((adapter: AgentAdapter) => {
    setResolvedAdapter(adapter);
    setPhase("analyzing");
  }, []);

  // Analysis failure state
  const [failedProjects, setFailedProjects] = useState<Array<{ project: Project; error: string }>>([]);

  function finishAnalysis() {
    // Generate profile insights (bio, highlights, narrative, skills)
    async function finish() {
      try {
        if (!dryRun && inventory && !inventory.insights.bio) {
          setCurrent("Generating profile insights...");
          try {
            const { generateProfileInsights } = await import("../lib/analysis/bio-generator.ts");
            const insights = await generateProfileInsights(selectedProjects, resolvedAdapter!);
            if (insights) {
              inventory.insights = insights;
            }
          } catch { /* optional */ }
        }
        if (inventory) await writeInventory(inventory);
        setPhase("done");
        onComplete({ projects: selectedProjects, inventory: inventory!, adapter: resolvedAdapter! });
      } catch (err: any) { onError(err.message); }
    }
    finish();
  }

  // Phase 3: Analyze
  useEffect(() => {
    if (phase !== "analyzing" || !resolvedAdapter) return;
    async function run() {
      try {
        const result = await analyzeProjects(selectedProjects, resolvedAdapter!, inventory!, {
          noCache, dryRun,
          onProgress: (done, total, cur) => { setProgress({ done, total }); setCurrent(cur); },
        });

        if (result.failed.length > 0) {
          setFailedProjects(result.failed);
          setPhase("analysis-failed");
          return;
        }

        finishAnalysis();
      } catch (err: any) { onError(err.message); }
    }
    run();
  }, [phase, selectedProjects, resolvedAdapter, noCache, dryRun, inventory]);

  // Handle failure screen input
  useInput((input, key) => {
    if (phase !== "analysis-failed") return;
    if (input === "r") {
      // Retry failed projects with same adapter
      setSelectedProjects(failedProjects.map((f) => f.project));
      setFailedProjects([]);
      setPhase("analyzing");
    } else if (input === "s") {
      // Skip failures, continue
      finishAnalysis();
    } else if (input === "a") {
      // Switch agent and retry
      setSelectedProjects(failedProjects.map((f) => f.project));
      setFailedProjects([]);
      setResolvedAdapter(null);
      setPhase("picking-agent");
    }
  });

  // Render based on phase
  if (phase === "scanning") return (
    <Box flexDirection="column">
      <Text color="yellow">Scanning {directory}...</Text>
      {scanCount > 0 && <Text color="green">Found {scanCount} project{scanCount !== 1 ? "s" : ""}{lastFound ? ` — ${lastFound}` : ""}</Text>}
      {scanDir && <Text dimColor>{scanDir}</Text>}
    </Box>
  );
  if (phase === "picking-emails") return <EmailPicker emailCounts={emailCounts} preSelected={gitConfigEmails} onSubmit={handleEmailPick} />;
  if (phase === "recounting") return <Text color="yellow">Identifying your projects...</Text>;
  if (phase === "selecting") return <ProjectSelector projects={allProjects} scanRoot={directory} onSubmit={handleSelection} />;
  if (phase === "picking-agent") return <AgentPicker onSubmit={handleAgentPick} />;
  if (phase === "analyzing") return (
    <Box flexDirection="column">
      <Text color="yellow">Analyzing [{progress.done}/{progress.total}]: {current}</Text>
      {dryRun && <Text dimColor>(dry-run mode, no LLM calls)</Text>}
    </Box>
  );
  if (phase === "analysis-failed") {
    const analyzed = selectedProjects.length - failedProjects.length;
    return (
      <Box flexDirection="column">
        <Text color="yellow" bold>Analysis complete with errors</Text>
        <Text color="green">  {analyzed} analyzed successfully</Text>
        <Text color="red">  {failedProjects.length} failed:</Text>
        {failedProjects.slice(0, 10).map((f) => (
          <Text key={f.project.id} dimColor>    {f.project.displayName}: {f.error.slice(0, 80)}</Text>
        ))}
        {failedProjects.length > 10 && <Text dimColor>    ...and {failedProjects.length - 10} more</Text>}
        <Text> </Text>
        <Text>[r] retry failed  [a] switch agent and retry  [s] skip and continue</Text>
      </Box>
    );
  }

  return null; // done phase handled by parent via onComplete
}
