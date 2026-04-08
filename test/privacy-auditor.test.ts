import { describe, test, expect, beforeAll } from "bun:test";
import { scanForSecrets } from "@agent-cv/core/src/discovery/privacy-auditor.ts";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const FIXTURES = join(import.meta.dir, "fixtures", "privacy");

beforeAll(async () => {
  await mkdir(FIXTURES, { recursive: true });

  // .env file
  await writeFile(join(FIXTURES, ".env"), "SECRET=abc123");
  await writeFile(join(FIXTURES, ".env.production"), "DB_PASSWORD=hunter2");

  // API key in source
  await writeFile(join(FIXTURES, "app.ts"), 'const API_KEY = "something_secret";\nexport default API_KEY;');

  // GitHub token in source
  await writeFile(join(FIXTURES, "deploy.sh"), 'curl -H "Authorization: Bearer ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" https://api.github.com');

  // Clean file (no secrets)
  await writeFile(join(FIXTURES, "clean.ts"), 'export const hello = "world";');

  // Private key file
  await writeFile(join(FIXTURES, "server.pem"), "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----");

  // credentials.json
  await writeFile(join(FIXTURES, "credentials.json"), '{"client_id": "abc"}');
});

describe("scanForSecrets", () => {
  test("detects .env files", async () => {
    const result = await scanForSecrets(FIXTURES);
    expect(result.excludedFiles).toContain(".env");
    expect(result.excludedFiles).toContain(".env.production");
  });

  test("detects API keys in source code", async () => {
    const result = await scanForSecrets(FIXTURES);
    expect(result.excludedFiles).toContain("app.ts");
  });

  test("detects GitHub tokens in source", async () => {
    const result = await scanForSecrets(FIXTURES);
    expect(result.excludedFiles).toContain("deploy.sh");
  });

  test("detects .pem files", async () => {
    const result = await scanForSecrets(FIXTURES);
    expect(result.excludedFiles).toContain("server.pem");
  });

  test("detects credentials.json", async () => {
    const result = await scanForSecrets(FIXTURES);
    expect(result.excludedFiles).toContain("credentials.json");
  });

  test("does not flag clean files", async () => {
    const result = await scanForSecrets(FIXTURES);
    expect(result.excludedFiles).not.toContain("clean.ts");
  });

  test("returns count matching excluded files", async () => {
    const result = await scanForSecrets(FIXTURES);
    expect(result.secretsFound).toBe(result.excludedFiles.length);
  });

  test("handles non-existent directory", async () => {
    const result = await scanForSecrets("/tmp/does-not-exist-privacy-test");
    expect(result.secretsFound).toBe(0);
    expect(result.excludedFiles).toEqual([]);
  });
});
