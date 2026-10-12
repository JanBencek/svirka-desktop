// The window on Windows 10 (see ROUND in main.js): the window is transparent and the page itself has rounded corners,
// a title strip ("Svirka", drag area, minimise / maximise / close like Windows 10's), a hairline edge, and resize edges.
const { ipcRenderer, webFrame } = require('electron')

if (process.argv.includes('--svirka-titlebar')) {
  const BAR = 32, RADIUS = 10
  const icons = {  // 10×10 outlines, as Windows draws them
    minimize: '<path d="M0 5.5h10"/>',
    maximize: '<rect x=".5" y=".5" width="9" height="9"/>',
    restore: '<path d="M2.5 2.5v-2h7v7h-2"/><rect x=".5" y="2.5" width="7" height="7"/>',
    close: '<path d="M.5.5l9 9M9.5.5l-9 9"/>',
  }
  const svg = (name) => `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1">${icons[name]}</svg>`
  const css = `
    /* html gets a barely-there background so the body's own (rounded) background isn't spread over the whole window */
    html { background: rgba(0, 0, 0, .004) !important; height: 100%; overflow: hidden; }
    body { height: 100% !important; min-height: 0 !important; margin: 0 !important; box-sizing: border-box;
      padding-top: ${BAR}px !important; border-radius: ${RADIUS}px; overflow: auto; }
    .h-dvh { height: calc(100dvh - ${BAR}px) !important; }
    html::after { content: ''; position: fixed; inset: 0; border-radius: ${RADIUS}px; pointer-events: none; z-index: 2147483647;
      box-shadow: inset 0 0 0 1px rgb(128 128 128 / .35); }
    html.svirka-max body, html.svirka-max::after, html.svirka-max #svirka-titlebar { border-radius: 0; }
    html.svirka-max .svirka-edge { display: none; }
    #svirka-titlebar { position: fixed; inset: 0 0 auto 0; height: ${BAR}px; z-index: 2147483646; display: flex; overflow: hidden;
      border-radius: ${RADIUS}px ${RADIUS}px 0 0; align-items: stretch; font: 600 12px "Segoe UI", system-ui, sans-serif;
      user-select: none; -webkit-app-region: drag; }
    #svirka-titlebar span { flex: 1; display: flex; align-items: center; padding-left: 14px; opacity: .6; }
    #svirka-titlebar button { -webkit-app-region: no-drag; width: 46px; border: 0; padding: 0; margin: 0; background: none;
      color: inherit; display: grid; place-items: center; cursor: default; }
    #svirka-titlebar button:hover { background: color-mix(in srgb, currentColor 12%, transparent); }
    #svirka-titlebar button.close:hover { background: #e81123; color: #fff; }
    .svirka-edge { position: fixed; z-index: 2147483647; -webkit-app-region: no-drag; }
    .svirka-edge[data-edge=n] { inset: 0 12px auto 12px; height: 5px; cursor: ns-resize; }
    .svirka-edge[data-edge=s] { inset: auto 12px 0 12px; height: 6px; cursor: ns-resize; }
    .svirka-edge[data-edge=w] { inset: 12px auto 12px 0; width: 6px; cursor: ew-resize; }
    .svirka-edge[data-edge=e] { inset: 12px 0 12px auto; width: 6px; cursor: ew-resize; }
    .svirka-edge[data-edge=nw] { top: 0; left: 0; width: 12px; height: 12px; cursor: nwse-resize; }
    .svirka-edge[data-edge=ne] { top: 0; right: 0; width: 12px; height: 5px; cursor: nesw-resize; }
    .svirka-edge[data-edge=sw] { bottom: 0; left: 0; width: 12px; height: 12px; cursor: nesw-resize; }
    .svirka-edge[data-edge=se] { bottom: 0; right: 0; width: 12px; height: 12px; cursor: nwse-resize; }`

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

    // Resize edges: main.js moves the window edge with the cursor from pointer down to pointer up
    const edges = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].map((edge) => {
      const el = document.createElement('div')
      el.className = 'svirka-edge'
      el.dataset.edge = edge
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        el.setPointerCapture(e.pointerId)
        ipcRenderer.send('svirka-resize', edge)
      })
      const stop = () => ipcRenderer.send('svirka-resize', null)
      el.addEventListener('pointerup', stop)
      el.addEventListener('lostpointercapture', stop)
      return el
    })
    document.documentElement.append(bar, ...edges)

    // The strip's text takes the page's colour; a page without a background of its own (the login page) gets white,
    // or the window would be see-through there
    const paint = () => {
      const style = getComputedStyle(document.body)
      bar.style.color = style.color
      if (/^rgba\(.*, 0\)$|transparent/.test(style.backgroundColor)) document.body.style.backgroundColor = '#fff'
    }
    paint()
    new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-palette', 'style'] })
    ipcRenderer.on('svirka-maximized', (_e, max) => {
      document.documentElement.classList.toggle('svirka-max', max)
      const b = bar.querySelector('[data-action=maximize]')
      b.innerHTML = svg(max ? 'restore' : 'maximize')
      b.title = max ? 'Restore' : 'Maximise'
    })
  })
}
