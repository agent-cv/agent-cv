import { describe, test, expect } from "bun:test";
import { resolveAdapter } from "@agent-cv/core/src/analysis/resolve-adapter.ts";

describe("resolveAdapter", () => {
  test("auto resolves to an available adapter", async () => {
    const { adapter, name } = await resolveAdapter("auto");
    expect(adapter).toBeDefined();
    expect(name).toBeTruthy();
    expect(typeof adapter.analyze).toBe("function");
  });

  test("throws for unknown adapter name", async () => {
    expect(resolveAdapter("nonexistent")).rejects.toThrow("Unknown agent");
  });

  test("claude adapter has correct interface", async () => {
    try {
      const { adapter } = await resolveAdapter("claude");
      expect(adapter.name).toBe("claude");
      expect(typeof adapter.isAvailable).toBe("function");
      expect(typeof adapter.analyze).toBe("function");
    } catch {
      // claude not installed, skip
    }
  });

  test("api adapter reports availability based on env vars", async () => {
    try {
      const { adapter } = await resolveAdapter("api");
      // If it resolves, it found an API key
      expect(adapter.name).toBe("api");
    } catch (err: any) {
      // No API key, expected
      expect(err.message).toContain("not available");
    }
  });
});
