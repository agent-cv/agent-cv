#!/usr/bin/env bun
/**
 * Build for npm distribution.
 * Bundles all TS/TSX into a single minified JS file.
 * Bun's minifier handles: whitespace removal, identifier mangling,
 * dead code elimination, syntax compression.
 */

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

// Ensure shebang
const output = code.startsWith("#!") ? code : `#!/usr/bin/env bun\n${code}`;
await Bun.write("dist/cli.js", output);

const sizeKB = (output.length / 1024).toFixed(0);
console.log(`Done. dist/cli.js — ${sizeKB}KB minified`);
console.log(`643 modules bundled into 1 file.`);
