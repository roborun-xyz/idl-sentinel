import type { SolanaIdl } from "../solana/idl-fetcher";
import type { ChangeType, ChangeSeverity, ChangeDetails } from "../db/changes";

export interface DetectedChange {
  changeType: ChangeType;
  changeSummary: string;
  changeDetails: ChangeDetails;
  severity: ChangeSeverity;
}

/**
 * Detects changes between two IDL versions
 */
export function detectChanges(oldIdl: SolanaIdl | null, newIdl: SolanaIdl): DetectedChange[] {
  const changes: DetectedChange[] = [];

  if (!oldIdl) {
    // First time seeing this IDL - not really a "change" but we can log it
    return [
      {
        changeType: "instruction_added",
        changeSummary: `Initial IDL detected for program ${newIdl.name}`,
        changeDetails: {
          changeType: "instruction_added",
          itemName: newIdl.name,
          newValue: newIdl,
          description: "Initial IDL snapshot created",
        },
        severity: "low",
      },
    ];
  }

  // Detect instruction changes
  changes.push(...detectInstructionChanges(oldIdl, newIdl));

  // Detect type changes
  changes.push(...detectTypeChanges(oldIdl, newIdl));

  // Detect account changes
  changes.push(...detectAccountChanges(oldIdl, newIdl));

  // Detect error changes
  changes.push(...detectErrorChanges(oldIdl, newIdl));

  return changes;
}

/**
 * Detects changes in instructions
 */
function detectInstructionChanges(oldIdl: SolanaIdl, newIdl: SolanaIdl): DetectedChange[] {
  const changes: DetectedChange[] = [];

  const oldInstructions = new Map(oldIdl.instructions?.map((i) => [i.name, i]) || []);
  const newInstructions = new Map(newIdl.instructions?.map((i) => [i.name, i]) || []);

  // Check for added instructions
  for (const [name, instruction] of newInstructions) {
    if (!oldInstructions.has(name)) {
      changes.push({
        changeType: "instruction_added",
        changeSummary: `New instruction '${name}' added`,
        changeDetails: {
          changeType: "instruction_added",
          itemName: name,
          newValue: instruction,
          description: `Added new instruction with ${instruction.accounts?.length || 0} accounts and ${instruction.args?.length || 0} arguments`,
        },
        severity: calculateInstructionSeverity("added", instruction),
      });
    }
  }

  // Check for removed instructions
  for (const [name, instruction] of oldInstructions) {
    if (!newInstructions.has(name)) {
      changes.push({
        changeType: "instruction_removed",
        changeSummary: `Instruction '${name}' removed`,
        changeDetails: {
          changeType: "instruction_removed",
          itemName: name,
          oldValue: instruction,
          description: `Removed instruction that had ${instruction.accounts?.length || 0} accounts and ${instruction.args?.length || 0} arguments`,
        },
        severity: "critical", // Removing instructions is always critical
      });
    }
  }

  // Check for modified instructions
  for (const [name, newInstruction] of newInstructions) {
    const oldInstruction = oldInstructions.get(name);
    if (oldInstruction && !deepEqual(oldInstruction, newInstruction)) {
      const modificationDetails = getInstructionModificationDetails(oldInstruction, newInstruction);

      changes.push({
        changeType: "instruction_modified",
        changeSummary: `Instruction '${name}' modified: ${modificationDetails.summary}`,
        changeDetails: {
          changeType: "instruction_modified",
          itemName: name,
          oldValue: oldInstruction,
          newValue: newInstruction,
          description: modificationDetails.description,
        },
        severity: modificationDetails.severity,
      });
    }
  }

  return changes;
}

/**
 * Detects changes in types
 */
function detectTypeChanges(oldIdl: SolanaIdl, newIdl: SolanaIdl): DetectedChange[] {
  const changes: DetectedChange[] = [];

  const oldTypes = new Map(oldIdl.types?.map((t) => [t.name, t]) || []);
  const newTypes = new Map(newIdl.types?.map((t) => [t.name, t]) || []);

  // Check for added types
  for (const [name, type] of newTypes) {
    if (!oldTypes.has(name)) {
      changes.push({
        changeType: "type_added",
        changeSummary: `New type '${name}' added`,
        changeDetails: {
          changeType: "type_added",
          itemName: name,
          newValue: type,
          description: `Added new ${type.type?.kind || "unknown"} type`,
        },
        severity: "low",
      });
    }
  }

  // Check for removed types
  for (const [name, type] of oldTypes) {
    if (!newTypes.has(name)) {
      changes.push({
        changeType: "type_removed",
        changeSummary: `Type '${name}' removed`,
        changeDetails: {
          changeType: "type_removed",
          itemName: name,
          oldValue: type,
          description: `Removed ${type.type?.kind || "unknown"} type`,
        },
        severity: "high", // Removing types can break compatibility
      });
    }
  }

  // Check for modified types
  for (const [name, newType] of newTypes) {
    const oldType = oldTypes.get(name);
    if (oldType && !deepEqual(oldType, newType)) {
      changes.push({
        changeType: "type_modified",
        changeSummary: `Type '${name}' modified`,
        changeDetails: {
          changeType: "type_modified",
          itemName: name,
          oldValue: oldType,
          newValue: newType,
          description: `Modified ${newType.type?.kind || "unknown"} type structure`,
        },
        severity: "medium",
      });
    }
  }

  return changes;
}

/**
 * Detects changes in accounts
 */
function detectAccountChanges(oldIdl: SolanaIdl, newIdl: SolanaIdl): DetectedChange[] {
  const changes: DetectedChange[] = [];

  const oldAccounts = new Map(oldIdl.accounts?.map((a) => [a.name, a]) || []);
  const newAccounts = new Map(newIdl.accounts?.map((a) => [a.name, a]) || []);

  // Check for added accounts
  for (const [name, account] of newAccounts) {
    if (!oldAccounts.has(name)) {
      changes.push({
        changeType: "account_added",
        changeSummary: `New account type '${name}' added`,
        changeDetails: {
          changeType: "account_added",
          itemName: name,
          newValue: account,
          description: `Added new account type with ${account.type?.fields?.length || 0} fields`,
        },
        severity: "low",
      });
    }
  }

  // Check for removed accounts
  for (const [name, account] of oldAccounts) {
    if (!newAccounts.has(name)) {
      changes.push({
        changeType: "account_removed",
        changeSummary: `Account type '${name}' removed`,
        changeDetails: {
          changeType: "account_removed",
          itemName: name,
          oldValue: account,
          description: `Removed account type that had ${account.type?.fields?.length || 0} fields`,
        },
        severity: "high",
      });
    }
  }

  // Check for modified accounts
  for (const [name, newAccount] of newAccounts) {
    const oldAccount = oldAccounts.get(name);
    if (oldAccount && !deepEqual(oldAccount, newAccount)) {
      changes.push({
        changeType: "account_modified",
        changeSummary: `Account type '${name}' modified`,
        changeDetails: {
          changeType: "account_modified",
          itemName: name,
          oldValue: oldAccount,
          newValue: newAccount,
          description: `Modified account type structure`,
        },
        severity: "high",
      });
    }
  }

  return changes;
}

/**
 * Detects changes in errors
 */
function detectErrorChanges(oldIdl: SolanaIdl, newIdl: SolanaIdl): DetectedChange[] {
  const changes: DetectedChange[] = [];

  const oldErrors = new Map(oldIdl.errors?.map((e) => [e.code ?? e.name, e]) || []);
  const newErrors = new Map(newIdl.errors?.map((e) => [e.code ?? e.name, e]) || []);

  // Check for added errors
  for (const [key, error] of newErrors) {
    if (!oldErrors.has(key)) {
      changes.push({
        changeType: "error_added",
        changeSummary: `New error ${formatErrorKey(key)} added: ${error.name}`,
        changeDetails: {
          changeType: "error_added",
          itemName: error.name,
          newValue: error,
          description: `Added error: ${error.msg || error.name}`,
        },
        severity: "low",
      });
    }
  }

  // Check for removed errors
  for (const [key, error] of oldErrors) {
    if (!newErrors.has(key)) {
      changes.push({
        changeType: "error_removed",
        changeSummary: `Error ${formatErrorKey(key)} removed: ${error.name}`,
        changeDetails: {
          changeType: "error_removed",
          itemName: error.name,
          oldValue: error,
          description: `Removed error: ${error.msg || error.name}`,
        },
        severity: "medium",
      });
    }
  }

  // Check for modified errors
  for (const [key, newError] of newErrors) {
    const oldError = oldErrors.get(key);
    if (oldError && !deepEqual(oldError, newError)) {
      changes.push({
        changeType: "error_modified",
        changeSummary: `Error ${formatErrorKey(key)} modified: ${newError.name}`,
        changeDetails: {
          changeType: "error_modified",
          itemName: newError.name,
          oldValue: oldError,
          newValue: newError,
          description: `Modified error message or name`,
        },
        severity: "low",
      });
    }
  }

  return changes;
}

/**
 * Calculates severity for instruction changes
 */
function calculateInstructionSeverity(
  changeType: "added" | "removed" | "modified",
  instruction: SolanaIdl["instructions"][number]
): ChangeSeverity {
  if (changeType === "removed") {
    return "critical";
  }

  if (changeType === "added") {
    // New instructions are generally low impact unless they're critical operations
    const criticalNames = ["initialize", "close", "withdraw", "transfer", "mint", "burn"];
    const isLikelyCritical = criticalNames.some((name) =>
      instruction.name.toLowerCase().includes(name)
    );
    return isLikelyCritical ? "medium" : "low";
  }

  return "medium"; // Modified instructions
}

/**
 * Gets detailed information about instruction modifications
 */
type Instruction = SolanaIdl["instructions"][number];
type InstructionAccount = Instruction["accounts"][number];
const severityRank: Record<ChangeSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function getInstructionModificationDetails(
  oldInstruction: Instruction,
  newInstruction: Instruction
) {
  const changes: string[] = [];
  let severity: ChangeSeverity = "medium";
  const add = (message: string, level: ChangeSeverity) => {
    changes.push(message);
    if (severityRank[level] > severityRank[severity]) severity = level;
  };
  const compareAccounts = (
    oldAccounts: InstructionAccount[],
    newAccounts: InstructionAccount[],
    path = ""
  ) => {
    if (oldAccounts.length !== newAccounts.length) add("accounts count changed", "high");
    for (let i = 0; i < Math.min(oldAccounts.length, newAccounts.length); i++) {
      const oldAcc = oldAccounts[i],
        newAcc = newAccounts[i];
      const name = path + newAcc.name;
      if (oldAcc.name !== newAcc.name) add("account order/name changed at " + name, "high");
      if (Boolean(oldAcc.isMut ?? oldAcc.writable) !== Boolean(newAcc.isMut ?? newAcc.writable))
        add("account " + name + " mutability changed", "high");
      if (Boolean(oldAcc.isSigner ?? oldAcc.signer) !== Boolean(newAcc.isSigner ?? newAcc.signer))
        add("account " + name + " signer requirement changed", "critical");
      compareAccounts(oldAcc.accounts || [], newAcc.accounts || [], name + ".");
    }
  };
  compareAccounts(oldInstruction.accounts || [], newInstruction.accounts || []);
  if (!deepEqual(oldInstruction.args || [], newInstruction.args || []))
    add("argument layout changed", "high");
  if (!deepEqual(oldInstruction.discriminator, newInstruction.discriminator))
    add("instruction discriminator changed", "critical");
  const summary = changes.join(", ") || "structure modified";
  return { summary, description: "Instruction modification details: " + summary, severity };
}

function formatErrorKey(key: string | number): string {
  return typeof key === "number" ? `code ${key}` : `'${key}'`;
}

/**
 * Deep equality check for objects
 */
function deepEqual(obj1: unknown, obj2: unknown): boolean {
  if (obj1 === obj2) return true;

  if (obj1 == null || obj2 == null) return false;

  if (typeof obj1 !== typeof obj2) return false;

  if (typeof obj1 !== "object") return obj1 === obj2;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (!Object.prototype.hasOwnProperty.call(obj2, key)) return false;
    if (!deepEqual((obj1 as Record<string, unknown>)[key], (obj2 as Record<string, unknown>)[key]))
      return false;
  }

  return true;
}
