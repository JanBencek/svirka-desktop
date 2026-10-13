// The title strip on Windows 10 (see ROUND in main.js): "Svirka", a drag area (Windows moves, snaps and maximises the
// window from it), and minimise / maximise / close drawn like Windows 10's own. The page moves down to make room.
const { ipcRenderer, webFrame } = require('electron')

if (process.argv.includes('--svirka-titlebar')) {
  const BAR = 32
  const icons = {  // 10×10 outlines, as Windows draws them
    minimize: '<path d="M0 5.5h10"/>',
    maximize: '<rect x=".5" y=".5" width="9" height="9"/>',
    restore: '<path d="M2.5 2.5v-2h7v7h-2"/><rect x=".5" y="2.5" width="7" height="7"/>',
    close: '<path d="M.5.5l9 9M9.5.5l-9 9"/>',
  }
  const svg = (name) => `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">${icons[name]}</svg>`
  const css = `
    html { padding-top: ${BAR}px !important; box-sizing: border-box; height: 100%; overflow: hidden; }
    body { height: 100%; min-height: 0 !important; overflow: auto; }
    .h-dvh { height: calc(100dvh - ${BAR}px) !important; }
    #svirka-titlebar { position: fixed; inset: 0 0 auto 0; height: ${BAR}px; z-index: 2147483647; display: flex;
      align-items: stretch; font: 600 12px "Segoe UI", system-ui, sans-serif; user-select: none; -webkit-app-region: drag; }
    #svirka-titlebar span { flex: 1; display: flex; align-items: center; padding-left: 14px; opacity: .6; }
    #svirka-titlebar button { -webkit-app-region: no-drag; width: 46px; border: 0; padding: 0; margin: 0; background: none;
      color: inherit; display: grid; place-items: center; cursor: default; }
    #svirka-titlebar button:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
    #svirka-titlebar button.close:hover { background: #e81123; color: #fff; }`

  window.addEventListener('DOMContentLoaded', () => {
    webFrame.insertCSS(css)  // not a <style> tag: the login page's Content-Security-Policy would block that
    const bar = document.createElement('div')
    bar.id = 'svirka-titlebar'
    bar.innerHTML = `<span>Svirka</span>
      <button data-action="minimize" title="Minimise">${svg('minimize')}</button>
      <button data-action="maximize" title="Maximise">${svg('maximize')}</button>
      <button data-action="close" class="close" title="Close">${svg('close')}</button>`
    bar.addEventListener('click', (e) => {
      const action = e.target.closest('button')?.dataset.action
      if (action) ipcRenderer.send('svirka-window', action)
    })

    document.documentElement.append(bar)

    // The strip shows the page's background (it sits in the page's top padding); its text takes the page's colour
    const paint = () => { bar.style.color = getComputedStyle(document.body).color }
    paint()
    new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-palette', 'style'] })
    ipcRenderer.on('svirka-maximized', (_e, max) => {
      const b = bar.querySelector('[data-action=maximize]')
      b.innerHTML = svg(max ? 'restore' : 'maximize')
      b.title = max ? 'Restore' : 'Maximise'
    })
  })
}
