import type { Inventory } from "@agent-cv/core/src/types.ts";

export type ConfigField = {
  key: string;
  label: string;
  value: string;
  nested?: string;
};

export function buildConfigFields(
  inventory: Inventory,
  telemetryOn: boolean
): ConfigField[] {
  const { profile, insights } = inventory;
  return [
    { key: "name", label: "Name", value: profile.name || "" },
    {
      key: "bio",
      label: "Bio",
      value: insights.bio ? `${insights.bio.slice(0, 60)}...` : "(auto-generated on next run)",
    },
    { key: "emailPublic", label: "Show email publicly", value: profile.emailPublic ? "yes" : "no" },
    { key: "socials.github", label: "GitHub username", value: profile.socials?.github || "", nested: "github" },
    { key: "socials.linkedin", label: "LinkedIn", value: profile.socials?.linkedin || "", nested: "linkedin" },
    { key: "socials.twitter", label: "Twitter/X", value: profile.socials?.twitter || "", nested: "twitter" },
    { key: "socials.telegram", label: "Telegram", value: profile.socials?.telegram || "", nested: "telegram" },
    { key: "socials.website", label: "Website URL", value: profile.socials?.website || "", nested: "website" },
    { key: "telemetry", label: "Anonymous telemetry", value: telemetryOn ? "on" : "off" },
  ];
}

export type ConfigKeyEvent = {
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
};

/** Apply committed edit line to a copy of inventory; telemetry row updates telemetry flag only (caller persists). */
export function applyConfigFieldCommit(
  inventory: Inventory,
  field: ConfigField,
  editValue: string
): { inventory: Inventory; telemetryEnabled?: boolean } {
  const updated: Inventory = {
    ...inventory,
    profile: {
      ...inventory.profile,
      socials: inventory.profile.socials
        ? { ...inventory.profile.socials }
        : undefined,
    },
    insights: { ...inventory.insights },
  };

  if (field.key === "telemetry") {
    const enabled =
      editValue.toLowerCase().startsWith("on") || editValue.toLowerCase().startsWith("y");
    return { inventory: updated, telemetryEnabled: enabled };
  }
  if (field.key === "emailPublic") {
    updated.profile.emailPublic = editValue.toLowerCase().startsWith("y");
  } else if (field.key === "bio") {
    updated.insights = { ...updated.insights, bio: editValue || undefined };
  } else if (field.key === "name") {
    updated.profile.name = editValue || undefined;
  } else if (field.nested) {
    if (!updated.profile.socials) updated.profile.socials = {};
    (updated.profile.socials as Record<string, string | undefined>)[field.nested] = editValue || undefined;
  }

  return { inventory: updated };
}
