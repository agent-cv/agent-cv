import simpleGit from "simple-git";

export interface GitMetadata {
  firstCommitDate: string;
  lastCommitDate: string;
  totalCommits: number;
  authorCommits: number;
  authorEmail: string;
}

/**
 * Collect known user emails from reliable sources only.
 *
 * Reliable = things the user explicitly configured on their machine:
 * 1. Global git config (user.email)
 * 2. Per-directory git configs (includeIf in ~/.gitconfig)
 * 3. Repo-local git configs (git config --local user.email)
 * 4. Environment variables (GIT_AUTHOR_EMAIL)
 * 5. User-provided extras (--email flag)
 *
 * Does NOT use name matching or sole-committer heuristics.
 * Those produce false positives (common names, cloned repos).
 */
export async function collectUserEmails(
  extraEmails: string[] = []
): Promise<Set<string>> {
  const emails = new Set<string>();

  try {
    const git = simpleGit();

    // Global email
    try {
      const globalEmail = (
        await git.raw(["config", "--global", "user.email"])
      ).trim();
      if (globalEmail) emails.add(globalEmail.toLowerCase());
    } catch { /* no global email */ }

    // All emails from global config (catches includeIf conditional configs)
    try {
      const allConfig = await git.raw(["config", "--global", "--get-all", "user.email"]);
      for (const line of allConfig.split("\n")) {
        const email = line.trim();
        if (email && email.includes("@")) emails.add(email.toLowerCase());
      }
    } catch { /* single or no entries */ }
  } catch {
    // git not available
  }

  // Environment variables
  for (const envVar of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) {
    const val = process.env[envVar];
    if (val) emails.add(val.toLowerCase());
  }

  // User-provided extras
  for (const e of extraEmails) {
    if (e.includes("@")) emails.add(e.toLowerCase());
  }

  return emails;
}

/**
 * Discover the repo-local git config email.
 * This is reliable because the user set it themselves on their machine.
 * Returns the email if found, or null.
 */
export async function discoverRepoLocalEmail(
  dir: string
): Promise<string | null> {
  try {
    const git = simpleGit(dir);
    const localEmail = (
      await git.raw(["config", "--local", "user.email"])
    ).trim().toLowerCase();
    return localEmail || null;
  } catch {
    return null;
  }
}

/**
 * Bot/automated email patterns to filter out from the picker.
 * These are never real users.
 */
const BOT_EMAIL_PATTERNS = [
  /noreply/i,
  /\bbot\b/i,
  /dependabot/i,
  /renovate/i,
  /greenkeeper/i,
  /snyk/i,
  /github-actions/i,
  /\[bot\]/i,
  /mergify/i,
  /semantic-release/i,
  /users\.noreply\.github\.com$/i,
];

function isBotEmail(email: string): boolean {
  return BOT_EMAIL_PATTERNS.some((p) => p.test(email));
}

/**
 * Collect unique email addresses found across scanned repos.
 * Filters out bots and automated accounts.
 * Returns a map of email → number of repos it appears in.
 *
 * Only collects emails that appear in the local git config of each repo,
 * NOT from all committers in the repo. This limits the list to emails
 * that were configured on THIS machine.
 */
export async function collectAllRepoEmails(
  dirs: string[]
): Promise<Map<string, number>> {
  const emailCounts = new Map<string, number>();

  for (const dir of dirs) {
    try {
      const git = simpleGit(dir);
      const isRepo = await git.checkIsRepo();
      if (!isRepo) continue;

      // Only get the email configured in this repo (local or inherited global)
      // This is the email the user USED on this machine, not all committers
      try {
        const configEmail = (await git.raw(["config", "user.email"])).trim().toLowerCase();
        if (configEmail && !isBotEmail(configEmail)) {
          emailCounts.set(configEmail, (emailCounts.get(configEmail) || 0) + 1);
        }
      } catch {
        // no email configured for this repo
      }
    } catch {
      // skip
    }
  }

  return emailCounts;
}

/**
 * Recount author commits for a project using a new set of emails.
 * Fast: only runs git rev-list --count, no filesystem scan.
 */
export async function recountAuthorCommits(
  dir: string,
  emails: string[]
): Promise<{ authorCommits: number; matchedEmail: string }> {
  let authorCommits = 0;
  let matchedEmail = "";

  try {
    const git = simpleGit(dir);
    for (const email of emails) {
      try {
        const count = await git.raw([
          "rev-list", "--count", "--author", email, "HEAD",
        ]);
        const n = parseInt(count.trim(), 10) || 0;
        authorCommits += n;
        if (n > 0 && !matchedEmail) matchedEmail = email;
      } catch { /* ignore */ }
    }
  } catch { /* not a git repo */ }

  return { authorCommits, matchedEmail };
}

/**
 * Extract git metadata from a repository.
 * Counts commits matching ANY of the user's known emails.
 */
export async function extractGitMetadata(
  dir: string,
  userEmails: Set<string>
): Promise<GitMetadata | null> {
  try {
    const git = simpleGit(dir);

    const isRepo = await git.checkIsRepo();
    if (!isRepo) return null;

    let totalCommits = 0;
    try {
      const countOutput = await git.raw(["rev-list", "--count", "HEAD"]);
      totalCommits = parseInt(countOutput.trim(), 10) || 0;
    } catch {
      return null;
    }

    let firstCommitDate = "";
    let lastCommitDate = "";
    try {
      const firstLog = await git.raw([
        "log", "--reverse", "--format=%aI", "--max-count=1",
      ]);
      firstCommitDate = firstLog.trim().split("T")[0] || "";

      const lastLog = await git.raw(["log", "--format=%aI", "--max-count=1"]);
      lastCommitDate = lastLog.trim().split("T")[0] || "";
    } catch { /* can't get dates */ }

    // Count commits across all known user emails
    let authorCommits = 0;
    let matchedEmail = "";

    for (const email of userEmails) {
      try {
        const count = await git.raw([
          "rev-list", "--count", "--author", email, "HEAD",
        ]);
        const n = parseInt(count.trim(), 10) || 0;
        authorCommits += n;
        if (n > 0 && !matchedEmail) matchedEmail = email;
      } catch { /* ignore */ }
    }

    return {
      firstCommitDate,
      lastCommitDate,
      totalCommits,
      authorCommits,
      authorEmail: matchedEmail,
    };
  } catch {
    return null;
  }
}
