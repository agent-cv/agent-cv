import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Runs pipeline UI integration in a fresh Bun process so `mock.module` does not leak
 * into other test files.
 */
describe("Pipeline UI integration (subprocess)", () => {
  test("passes when run in isolation", () => {
    const file = join(import.meta.dir, "integration", "pipeline-ui.isolated.tsx");
    const r = spawnSync("bun", ["test", file], {
      cwd: join(import.meta.dir, ".."),
      encoding: "utf-8",
      env: process.env,
      timeout: 120_000,
    });
    if (r.error) {
      console.error(r.stderr);
      console.error(r.stdout);
      throw r.error;
    }
    if (r.status !== 0) {
      console.error(r.stderr);
      console.error(r.stdout);
    }
    expect(r.status).toBe(0);
  });
});
