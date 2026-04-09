/**
 * Zod validation for inventory.json on read.
 */
import { z } from "zod";
import type { Inventory, InventoryProfile, ProfileInsights, Project } from "../types.ts";
import type { PublishedPackage } from "../types.ts";

const publishedPackageSchema: z.ZodType<PublishedPackage> = z.object({
  name: z.string(),
  description: z.string(),
  registry: z.enum(["npm", "pypi", "crates"]),
  url: z.string(),
  version: z.string().optional(),
});

const githubExtrasSchema = z.object({
  starredRepos: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      language: z.string().nullable(),
      stars: z.number(),
      url: z.string(),
    })
  ),
  contributions: z.array(
    z.object({
      repo: z.string(),
      type: z.string(),
      date: z.string(),
    })
  ),
  avatarUrl: z.string().optional(),
});

/** Projects may gain new fields over time; require stable ids and paths only. */
const projectSchema = z
  .object({
    id: z.string(),
    path: z.string(),
  })
  .passthrough();

const inventorySchema = z
  .object({
    version: z.string(),
    lastScan: z.string(),
    scanPaths: z.array(z.string()),
    projects: z.array(projectSchema),
    profile: z
      .object({
        emails: z.array(z.string()),
        emailsConfirmed: z.boolean(),
      })
      .passthrough(),
    insights: z.record(z.string(), z.any()).default({}),
    lastAgent: z.string().optional(),
    githubExtras: githubExtrasSchema.optional(),
    publishedPackages: z.array(publishedPackageSchema).optional(),
  })
  .passthrough();

export function parseInventoryJson(data: unknown): Inventory {
  const parsed = inventorySchema.parse(data);
  return {
    version: parsed.version,
    lastScan: parsed.lastScan,
    scanPaths: parsed.scanPaths,
    projects: parsed.projects as unknown as Project[],
    profile: parsed.profile as InventoryProfile,
    insights: parsed.insights as ProfileInsights,
    lastAgent: parsed.lastAgent,
    githubExtras: parsed.githubExtras,
    publishedPackages: parsed.publishedPackages,
  };
}
