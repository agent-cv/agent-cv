import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const BANNER_WIDTH = 1024;
const BANNER_HEIGHT = 273;
const DEVICE_PRESET = "Desktop Chrome HiDPI";

const htmlPath = resolve(".github/assets/hero-banner.html");
const pngPath = resolve(".github/assets/hero-banner.png");
const fileUrl = `file://${htmlPath}`;

execFileSync(
  "npx",
  [
    "-y",
    "playwright",
    "screenshot",
    "--browser=chromium",
    `--device=${DEVICE_PRESET}`,
    `--viewport-size=${BANNER_WIDTH},${BANNER_HEIGHT}`,
    "--wait-for-selector=body.ready",
    "--wait-for-timeout=4000",
    fileUrl,
    pngPath,
  ],
  { stdio: "inherit" },
);

console.log(`Rendered banner: ${pngPath}`);
