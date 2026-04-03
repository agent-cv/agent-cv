import simpleGit from "simple-git";

export interface GitMetadata {
  firstCommitDate: string;
  lastCommitDate: string;
  totalCommits: number;
  authorCommits: number;
  authorEmail: string;
}

/**
 * Collect all known identities (name + emails) for the current user.
 *
 * Sources:
 * 1. Global git config (user.name + user.email)
 * 2. includeIf configs (~/.gitconfig conditional includes for work dirs)
 * 3. Environment variables (GIT_AUTHOR_EMAIL, GIT_COMMITTER_EMAIL)
 * 4. User-provided extras (--email flag)
 *
 * Call once at scan start. As repos are scanned, discoverRepoIdentity()
 * expands this set by matching author names across emails.
 */
export interface UserIdentity {
  emails: Set<string>;
  names: Set<string>;
}

export async function collectUserIdentity(
  extraEmails: string[] = []
): Promise<UserIdentity> {
  const emails = new Set<string>();
  const names = new Set<string>();

  // 1. Global git config
  try {
    const git = simpleGit();

    try {
      const globalEmail = (
        await git.raw(["config", "--global", "user.email"])
      ).trim();
      if (globalEmail) emails.add(globalEmail.toLowerCase());
    } catch { /* no global email */ }

    try {
      const globalName = (
        await git.raw(["config", "--global", "user.name"])
      ).trim();
      if (globalName) names.add(globalName.toLowerCase());
    } catch { /* no global name */ }

    // 2. Parse includeIf from global gitconfig for conditional emails
    try {
      const allConfig = await git.raw(["config", "--global", "--list"]);
      for (const line of allConfig.split("\n")) {
        if (line.startsWith("includeif.") && line.includes("user.email")) {
          // Can't directly extract, but we can get all user.email entries
          continue;
        }
        // Catch any user.email from included configs
        if (line.startsWith("user.email=")) {
          const email = line.split("=")[1]?.trim();
          if (email) emails.add(email.toLowerCase());
        }
      }
    } catch { /* can't read config list */ }
  } catch {
    // git not available
  }

  // 3. Environment variables
  for (const envVar of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) {
    const val = process.env[envVar];
    if (val) emails.add(val.toLowerCase());
  }
  for (const envVar of ["GIT_AUTHOR_NAME", "GIT_COMMITTER_NAME"]) {
    const val = process.env[envVar];
    if (val) names.add(val.toLowerCase());
  }

  // 4. User-provided extras
  for (const e of extraEmails) {
    if (e.includes("@")) emails.add(e.toLowerCase());
  }

  return { emails, names };
}

/**
 * Discover if a repo belongs to the user by checking multiple signals:
 *
 * 1. Repo-local git config email matches known emails
 * 2. Repo-local git config name matches known names (different email, same person)
 * 3. Sole committer heuristic: if ONE person made all commits, it's their project
 * 4. Name matching in shortlog: same name with a new email = same person
 *
 * When a new email is discovered via name matching, it's added to the identity
 * so subsequent repos benefit.
 */
export async function discoverRepoIdentity(
  dir: string,
  identity: UserIdentity
): Promise<void> {
  try {
    const git = simpleGit(dir);

    // Check repo-local config
    try {
      const localEmail = (
        await git.raw(["config", "--local", "user.email"])
      ).trim().toLowerCase();
      if (localEmail && !identity.emails.has(localEmail)) {
        // New email in local config. Check if the name matches.
        try {
          const localName = (
            await git.raw(["config", "--local", "user.name"])
          ).trim().toLowerCase();
          if (localName && identity.names.has(localName)) {
            // Same name, different email. This is the same person.
            identity.emails.add(localEmail);
            identity.names.add(localName);
          }
        } catch { /* no local name */ }
      }
    } catch { /* no local config */ }

    // Check commit log for name matches
    // git shortlog -sne gives: "  42\tIvan Petrov <ivan@gmail.com>"
    try {
      const shortlog = await git.raw(["shortlog", "-sne", "--no-merges", "HEAD"]);
      for (const line of shortlog.split("\n")) {
        const match = line.match(/^\s*\d+\t(.+?)\s+<(.+?)>$/);
        if (!match) continue;
        const [, name, email] = match;
        if (!name || !email) continue;

        const normName = name.toLowerCase();
        const normEmail = email.toLowerCase();

        // If we know this name but not this email, add it
        if (identity.names.has(normName) && !identity.emails.has(normEmail)) {
          identity.emails.add(normEmail);
        }

        // If we know this email but not this name, add it
        if (identity.emails.has(normEmail) && !identity.names.has(normName)) {
          identity.names.add(normName);
        }
      }
    } catch { /* can't read shortlog */ }

    // Sole committer heuristic: if only one person committed, it's their project
    try {
      const shortlog = await git.raw(["shortlog", "-sne", "--no-merges", "HEAD"]);
      const contributors = shortlog.trim().split("\n").filter(Boolean);
      if (contributors.length === 1) {
        const match = contributors[0]!.match(/^\s*\d+\t(.+?)\s+<(.+?)>$/);
        if (match) {
          const [, name, email] = match;
          if (name && email) {
            identity.emails.add(email.toLowerCase());
            identity.names.add(name.toLowerCase());
          }
        }
      }
    } catch { /* ignore */ }

  } catch {
    // not a git repo or git unavailable
  }
}

/**
 * Extract git metadata from a repository.
 * Uses the full user identity (multiple emails + names) to count "my" commits.
 */
export async function extractGitMetadata(
  dir: string,
  identity: UserIdentity
): Promise<GitMetadata | null> {
  try {
    const git = simpleGit(dir);

    const isRepo = await git.checkIsRepo();
    if (!isRepo) return null;

    // Get total commit count
    let totalCommits = 0;
    try {
      const countOutput = await git.raw(["rev-list", "--count", "HEAD"]);
      totalCommits = parseInt(countOutput.trim(), 10) || 0;
    } catch {
      return null;
    }

    // Get first and last commit dates
    let firstCommitDate = "";
    let lastCommitDate = "";
    try {
      const firstLog = await git.raw([
        "log",
        "--reverse",
        "--format=%aI",
        "--max-count=1",
      ]);
      firstCommitDate = firstLog.trim().split("T")[0] || "";

      const lastLog = await git.raw(["log", "--format=%aI", "--max-count=1"]);
      lastCommitDate = lastLog.trim().split("T")[0] || "";
    } catch {
      // Can't get dates
    }

    // Count commits across ALL known user emails
    let authorCommits = 0;
    let matchedEmail = "";

    for (const email of identity.emails) {
      try {
        const count = await git.raw([
          "rev-list",
          "--count",
          "--author",
          email,
          "HEAD",
        ]);
        const n = parseInt(count.trim(), 10) || 0;
        authorCommits += n;
        if (n > 0 && !matchedEmail) matchedEmail = email;
      } catch {
        // ignore
      }
    }

    // Fallback: check repo-local config email
    if (authorCommits === 0) {
      try {
        const localEmail = (
          await git.raw(["config", "user.email"])
        ).trim();
        if (localEmail) {
          const count = await git.raw([
            "rev-list",
            "--count",
            "--author",
            localEmail,
            "HEAD",
          ]);
          const n = parseInt(count.trim(), 10) || 0;
          authorCommits = n;
          matchedEmail = localEmail;
        }
      } catch {
        // ignore
      }
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
