/** Client-safe classification of change types; no server imports. */
export type ChangeCategory = "idl" | "code" | "authority" | "governance" | "verification";

const CATEGORY: Record<string, ChangeCategory> = {
  program_upgraded: "code",
  program_closed: "code",
  upgrade_authority_changed: "authority",
  program_made_immutable: "authority",
  squads_config_changed: "governance",
  squads_proposal_created: "governance",
  squads_proposal_approved: "governance",
  squads_proposal_cancelled: "governance",
  verification_lost: "verification",
  verification_gained: "verification",
};

const LABELS: Record<string, string> = {
  program_upgraded: "Program upgraded",
  program_closed: "Program closed",
  upgrade_authority_changed: "Upgrade authority changed",
  program_made_immutable: "Program made immutable",
  squads_config_changed: "Multisig reconfigured",
  squads_proposal_created: "Upgrade proposed",
  squads_proposal_approved: "Upgrade approved",
  squads_proposal_cancelled: "Proposal cancelled",
  verification_lost: "Verification lost",
  verification_gained: "Verified build",
  idl_removed: "IDL removed",
};

export const CATEGORY_LABELS: Record<ChangeCategory, string> = {
  idl: "IDL",
  code: "Code",
  authority: "Authority",
  governance: "Governance",
  verification: "Verification",
};

export function changeCategory(changeType: string | undefined | null): ChangeCategory {
  return (changeType && CATEGORY[changeType]) || "idl";
}

/** "instruction_modified" → "Instruction modified"; known on-chain events get curated labels. */
export function changeTypeLabel(changeType: string): string {
  const known = LABELS[changeType];
  if (known) return known;
  const words = changeType.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function changeTypesInCategory(category: ChangeCategory): string[] | null {
  if (category === "idl") return null;
  return Object.entries(CATEGORY)
    .filter(([, value]) => value === category)
    .map(([type]) => type);
}

/** Alert headline noun: "IDL change" only when every change is an IDL diff. */
export function alertNoun(changeTypes: Array<string | undefined>): string {
  return changeTypes.every((type) => changeCategory(type) === "idl")
    ? "IDL change"
    : "Program change";
}
