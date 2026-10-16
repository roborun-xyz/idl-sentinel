/** Client-safe Squads proposal status helpers; no Node or web3 imports. */
export type ProposalStatus =
  | "none"
  | "draft"
  | "active"
  | "rejected"
  | "approved"
  | "executing"
  | "executed"
  | "cancelled";

/** Still able to become an executed change: awaiting a proposal, voting, or approved. */
export function isOpenProposal(status: string): boolean {
  return status === "none" || status === "draft" || status === "active" || status === "approved";
}
