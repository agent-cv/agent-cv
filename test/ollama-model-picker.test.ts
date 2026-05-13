import { describe, expect, test } from "bun:test";
import {
  mergePreferredAndInstalledOllamaModels,
  OllamaAdapter,
  PREFERRED_OLLAMA_MODELS,
  RECOMMENDED_OLLAMA_MODEL,
} from "@agent-cv/core/src/analysis/adapters/ollama-adapter.ts";

describe("mergePreferredAndInstalledOllamaModels", () => {
  test("empty install: all preferred models show as download, recommended first", () => {
    const list = mergePreferredAndInstalledOllamaModels([]);
    expect(list.length).toBe(PREFERRED_OLLAMA_MODELS.length);
    expect(list[0]?.name).toBe(RECOMMENDED_OLLAMA_MODEL);
    expect(list[0]?.isRecommended).toBe(true);
    expect(list[0]?.needsDownload).toBe(true);
    expect(list.every((m) => m.needsDownload)).toBe(true);
  });

  test("extra local models not in preferred list are appended", () => {
    const list = mergePreferredAndInstalledOllamaModels([{ name: "custom:local", size: 100 }]);
    const custom = list.find((m) => m.name === "custom:local");
    expect(custom?.needsDownload).toBe(false);
    expect(list.length).toBe(PREFERRED_OLLAMA_MODELS.length + 1);
  });

  test("uses installed size when model is in preferred list", () => {
    const list = mergePreferredAndInstalledOllamaModels([{ name: "mistral:latest", size: 4.4e9 }]);
    const m = list.find((x) => x.name === "mistral:latest");
    expect(m?.needsDownload).toBe(false);
    expect(m?.size).toBe(4.4e9);
  });
});

describe("OllamaAdapter concurrency hint", () => {
  test("defaults to 1 — local Ollama serializes requests on single model instance", () => {
    const prev = process.env.OLLAMA_NUM_PARALLEL;
    delete process.env.OLLAMA_NUM_PARALLEL;
    const a = new OllamaAdapter();
    expect(a.maxConcurrency).toBe(1);
    if (prev !== undefined) process.env.OLLAMA_NUM_PARALLEL = prev;
  });

  test("respects OLLAMA_NUM_PARALLEL when set on daemon", () => {
    const prev = process.env.OLLAMA_NUM_PARALLEL;
    process.env.OLLAMA_NUM_PARALLEL = "4";
    const a = new OllamaAdapter();
    expect(a.maxConcurrency).toBe(4);
    if (prev === undefined) delete process.env.OLLAMA_NUM_PARALLEL;
    else process.env.OLLAMA_NUM_PARALLEL = prev;
  });
});
