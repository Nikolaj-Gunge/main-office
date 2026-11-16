/**
 * When the GPU drops the game's WebGL context (a driver reset, a tab starved of memory on a
 * Chromebook or an iPhone), the canvas just goes black. Say what happened instead, and offer a
 * reload — or one in safe mode (render/safe-mode.ts), which asks far less of the GPU.
 */
export function watchContextLoss(canvas: HTMLCanvasElement, safe: boolean): void {
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    if (document.querySelector('.context-lost')) return
    const box = document.createElement('div')
    box.className = 'context-lost'
    const card = document.createElement('div')
    card.className = 'context-lost-card'
    const title = document.createElement('h2')
    title.textContent = 'The picture went out'
    const text = document.createElement('p')
    text.textContent =
      'Your graphics card stopped drawing the game. This happens on busy or older machines. ' +
      'Reload to carry on.'
    const reload = document.createElement('button')
    reload.type = 'button'
    reload.textContent = 'Reload'
    reload.addEventListener('click', () => location.reload())
    card.append(title, text, reload)
    if (!safe) {
      const safer = document.createElement('button')
      safer.type = 'button'
      safer.textContent = 'Reload in safe mode'
      safer.addEventListener('click', () => {
        const url = new URL(location.href)
        url.searchParams.set('safe', '1')
        location.href = url.toString()
      })
      card.append(safer)
    }
    box.append(card)
    document.body.append(box)
    document.exitPointerLock()
  })
}
