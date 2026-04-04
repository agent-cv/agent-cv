import React, { useEffect, useState } from "react";
import { Text, Box, useInput, useApp } from "ink";
import { z } from "zod/v4";
import { readConfig, writeConfig, type Config } from "../lib/config.ts";

export const options = z.object({});

type Props = { options: z.infer<typeof options> };

type Field = {
  key: keyof Config | string;
  label: string;
  value: string;
  nested?: string; // for socials.github etc.
};

export default function ConfigCommand({}: Props) {
  const { exit } = useApp();
  const [config, setConfig] = useState<Config | null>(null);
  const [cursor, setCursor] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    readConfig().then(setConfig);
  }, []);

  if (!config) return <Text color="yellow">Loading config...</Text>;

  const fields: Field[] = [
    { key: "name", label: "Name", value: config.name || "" },
    { key: "bio", label: "Bio", value: config.bio ? config.bio.slice(0, 60) + "..." : "(auto-generated on next run)" },
    { key: "emailPublic", label: "Show email publicly", value: config.emailPublic ? "yes" : "no" },
    { key: "socials.github", label: "GitHub username", value: config.socials?.github || "", nested: "github" },
    { key: "socials.linkedin", label: "LinkedIn", value: config.socials?.linkedin || "", nested: "linkedin" },
    { key: "socials.twitter", label: "Twitter/X", value: config.socials?.twitter || "", nested: "twitter" },
    { key: "socials.telegram", label: "Telegram", value: config.socials?.telegram || "", nested: "telegram" },
    { key: "socials.website", label: "Website URL", value: config.socials?.website || "", nested: "website" },
  ];

  useInput((input, key) => {
    if (editing) {
      if (key.return) {
        // Save the edited value
        const field = fields[cursor]!;
        const newConfig = { ...config };

        if (field.key === "emailPublic") {
          newConfig.emailPublic = editValue.toLowerCase().startsWith("y");
        } else if (field.key === "bio") {
          newConfig.bio = editValue || undefined;
        } else if (field.nested) {
          if (!newConfig.socials) newConfig.socials = {};
          (newConfig.socials as any)[field.nested] = editValue || undefined;
        } else {
          (newConfig as any)[field.key] = editValue || undefined;
        }

        setConfig(newConfig);
        writeConfig(newConfig);
        setEditing(false);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        return;
      }
      if (key.escape) { setEditing(false); return; }
      if (key.backspace || key.delete) { setEditValue((v) => v.slice(0, -1)); return; }
      if (input && !key.ctrl && !key.meta) { setEditValue((v) => v + input); return; }
      return;
    }

    if (key.upArrow) setCursor((c) => (c > 0 ? c - 1 : fields.length - 1));
    else if (key.downArrow) setCursor((c) => (c < fields.length - 1 ? c + 1 : 0));
    else if (key.return) {
      const field = fields[cursor]!;
      setEditValue(field.value === "(auto-generated on next run)" ? "" : field.value);
      setEditing(true);
    }
    else if (input === "q" || key.escape) exit();
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text bold>agent-cv config</Text>
        <Text dimColor>[Enter] edit  [q] quit  Saved to ~/.agent-cv/config.json</Text>
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

      {saved && <Text color="green">{"\n"}Saved!</Text>}
    </Box>
  );
}

export const description = "Edit your profile: name, bio, socials, email privacy";
