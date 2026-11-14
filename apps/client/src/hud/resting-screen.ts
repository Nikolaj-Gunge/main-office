/**
 * Full-screen notice for when the server turns new players away because the day's free
 * Cloudflare allowance is nearly spent (close code 4002, see server budget.ts). Nothing to fix
 * on the player's side, so it just says when to come back.
 */
export function showRestingScreen(now = new Date()): void {
  if (document.querySelector('.resting-screen')) return
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  const hours = Math.max(1, Math.ceil((midnight - now.getTime()) / 3_600_000))

  const screen = document.createElement('div')
  screen.className = 'resting-screen'
  screen.style.cssText =
    'position:fixed;inset:0;z-index:1000;display:flex;flex-direction:column;gap:14px;' +
    'align-items:center;justify-content:center;padding:24px;text-align:center;' +
    'background:#0d0b09;color:#d8cbb4;font-family:"Pixelify Sans",ui-monospace,monospace'
  const title = document.createElement('h1')
  title.textContent = 'The servers are resting'
  title.style.cssText = 'margin:0;font-size:32px;color:#e0a458;letter-spacing:1px'
  const body = document.createElement('p')
  body.textContent =
    'They’re free and run on a tiny budget, and today’s is nearly spent. ' +
    'The people already out there can finish their night. Try again later.'
  body.style.cssText = 'margin:0;max-width:440px;font-size:17px;line-height:1.5'
  const when = document.createElement('p')
  when.textContent = `The budget refills in about ${hours} hour${hours === 1 ? '' : 's'}.`
  when.style.cssText = 'margin:0;font-size:14px;opacity:0.6'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = 'Try again'
  retry.style.cssText =
    'font:inherit;font-size:16px;padding:6px 18px;margin-top:8px;cursor:pointer;' +
    'background:transparent;color:#e0a458;border:2px solid #e0a458'
  retry.addEventListener('click', () => location.reload())
  screen.append(title, body, when, retry)
  document.body.append(screen)
  document.exitPointerLock?.()
}
