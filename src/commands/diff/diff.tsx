import React from "react";
import { Text, Box } from "ink";
import { useMachine } from "@xstate/react";
import { z } from "zod/v4";
import { diffFlowMachine } from "./diff.machine.ts";

export const args = z.tuple([
  z.string().describe("Directory to scan and compare against last inventory"),
]);

export const options = z.object({});

type Props = {
  args: z.infer<typeof args>;
  options: z.infer<typeof options>;
};

export default function Diff({ args: [directory] }: Props) {
  const [state] = useMachine(diffFlowMachine, { input: { directory } });

  if (state.matches("failed")) {
    return <Text color="red">Error: {state.context.error}</Text>;
  }
  if (state.matches("running")) {
    return <Text color="yellow">Scanning {directory}...</Text>;
  }

  const result = state.context.result;
  if (!result) return null;

  const hasChanges =
    result.added.length > 0 || result.removed.length > 0 || result.updated.length > 0;

  if (!hasChanges) {
    return (
      <Text dimColor>
        No changes since last scan. {result.unchanged} projects unchanged.
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      {result.added.length > 0 && (
        <>
          <Text color="green" bold>
            {result.added.length} new {result.added.length === 1 ? "project" : "projects"}:
          </Text>
          {result.added.map((p) => (
            <Box key={p.id} gap={1}>
              <Text color="green">  + {p.displayName}</Text>
              <Text dimColor>
                {p.language}
                {p.dateRange.start ? `, created ${p.dateRange.start}` : ""}
              </Text>
            </Box>
          ))}
          <Text> </Text>
        </>
      )}

      {result.updated.length > 0 && (
        <>
          <Text color="yellow" bold>
            {result.updated.length} updated:
          </Text>
          {result.updated.map(({ project, newCommits }) => (
            <Box key={project.id} gap={1}>
              <Text color="yellow">  ~ {project.displayName}</Text>
              <Text dimColor>
                +{newCommits} {newCommits === 1 ? "commit" : "commits"}
                {project.lastCommit ? `, last: ${project.lastCommit}` : ""}
              </Text>
            </Box>
          ))}
          <Text> </Text>
        </>
      )}

      {result.removed.length > 0 && (
        <>
          <Text color="red" bold>
            {result.removed.length} removed:
          </Text>
          {result.removed.map((p) => (
            <Box key={p.id} gap={1}>
              <Text color="red">  - {p.displayName}</Text>
              <Text dimColor>directory deleted</Text>
            </Box>
          ))}
          <Text> </Text>
        </>
      )}

      <Text dimColor>{result.unchanged} unchanged</Text>
    </Box>
  );
}

export const description = "Show what changed since last scan";
