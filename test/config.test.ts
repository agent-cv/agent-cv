import { describe, test, expect } from "bun:test";
import { readConfig, writeConfig } from "../src/lib/config.ts";

describe("config", () => {
  test("readConfig returns defaults when no file", async () => {
    const config = await readConfig();
    expect(config.emails).toBeDefined();
    expect(config.emailsConfirmed).toBeDefined();
  });

  test("writeConfig and readConfig roundtrip", async () => {
    const testConfig = {
      emails: ["test@example.com", "work@company.com"],
      emailsConfirmed: true,
    };
    await writeConfig(testConfig);
    const read = await readConfig();
    expect(read.emails).toEqual(testConfig.emails);
    expect(read.emailsConfirmed).toBe(true);
  });
});
