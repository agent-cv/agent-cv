import type { Inventory, Project } from "../types.ts";

/**
 * Determine which pipeline phases can be skipped on return runs.
 * Pure function — easy to test.
 */
export function shouldSkipPhases(
  inventory: Inventory,
  projects: Project[],
  flags: { interactive?: boolean; agent?: string }
): { skipEmails: boolean; skipSelector: boolean; skipAgent: boolean } {
  if (flags.interactive) {
    return { skipEmails: false, skipSelector: false, skipAgent: false };
  }

  const skipEmails = inventory.profile.emailsConfirmed === true;

  const hasSavedSelections = projects.some((p) => p.included !== undefined);
  const hasNoNewProjects = projects.every((p) => !p.tags.includes("new"));
  const skipSelector = hasNoNewProjects && hasSavedSelections;

  const skipAgent = !!(
    (flags.agent || inventory.lastAgent) &&
    !flags.interactive
  );

  return { skipEmails, skipSelector, skipAgent };
}
