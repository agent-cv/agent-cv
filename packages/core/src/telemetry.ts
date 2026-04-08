import { PostHog } from "posthog-node";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const POSTHOG_KEY = process.env.AGENT_CV_POSTHOG_KEY || "phc_quQ9BNeTjYuEmQPfTXX7MaztQPovZgh5JBErxy9whJzL";
const POSTHOG_HOST = process.env.AGENT_CV_POSTHOG_HOST || "https://us.i.posthog.com";

import { getDataDir, resetDataDir } from "./data-dir.ts";
export { resetDataDir };

interface TelemetryState {
  enabled?: boolean;
  prompted?: boolean;
  anonymousId?: string;
}

let stateCache: TelemetryState | null = null;
let client: PostHog | null = null;

async function readState(): Promise<TelemetryState> {
  if (stateCache) return stateCache;
  try {
    const content = await readFile(join(getDataDir(), "telemetry.json"), "utf-8");
    stateCache = JSON.parse(content);
    return stateCache!;
  } catch {
    return {};
  }
}

async function writeState(state: TelemetryState): Promise<void> {
  stateCache = state;
  await mkdir(getDataDir(), { recursive: true });
  await writeFile(join(getDataDir(), "telemetry.json"), JSON.stringify(state, null, 2), "utf-8");
}

function getClient(): PostHog | null {
  if (process.env.AGENT_CV_TELEMETRY === "off") return null;
  if (!client) {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      flushAt: 5,
      flushInterval: 10000,
    });
  }
  return client;
}

async function getAnonymousId(): Promise<string> {
  const state = await readState();
  if (state.anonymousId) return state.anonymousId;
  const id = randomUUID();
  await writeState({ ...state, anonymousId: id });
  return id;
}

/**
 * Check if telemetry is enabled. ON by default — user opts out via config.
 */
export async function isTelemetryEnabled(): Promise<boolean> {
  if (process.env.AGENT_CV_TELEMETRY === "off") return false;
  const state = await readState();
  return state.enabled ?? true;
}

/**
 * Check if user has seen the telemetry notice.
 * Returns true if notice was already shown.
 */
export async function markNoticeSeen(): Promise<boolean> {
  const state = await readState();
  if (state.prompted) return true;
  await writeState({ ...state, prompted: true, enabled: state.enabled ?? true });
  return false;
}

/**
 * Set telemetry preference.
 */
export async function setTelemetryEnabled(enabled: boolean): Promise<void> {
  const state = await readState();
  await writeState({ ...state, enabled, prompted: true });
}

/**
 * Track wall-clock duration for a named pipeline step (scan, analyze, etc.).
 * No PII — use aggregate counts and step ids only.
 */
export async function trackPipelineStep(
  step: string,
  durationMs: number,
  extra?: Record<string, string | number | boolean | undefined>
): Promise<void> {
  const properties: Record<string, string | number | boolean> = {
    step,
    duration_ms: durationMs,
  };
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v !== undefined) properties[k] = v as string | number | boolean;
    }
  }
  await track("pipeline_step", properties);
}

/**
 * Run an async function and record its duration as a pipeline_step event.
 */
export async function withPipelineTiming<T>(
  step: string,
  fn: () => Promise<T>,
  extra?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    await trackPipelineStep(step, Date.now() - t0, extra);
  }
}

/**
 * Track an event. No-op if telemetry is disabled.
 * Never includes PII, file paths, project names, or content.
 */
export async function track(event: string, properties?: Record<string, string | number | boolean>): Promise<void> {
  if (!(await isTelemetryEnabled())) return;
  const ph = getClient();
  if (!ph) return;
  const id = await getAnonymousId();
  ph.capture({
    distinctId: id,
    event,
    properties: {
      ...properties,
      cli_version: "0.1.2",
      os: process.platform,
      arch: process.arch,
    },
  });
}

/**
 * Flush pending events. Call before process exits.
 */
export async function flush(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
