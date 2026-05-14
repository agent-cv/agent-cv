#!/usr/bin/env bun
/**
 * Build for npm distribution.
 *
 * 1. Bundle src/cli.ts → dist/cli.js (single minified JS).
 * 2. Copy PGlite native assets (postgres.data, postgres.wasm) next to the
 *    bundle. The minified PGlite loader looks for these as siblings of the
 *    running script; without them the CLI hits ENOENT at first DB-touching
 *    command (publish, unpublish, generate).
 *
 * `package.json`'s `files` array must include both assets too — see there.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

console.log("Building for npm...");
const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "dist",
  target: "bun",
  minify: true,
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

const code = await Bun.file("dist/cli.js").text();
const output = code.startsWith("#!") ? code : `#!/usr/bin/env bun\n${code}`;
await Bun.write("dist/cli.js", output);

// Locate PGlite dist. It's a transitive dep (via bettersync) so node_modules
// layout depends on bun's hoist heuristics. Try a couple of known paths.
import { readdir, stat } from "node:fs/promises";
async function findPgliteDist(): Promise<string> {
  const candidates = [
    "node_modules/@electric-sql/pglite/dist",
  ];
  // .bun hoisted layout (most common with bun install)
  try {
    const entries = await readdir("node_modules/.bun");
    for (const e of entries) {
      if (e.startsWith("@electric-sql+pglite@")) {
        candidates.push(`node_modules/.bun/${e}/node_modules/@electric-sql/pglite/dist`);
      }
    }
  } catch {
    /* */
  }
  for (const c of candidates) {
    try {
      await stat(join(c, "postgres.data"));
      return c;
    } catch {
      /* */
    }
  }
  throw new Error("Could not find @electric-sql/pglite/dist — run `bun install` first");
}
const pgliteDist = await findPgliteDist();

await mkdir("dist", { recursive: true });
const assets = ["postgres.data", "postgres.wasm"];
for (const asset of assets) {
  const from = join(pgliteDist, asset);
  const to = join("dist", asset);
  try {
    await copyFile(from, to);
    const size = (await Bun.file(to).size) / 1024 / 1024;
    console.log(`Copied ${asset} (${size.toFixed(1)} MB)`);
  } catch (err) {
    console.error(`Failed to copy ${asset} from ${from}:`, err);
    process.exit(1);
  }
}

const sizeKB = (output.length / 1024).toFixed(0);
console.log(`Done. dist/cli.js — ${sizeKB}KB minified + PGlite assets.`);
