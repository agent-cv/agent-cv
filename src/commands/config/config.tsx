import React, { useEffect } from "react";
import { Text, Box, useInput, useApp } from "ink";
import { useMachine } from "@xstate/react";
import { z } from "zod/v4";
import { configFlowMachine } from "./config.machine.ts";
import { buildConfigFields } from "./fields.ts";
import { Shimmer } from "../../components/Shimmer.tsx";

export const options = z.object({});

type Props = { options: z.infer<typeof options> };

export default function ConfigCommand({}: Props) {
  const { exit } = useApp();
  const [state, send] = useMachine(configFlowMachine, { input: {} });

  useInput((input, key) => {
    send({
      type: "INPUT",
      input,
      key: {
        upArrow: key.upArrow,
        downArrow: key.downArrow,
        return: key.return,
        escape: key.escape,
        backspace: key.backspace,
        delete: key.delete,
        ctrl: key.ctrl,
        meta: key.meta,
      },
    });
  });

  useEffect(() => {
    if (state.matches("exited")) exit();
  }, [state, exit]);

  useEffect(() => {
    if (!state.context.saved) return;
    const t = setTimeout(() => send({ type: "CLEAR_SAVED" }), 2000);
    return () => clearTimeout(t);
  }, [state.context.saved, send]);

  if (state.matches("failed")) {
    return <Text color="red">Error: {state.context.error}</Text>;
  }
  if (state.matches("loading")) {
    return <Text color="yellow">Loading config...</Text>;
  }

  const { inventory, telemetry, cursor, editing, editValue, saved, error } = state.context;
  if (inventory === null || telemetry === null) return null;

  const fields = buildConfigFields(inventory, telemetry);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text>
          <Shimmer>agent-cv</Shimmer> <Text bold>config</Text>
        </Text>
        <Text dimColor>[Enter] edit [q] quit Saved under ~/.agent-cv/</Text>
      </Box>

      {fields.map((field, i) => {
        const isCursor = i === cursor;
        const isEditing = editing && isCursor;

        return (
          <Box key={field.key} gap={1}>
            <Text color={isCursor ? "cyan" : undefined} bold={isCursor}>
              {isCursor ? ">" : " "} {field.label}:
            </Text>
            {isEditing ? (
              <Text color="cyan">{editValue}█</Text>
            ) : (
              <Text dimColor={!field.value}>{field.value || "(empty)"}</Text>
            )}
          </Box>
        );
      })}

      {error ? <Text color="red">{"\n"}{error}</Text> : null}
      {saved && <Text color="green">{"\n"}Saved!</Text>}
      {state.matches({ ready: "persisting" }) ? (
        <Text dimColor>{"\n"}Saving...</Text>
      ) : null}
    </Box>
  );
}

export const description = "Edit your profile: name, bio, socials, email privacy";
