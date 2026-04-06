import { describe, test, expect, beforeEach } from "bun:test";
import { resetDataDir } from "../src/lib/data-dir.ts";

beforeEach(() => {
  resetDataDir();
});

describe("telemetry", () => {
  test("disabled by env var", async () => {
    process.env.AGENT_CV_TELEMETRY = "off";
    const { isTelemetryEnabled } = await import("../src/lib/telemetry.ts");
    expect(await isTelemetryEnabled()).toBe(false);
    delete process.env.AGENT_CV_TELEMETRY;
  });

  test("enabled by default when no state file", async () => {
    const { isTelemetryEnabled } = await import("../src/lib/telemetry.ts");
    expect(await isTelemetryEnabled()).toBe(true);
  });

  test("markNoticeSeen returns false first time, true after", async () => {
    const { markNoticeSeen } = await import("../src/lib/telemetry.ts");
    const first = await markNoticeSeen();
    expect(first).toBe(false);
    const second = await markNoticeSeen();
    expect(second).toBe(true);
  });

  test("setTelemetryEnabled persists", async () => {
    const { setTelemetryEnabled, isTelemetryEnabled } = await import("../src/lib/telemetry.ts");
    await setTelemetryEnabled(false);
    expect(await isTelemetryEnabled()).toBe(false);
    await setTelemetryEnabled(true);
    expect(await isTelemetryEnabled()).toBe(true);
  });

  test("track is no-op when disabled", async () => {
    const { setTelemetryEnabled, track } = await import("../src/lib/telemetry.ts");
    await setTelemetryEnabled(false);
    await track("test_event", { foo: "bar" });
  });
});
