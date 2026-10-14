// The title strip on Windows (see OVERLAY in main.js): "Svirka" and a drag area (Windows moves, snaps and maximises the
// window from it); Windows draws minimise / maximise / close at its right end. The page moves down to make room.
const { ipcRenderer, webFrame } = require('electron')

if (process.argv.includes('--svirka-titlebar')) {
  const BAR = 32
  const css = `
    html { padding-top: ${BAR}px !important; box-sizing: border-box; height: 100%; overflow: clip !important; }  /* clip: never scrolled, not even by focus or a resize */
    body { height: 100%; min-height: 0 !important; overflow: auto; }
    .h-dvh { height: calc(100dvh - ${BAR}px) !important; }
    #svirka-titlebar { position: fixed; inset: 0 0 auto 0; height: ${BAR}px; z-index: 2147483647; display: flex;
      align-items: center; padding-left: 14px; font: 600 12px "Segoe UI", system-ui, sans-serif; user-select: none;
      -webkit-app-region: drag; }
    #svirka-titlebar span { opacity: .6; }`

  // any CSS colour (Svirka's are oklch) → #rrggbb, which the buttons take; a transparent background → null
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  const hex = (c) => {
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return a === 0 ? null : '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
  }

  window.addEventListener('DOMContentLoaded', () => {
    webFrame.insertCSS(css)  // not a <style> tag: the login page's Content-Security-Policy would block that
    const bar = document.createElement('div')
    bar.id = 'svirka-titlebar'
    bar.innerHTML = '<span>Svirka</span>'
    document.documentElement.append(bar)

    // The strip shows the page's background (it sits in the page's top padding); text and buttons take the page's colours
    let last = ''
    const paint = () => {
      const fg = getComputedStyle(document.body).color
      const bg = hex(getComputedStyle(document.body).backgroundColor) || hex(getComputedStyle(document.documentElement).backgroundColor) || '#ffffff'  // none set: the browser's white
      bar.style.color = fg
      const key = bg + fg
      if (key !== last) ipcRenderer.send('svirka-titlebar', bg, hex(fg) || '#ffffff')
      last = key
    }
    paint()
    new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-palette', 'style'] })
  })
}
