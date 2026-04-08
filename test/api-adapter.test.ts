import { describe, expect, test } from "bun:test";
import {
  extractFirstJsonObject,
  extractJsonCandidate,
  parseApiAnalysisResponse,
  parseClaudeCliAnalysisResponse,
  parseOllamaAnalysisResponse,
  parseStructuredAnalysisResponse,
  unwrapClaudeCliJsonStdout,
} from "@agent-cv/core/src/analysis/api-parse.ts";

describe("extractFirstJsonObject", () => {
  test("returns first object when two JSON values appear", () => {
    const first = JSON.stringify({
      summary: "first",
      techStack: ["A"],
      contributions: ["c"],
    });
    const second = JSON.stringify({ summary: "second", techStack: ["B"], contributions: ["d"] });
    const raw = `Prefix ${first} suffix ${second}`;
    expect(extractFirstJsonObject(raw)).toBe(first);
  });

  test("handles closing brace inside a JSON string value", () => {
    const obj = JSON.stringify({
      summary: "Use } carefully",
      techStack: ["T"],
      contributions: ["x"],
    });
    expect(extractFirstJsonObject(`noise ${obj} tail`)).toBe(obj);
  });
});

describe("extractJsonCandidate", () => {
  test("returns first JSON object from plain text", () => {
    const raw = `Here you go: {"a":1}`;
    expect(extractJsonCandidate(raw)).toBe(`{"a":1}`);
  });

  test("prefers fenced ```json block when present", () => {
    const raw = `Analysis:\n\`\`\`json\n{"summary":"x","techStack":["T"],"contributions":["c"],"impactScore":5}\n\`\`\``;
    expect(extractJsonCandidate(raw)).toBe(
      `{"summary":"x","techStack":["T"],"contributions":["c"],"impactScore":5}`
    );
  });
});

describe("parseApiAnalysisResponse", () => {
  test("parses minimal valid analysis (snapshot shape)", () => {
    const raw = JSON.stringify({
      summary: "A test project.",
      techStack: ["TypeScript"],
      contributions: ["Setup"],
      impactScore: 6,
    });
    const out = parseApiAnalysisResponse(raw);
    expect(out.summary).toBe("A test project.");
    expect(out.techStack).toEqual(["TypeScript"]);
    expect(out.contributions).toEqual(["Setup"]);
    expect(out.impactScore).toBe(6);
    expect(out.analyzedBy).toBe("api");
    expect(out.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("clamps impactScore to 1–10", () => {
    const raw = JSON.stringify({
      summary: "S",
      techStack: ["T"],
      contributions: ["C"],
      impactScore: 99,
    });
    expect(parseApiAnalysisResponse(raw).impactScore).toBe(10);
    const low = JSON.stringify({
      summary: "S",
      techStack: ["T"],
      contributions: ["C"],
      impactScore: 0,
    });
    expect(parseApiAnalysisResponse(low).impactScore).toBe(1);
  });

  test("coerces numeric impactScore from string", () => {
    const raw = JSON.stringify({
      summary: "S",
      techStack: ["T"],
      contributions: ["C"],
      impactScore: "8",
    });
    expect(parseApiAnalysisResponse(raw).impactScore).toBe(8);
  });

  test("throws when summary is empty", () => {
    const raw = JSON.stringify({
      summary: "",
      techStack: ["T"],
      contributions: ["C"],
    });
    expect(() => parseApiAnalysisResponse(raw)).toThrow("empty summary");
  });

  test("throws when techStack is empty", () => {
    const raw = JSON.stringify({
      summary: "OK",
      techStack: [],
      contributions: ["C"],
    });
    expect(() => parseApiAnalysisResponse(raw)).toThrow("empty techStack");
  });

  test("filters non-string entries from arrays", () => {
    const raw = JSON.stringify({
      summary: "OK",
      techStack: ["TS", 1, null, "JS"],
      contributions: ["A", false, "B"],
      impactScore: 5,
    });
    const out = parseApiAnalysisResponse(raw);
    expect(out.techStack).toEqual(["TS", "JS"]);
    expect(out.contributions).toEqual(["A", "B"]);
  });
});

describe("parseStructuredAnalysisResponse", () => {
  test("sets analyzedBy for CLI adapters", () => {
    const raw = JSON.stringify({
      summary: "S",
      techStack: ["T"],
      contributions: ["C"],
    });
    expect(parseStructuredAnalysisResponse(raw, "codex").analyzedBy).toBe("codex");
    expect(parseStructuredAnalysisResponse(raw, "cursor").analyzedBy).toBe("cursor");
  });
});

describe("parseOllamaAnalysisResponse", () => {
  test("tags analyzedBy ollama", () => {
    const raw = JSON.stringify({
      summary: "Local model output",
      techStack: ["Rust"],
      contributions: ["CLI"],
    });
    expect(parseOllamaAnalysisResponse(raw).analyzedBy).toBe("ollama");
  });
});

describe("unwrapClaudeCliJsonStdout / parseClaudeCliAnalysisResponse", () => {
  test("unwraps Claude CLI JSON wrapper", () => {
    const inner = JSON.stringify({
      summary: "S",
      techStack: ["T"],
      contributions: ["C"],
    });
    const wrapped = JSON.stringify({ result: inner });
    expect(unwrapClaudeCliJsonStdout(wrapped)).toBe(inner);
  });

  test("parses analysis from wrapped stdout", () => {
    const inner = JSON.stringify({
      summary: "From Claude",
      techStack: ["TS"],
      contributions: ["X"],
      impactScore: 7,
    });
    const out = parseClaudeCliAnalysisResponse(JSON.stringify({ result: inner }));
    expect(out.analyzedBy).toBe("claude");
    expect(out.summary).toBe("From Claude");
  });
});
