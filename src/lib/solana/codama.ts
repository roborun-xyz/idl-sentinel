import type { SolanaIdl } from "./idl-fetcher";

/**
 * Codama is the IDL format published through Program Metadata by the
 * solana-program organization (SPL Token, Token-2022, System, ...). Its
 * `rootNode` is converted to the Anchor-like shape the change detector diffs,
 * keeping only what affects clients: names, account flags, argument and field
 * types, discriminators, and errors. Docs and display hints are dropped so a
 * documentation edit never reads as a type change.
 */

type Node = Record<string, unknown> & { kind?: string; name?: string };

const isNode = (value: unknown): value is Node =>
  !!value && typeof value === "object" && !Array.isArray(value);
const list = (value: unknown): Node[] => (Array.isArray(value) ? value.filter(isNode) : []);

export function isCodamaRoot(value: unknown): boolean {
  return (
    isNode(value) &&
    value.kind === "rootNode" &&
    value.standard === "codama" &&
    isNode(value.program)
  );
}

/** Recursively removes presentation-only keys from a type node. */
function stripPresentation(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPresentation);
  if (!isNode(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "docs" || key === "display") continue;
    out[key] = stripPresentation(child);
  }
  return out;
}

function structFields(type: unknown) {
  if (!isNode(type) || type.kind !== "structTypeNode") return null;
  return list(type.fields).map((field) => ({
    name: String(field.name),
    type: stripPresentation(field.type),
  }));
}

/** Discriminators as comparable values, resolving field discriminators to their defaults. */
function discriminators(node: Node, fields: Node[]): unknown[] | undefined {
  const entries = list(node.discriminators).map((d) => {
    if (d.kind === "fieldDiscriminatorNode") {
      const field = fields.find((f) => f.name === d.name);
      return { field: d.name, offset: d.offset, value: stripPresentation(field?.defaultValue) };
    }
    return stripPresentation(d);
  });
  return entries.length ? entries : undefined;
}

function convertType(type: unknown): NonNullable<SolanaIdl["types"]>[number]["type"] {
  const fields = structFields(type);
  if (fields) return { kind: "struct", fields };
  if (isNode(type) && type.kind === "enumTypeNode") {
    return {
      kind: "enum",
      variants: list(type.variants).map((variant) => {
        const name = String(variant.name);
        if (variant.kind === "enumStructVariantTypeNode") {
          return { name, fields: structFields(variant.struct) ?? [] };
        }
        if (variant.kind === "enumTupleVariantTypeNode" && isNode(variant.tuple)) {
          return {
            name,
            fields: list(variant.tuple.items).map((item, i) => ({
              name: String(i),
              type: stripPresentation(item),
            })),
          };
        }
        return { name };
      }),
    };
  }
  return {
    kind: isNode(type) ? String(type.kind) : "unknown",
    fields: [{ name: "value", type: stripPresentation(type) }],
  };
}

export function codamaToIdl(root: unknown): SolanaIdl {
  if (!isCodamaRoot(root)) throw new Error("Not a Codama root node");
  const program = (root as { program: Node }).program;
  const address = typeof program.publicKey === "string" ? program.publicKey : undefined;
  const name = String(program.name || address || "program");
  const version = typeof program.version === "string" ? program.version : undefined;

  const instructions = list(program.instructions).map((instruction) => {
    const args = list(instruction.arguments);
    const discriminator = discriminators(instruction, args);
    const discriminatorFields = new Set(
      list(instruction.discriminators)
        .filter((d) => d.kind === "fieldDiscriminatorNode")
        .map((d) => d.name)
    );
    return {
      name: String(instruction.name),
      accounts: list(instruction.accounts).map((account) => ({
        name: String(account.name),
        writable: account.isWritable === true,
        // "either" means the account may sign, which never tightens a requirement.
        signer: account.isSigner === true,
        ...(account.isSigner === "either" ? { optionalSigner: true } : {}),
        ...(account.isOptional ? { optional: true } : {}),
      })),
      args: args
        .filter((arg) => !discriminatorFields.has(arg.name))
        .map((arg) => ({ name: String(arg.name), type: stripPresentation(arg.type) })),
      ...(discriminator ? { discriminator } : {}),
    };
  });

  const accounts = list(program.accounts).map((account) => ({
    name: String(account.name),
    type: { kind: "struct", fields: structFields(account.data) ?? [] },
    ...(discriminators(account, []) ? { discriminator: discriminators(account, []) } : {}),
  }));

  const types = list(program.definedTypes).map((type) => ({
    name: String(type.name),
    type: convertType(type.type),
  }));

  const errors = list(program.errors).map((error) => ({
    code: typeof error.code === "number" ? error.code : undefined,
    name: String(error.name),
    msg: typeof error.message === "string" ? error.message : undefined,
  }));

  return {
    name,
    version,
    address,
    instructions,
    accounts,
    types,
    errors,
    metadata: { name, version, address: address ?? "", spec: "codama" },
  };
}
