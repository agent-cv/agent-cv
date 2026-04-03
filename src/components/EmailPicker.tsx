import React, { useState, useMemo } from "react";
import { Box, Text, useInput, useApp } from "ink";

interface Props {
  emailCounts: Map<string, number>;
  preSelected: Set<string>;
  onSubmit: (selected: string[], save: boolean) => void;
}

export function EmailPicker({ emailCounts, preSelected, onSubmit }: Props) {
  const { exit } = useApp();

  const emails = useMemo(() =>
    [...emailCounts.entries()]
      .sort(([aEmail, aCount], [bEmail, bCount]) => {
        const aSelected = preSelected.has(aEmail) ? 1 : 0;
        const bSelected = preSelected.has(bEmail) ? 1 : 0;
        if (aSelected !== bSelected) return bSelected - aSelected;
        return bCount - aCount;
      })
      .map(([email, count]) => ({ email, count })),
    [emailCounts, preSelected]
  );

  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set(preSelected));
  const [phase, setPhase] = useState<"pick" | "save">("pick");
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search) return emails;
    const q = search.toLowerCase();
    return emails.filter((e) => e.email.includes(q));
  }, [emails, search]);

  // Windowed scrolling
  const windowSize = Math.min(15, filtered.length);
  const halfWindow = Math.floor(windowSize / 2);
  let start = Math.max(0, cursor - halfWindow);
  const end = Math.min(filtered.length, start + windowSize);
  if (end === filtered.length) start = Math.max(0, end - windowSize);
  const visible = filtered.slice(start, end);

  // Reset cursor on search change
  useMemo(() => { setCursor(0); }, [search]);

  useInput((input, key) => {
    if (phase === "save") {
      if (input === "y" || key.return) {
        onSubmit([...selected], true);
      } else if (input === "n") {
        onSubmit([...selected], false);
      }
      return;
    }

    // Search mode
    if (searching) {
      if (key.escape) {
        setSearching(false);
        setSearch("");
        return;
      }
      if (key.backspace || key.delete) {
        setSearch((s) => s.slice(0, -1));
        if (search.length <= 1) {
          setSearching(false);
          setSearch("");
        }
        return;
      }
      if (key.return) {
        setSearching(false);
        return;
      }
      if (key.upArrow) {
        setCursor((c) => (c > 0 ? c - 1 : filtered.length - 1));
        return;
      }
      if (key.downArrow) {
        setCursor((c) => (c < filtered.length - 1 ? c + 1 : 0));
        return;
      }
      if (input === " ") {
        toggleCurrent();
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setSearch((s) => s + input);
        return;
      }
      return;
    }

    // Normal mode
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : filtered.length - 1));
    } else if (key.downArrow) {
      setCursor((c) => (c < filtered.length - 1 ? c + 1 : 0));
    } else if (input === "/") {
      setSearching(true);
      setSearch("");
    } else if (input === " ") {
      toggleCurrent();
    } else if (key.return) {
      if (selected.size === 0) return;
      setPhase("save");
    } else if (input === "q" || key.escape) {
      if (search) {
        setSearch("");
      } else {
        exit();
      }
    }
  });

  function toggleCurrent() {
    const item = filtered[cursor];
    if (!item) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.email)) next.delete(item.email);
      else next.add(item.email);
      return next;
    });
  }

  if (phase === "save") {
    return (
      <Box flexDirection="column">
        <Text bold>Selected {selected.size} email(s):</Text>
        {[...selected].map((e) => (
          <Text key={e} color="green">  {e}</Text>
        ))}
        <Text> </Text>
        <Text>Save as your default emails? <Text bold>(Y/n)</Text></Text>
        <Text dimColor>Next time your selection will be pre-checked. Use --email to override.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        <Text bold>
          Which of these emails are yours? ({selected.size} selected)
          {search && (
            <Text color="cyan"> — {filtered.length} matches</Text>
          )}
        </Text>
        <Text dimColor>
          [Space] toggle  [Enter] confirm  [/] search  [q] quit
        </Text>
        <Text color="yellow">
          TIP: Select ALL emails you've ever used for git commits,
          including work, personal, and old addresses.
          Your previous selection is pre-checked. Just hit Enter if correct.
        </Text>
      </Box>

      {(searching || search) && (
        <Box marginBottom={1}>
          <Text color="cyan" bold>/ </Text>
          <Text color="cyan">{search}</Text>
          {searching && <Text color="cyan">█</Text>}
          {!searching && search && <Text dimColor>  (Esc to clear)</Text>}
        </Box>
      )}

      {visible.map(({ email, count }, i) => {
        const globalIndex = start + i;
        const isCursor = globalIndex === cursor;
        const isSelected = selected.has(email);
        const isFromConfig = preSelected.has(email);
        const checkbox = isSelected ? "[x]" : "[ ]";

        return (
          <Box key={email} gap={1}>
            <Text color={isCursor ? "cyan" : undefined} inverse={isCursor}>
              {checkbox} {email}
            </Text>
            <Text dimColor>
              {count} repo{count !== 1 ? "s" : ""}
            </Text>
            {isFromConfig && <Text color="green">(saved)</Text>}
          </Box>
        );
      })}

      {filtered.length > windowSize && (
        <Text dimColor>
          {"\n"}{start + 1}-{end} of {filtered.length}
        </Text>
      )}

      {filtered.length === 0 && search && (
        <Text dimColor>No matches for "{search}"</Text>
      )}
    </Box>
  );
}
