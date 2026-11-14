/**
 * Anonymous accounts: each browser keeps a random secret token (128 bits, hex) and sends it with
 * Hello. Saves are keyed by a hash of it (the account), so typing somebody's name gets you
 * nothing of theirs. The token itself is never stored, logged or sent to anyone.
 */

/** 32 hex digits: what the client makes (apps/client/src/net/identity.ts). */
const TOKEN = /^[0-9a-f]{32}$/

/** The account a token belongs to (hex SHA-256 of it, shortened), or null if it isn't one. */
export async function accountOf(token: string | undefined): Promise<string | null> {
  if (!token || !TOKEN.test(token)) return null
  const bytes = new TextEncoder().encode(`office-fps account:${token}`)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...hash.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
