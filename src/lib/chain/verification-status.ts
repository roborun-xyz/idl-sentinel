import type { ChainState } from "./state";

/**
 * The verification that applies to the deployed code, or null while a check is
 * pending. Client-safe: no Node imports, so the UI and API share one rule.
 */
export function currentVerification(state: ChainState) {
  return state.verification &&
    state.codeHash &&
    (state.verification.codeHash ?? state.codeHash) === state.codeHash
    ? state.verification
    : null;
}
