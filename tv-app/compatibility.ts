/** The 2021 LG C1 uses Chromium 79. Compilation lowers syntax, not DOM APIs. */
export function installTVCompatibility() {
  if (!Element.prototype.replaceChildren) {
    Object.defineProperty(Element.prototype, 'replaceChildren', {
      configurable: true, writable: true,
      value: function (this: Element, ...nodes: (Node | string)[]) {
        // Validate ancestors before moving existing children into a fragment.
        for (const node of nodes) if (node instanceof Node && node.contains(this)) throw new DOMException('Invalid child', 'HierarchyRequestError')
        const fragment = this.ownerDocument.createDocumentFragment()
        for (const node of nodes) fragment.appendChild(node instanceof Node ? node : this.ownerDocument.createTextNode(String(node)))
        this.textContent = ''
        this.appendChild(fragment)
      },
    })
  }
  // CSS.supports('gap') is insufficient: Chromium 79 supports grid gaps only.
  const probe = document.createElement('div')
  probe.style.display = 'flex'; probe.style.flexDirection = 'column'; probe.style.rowGap = '1px'
  probe.style.position = 'absolute'; probe.style.visibility = 'hidden'; probe.style.padding = '0'
  probe.appendChild(document.createElement('div')); probe.appendChild(document.createElement('div'))
  document.body.appendChild(probe)
  document.documentElement.classList.toggle('legacy-flex-gap', probe.scrollHeight !== 1)
  probe.remove()
}

installTVCompatibility()
