export function createSignInMessage(nonce: string): string {
  return `Sign this message to authenticate with IDL Sentinel.\n\nNonce: ${nonce}`;
}
