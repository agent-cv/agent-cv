import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const CONFIG_DIR = join(process.env.HOME || "~", ".agent-cv");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Socials {
  github?: string;
  linkedin?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface Config {
  /** Confirmed user email addresses */
  emails: string[];
  /** Whether the email setup has been completed */
  emailsConfirmed: boolean;
  /** Display name for CV header */
  name?: string;
  /** AI-generated bio (regenerated on each full generate) */
  bio?: string;
  /** Social links */
  socials?: Socials;
  /** Whether email should be shown publicly on CV/website */
  emailPublic?: boolean;
}

function defaultConfig(): Config {
  return {
    emails: [],
    emailsConfirmed: false,
    emailPublic: false,
  };
}

export async function readConfig(): Promise<Config> {
  try {
    const content = await readFile(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(content);
    return { ...defaultConfig(), ...parsed };
  } catch {
    return defaultConfig();
  }
}

export async function writeConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  const tmpPath = join(
    CONFIG_DIR,
    `.config.tmp.${randomBytes(4).toString("hex")}`
  );
  try {
    await writeFile(tmpPath, JSON.stringify(config, null, 2), "utf-8");
    await rename(tmpPath, CONFIG_FILE);
  } catch {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmpPath);
    } catch { /* ignore */ }
  }
}
