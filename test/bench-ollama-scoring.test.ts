import { describe, expect, test } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractGroundTruth, scoreTechStack } from "../scripts/bench-ollama.ts";

async function setupProject(files: Record<string, string>): Promise<string> {
  const dir = join(tmpdir(), `bench-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    const fullPath = join(dir, name);
    const parent = fullPath.substring(0, fullPath.lastIndexOf("/"));
    if (parent !== dir) await mkdir(parent, { recursive: true });
    await writeFile(fullPath, contents, "utf-8");
  }
  return dir;
}

describe("extractGroundTruth", () => {
  test("parses npm deps + keywords from package.json", async () => {
    const dir = await setupProject({
      "package.json": JSON.stringify({
        dependencies: { "@nestjs/core": "1.0", "pg": "8.0" },
        keywords: ["telegram", "bot"],
      }),
    });
    try {
      const gt = await extractGroundTruth(dir);
      expect(gt.has("@nestjs/core")).toBe(true);
      expect(gt.has("nestjs")).toBe(true); // scope name
      expect(gt.has("core")).toBe(true); // stripped
      expect(gt.has("pg")).toBe(true);
      expect(gt.has("telegram")).toBe(true);
      expect(gt.has("typescript")).toBe(true); // implicit from package.json
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("parses PEP-621 dependencies array from pyproject.toml", async () => {
    const dir = await setupProject({
      "pyproject.toml":
        '[project]\nname = "x"\ndependencies = ["flask", "numpy >= 1.0", "scapy"]\n',
    });
    try {
      const gt = await extractGroundTruth(dir);
      expect(gt.has("flask")).toBe(true);
      expect(gt.has("numpy")).toBe(true);
      expect(gt.has("scapy")).toBe(true);
      expect(gt.has("python")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("detects rust via Cargo.toml and language via file extensions", async () => {
    const dir = await setupProject({
      "Cargo.toml": '[package]\nname = "x"\n[dependencies]\ntokio = "1"\n',
      "src/main.rs": "fn main() {}",
    });
    try {
      const gt = await extractGroundTruth(dir);
      expect(gt.has("rust")).toBe(true);
      expect(gt.has("tokio")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("Anchor.toml adds solana + anchor + rust signals", async () => {
    const dir = await setupProject({
      "Anchor.toml": "[provider]\ncluster = \"localnet\"\n",
    });
    try {
      const gt = await extractGroundTruth(dir);
      expect(gt.has("solana")).toBe(true);
      expect(gt.has("anchor")).toBe(true);
      expect(gt.has("rust")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("scoreTechStack", () => {
  test("direct match: every detected tech in ground truth = 100%", () => {
    const gt = new Set(["typescript", "react", "vite"]);
    const r = scoreTechStack(["TypeScript", "React", "Vite"], gt);
    expect(r.score).toBe(1);
    expect(r.hallucinated).toEqual([]);
  });

  test("alias map: PostgreSQL matches pg dep", () => {
    const gt = new Set(["pg", "typescript"]);
    const r = scoreTechStack(["PostgreSQL", "TypeScript"], gt);
    expect(r.score).toBe(1);
  });

  test("alias map: Telegram Bot API matches grammy dep", () => {
    const gt = new Set(["grammy"]);
    const r = scoreTechStack(["Telegram Bot API"], gt);
    expect(r.score).toBe(1);
  });

  test("hallucinated tech reports as miss", () => {
    const gt = new Set(["typescript", "react"]);
    const r = scoreTechStack(["TypeScript", "MongoDB"], gt);
    expect(r.score).toBe(0.5);
    expect(r.hallucinated).toEqual(["MongoDB"]);
  });

  test("empty detected list returns score 0", () => {
    const r = scoreTechStack([], new Set(["react"]));
    expect(r.score).toBe(0);
    expect(r.hallucinated).toEqual([]);
  });

  test("token-level match: 'AWS S3' matches when gt has 'aws' or 's3'", () => {
    const gt = new Set(["@aws-sdk/client-s3", "aws", "sdk", "client", "s3"]);
    const r = scoreTechStack(["AWS S3"], gt);
    expect(r.score).toBe(1);
  });
});
