import { join } from "node:path";
import { tmpdir } from "node:os";

let _testDir: string | undefined;
let _testCounter = 0;

/**
 * Returns the base data directory for agent-cv.
 * - AGENT_CV_DATA_DIR env var (explicit override)
 * - Temp dir when NODE_ENV=test (auto-isolated, no config needed in tests)
 * - ~/.agent-cv (default)
 */
export function getDataDir(): string {
  if (process.env.AGENT_CV_DATA_DIR) return process.env.AGENT_CV_DATA_DIR;
  if (process.env.NODE_ENV === "test") {
    _testDir ??= join(tmpdir(), `agent-cv-test-${process.pid}-${_testCounter++}`);
    return _testDir;
  }
  return join(process.env.HOME || "~", ".agent-cv");
}

/** Reset test dir between tests. Only effective in test mode. */
export function resetDataDir(): void {
  _testDir = undefined;
}
