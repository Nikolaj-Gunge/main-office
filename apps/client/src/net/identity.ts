/**
 * This browser's anonymous account: a random secret (128 bits) made once and kept in
 * localStorage. Sent with Hello; the server keys your character by a hash of it, so your name
 * is only what others see. Clearing site data starts you over.
 */
const TOKEN_KEY = 'office-fps:account'

export function accountToken(): string | undefined {
  try {
    let token = localStorage.getItem(TOKEN_KEY)
    if (!token || !/^[0-9a-f]{32}$/.test(token)) {
      const bytes = crypto.getRandomValues(new Uint8Array(16))
      token = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(TOKEN_KEY, token)
    }
    return token
  } catch {
    // No storage (private mode, blocked): play without one; nothing is kept.
    return undefined
  }
}
