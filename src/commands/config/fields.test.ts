import { describe, it, expect } from "bun:test";
import { applyConfigFieldCommit, buildConfigFields } from "./fields.ts";
import type { Inventory } from "@agent-cv/core/src/types.ts";

const baseInv: Inventory = {
  version: "1",
  lastScan: new Date().toISOString(),
  scanPaths: ["/tmp"],
  projects: [],
  profile: {
    emails: [],
    emailsConfirmed: true,
    name: "Ada",
    emailPublic: false,
    socials: { github: "ada" },
  },
  insights: { bio: "Hello" },
};

describe("buildConfigFields / applyConfigFieldCommit", () => {
  it("buildConfigFields includes telemetry row", () => {
    const fields = buildConfigFields(baseInv, true);
    expect(fields.some((f) => f.key === "telemetry" && f.value === "on")).toBe(true);
  });

  it("applyConfigFieldCommit updates nested social", () => {
    const field = buildConfigFields(baseInv, false).find((f) => f.nested === "linkedin")!;
    const { inventory } = applyConfigFieldCommit(baseInv, field, "ada-li");
    expect(inventory.profile.socials?.linkedin).toBe("ada-li");
    expect(inventory.profile.socials?.github).toBe("ada");
  });

  it("applyConfigFieldCommit returns telemetryEnabled for telemetry row", () => {
    const field = buildConfigFields(baseInv, false).find((f) => f.key === "telemetry")!;
    const r = applyConfigFieldCommit(baseInv, field, "on");
    expect(r.telemetryEnabled).toBe(true);
  });
});
