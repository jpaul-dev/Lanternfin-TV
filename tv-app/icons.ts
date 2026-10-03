/** Small local SVG outlines keep the Android-style rail consistent across TV fonts. */
export function navigationIcons(root: HTMLElement) {
  const paths: Record<string, string> = {
    'nav-home': 'M3 10 12 3 21 10M5 9v12h5v-7h4v7h5V9',
    'nav-live': 'M8 3l4 4 4-4M3 8h18v13H3z',
    'nav-movie': 'M4 3h16v18H4zM8 3v18M16 3v18M4 8h4m-4 8h4m8-8h4m-4 8h4',
    'nav-series': 'M3 7l9-5 9 5-9 5-9-5m0 5 9 5 9-5m-18 5 9 5 9-5',
    'nav-search': 'M21 21l-6-6M17 9A7 7 0 1 1 3 9a7 7 0 0 1 14 0',
    'view-favorites': 'm12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z',
    'view-recent': 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 6v6l4 3',
    'nav-settings': 'm9 3 1-2h4l1 2 3 2 2 1v4l2 2-2 2v4l-2 1-3 2-1 2h-4l-1-2-3-2-2-1v-4l-2-2 2-2V6l2-1zM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  }
  for (const [id, d] of Object.entries(paths)) {
    const holder = root.querySelector(`#${id}>span`); if (!holder) continue
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS(svg.namespaceURI, 'path')
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); path.setAttribute('d', d); svg.append(path); holder.replaceChildren(svg)
  }
}
