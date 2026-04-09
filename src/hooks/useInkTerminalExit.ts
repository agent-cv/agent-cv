import { useEffect } from "react";
import { useApp } from "ink";

/**
 * After a command machine reaches a terminal state, unmount Ink cleanly then exit the process.
 * Uses a short delay so the last frame (success or error text) renders before the TTY is released.
 */
export function useInkTerminalExit(isTerminal: boolean, failed: boolean): void {
  const { exit } = useApp();
  useEffect(() => {
    if (!isTerminal) return;
    const code = failed ? 1 : 0;
    const t = setTimeout(() => {
      exit();
      process.exit(code);
    }, 100);
    return () => clearTimeout(t);
  }, [isTerminal, failed, exit]);
}
