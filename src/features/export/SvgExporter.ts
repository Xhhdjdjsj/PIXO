import type { CanvasObject } from '../../types/svg'

export function namespaceSvgIds(markup: string, namespace: string) {
  const document = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml')
  const elements = [document.documentElement, ...Array.from(document.querySelectorAll('*'))]
  const ids = new Map<string, string>()
  for (const element of elements) {
    const id = element.getAttribute('id')
    if (id) ids.set(id, `${namespace}-${id}`)
  }
  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === 'id') {
        element.setAttribute(attribute.name, ids.get(attribute.value) ?? attribute.value)
        continue
      }
      const value = attribute.value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (_match, quote: string, id: string) => `url(${quote}#${ids.get(id) ?? id}${quote})`)
      const reference = value.replace(/^#(.+)$/, (_match, id: string) => `#${ids.get(id) ?? id}`)
      const labelled = attribute.name.startsWith('aria-')
        ? reference.split(/\s+/).map((id) => ids.get(id) ?? id).join(' ')
        : reference
      element.setAttribute(attribute.name, labelled)
    }
  }
  document.querySelectorAll('style').forEach((style) => {
    let text = style.textContent ?? ''
    for (const [id, namespacedId] of ids) text = text.replaceAll(`#${id}`, `#${namespacedId}`)
    text = text.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (_match, quote: string, id: string) => `url(${quote}#${ids.get(id) ?? id}${quote})`)
    style.textContent = text
  })
  return document.documentElement.innerHTML
}

export function serializeComposition(objects: CanvasObject[], transparentBackground: boolean, backgroundColor = '#101114', width = 1440, height = 900) {
  const document = window.document.implementation.createDocument('http://www.w3.org/2000/svg', 'svg', null)
  const root = document.documentElement
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.setAttribute('viewBox', `0 0 ${width} ${height}`)
  if (!transparentBackground) {
    const background = document.createElementNS(root.namespaceURI, 'rect')
    background.setAttribute('width', '100%')
    background.setAttribute('height', '100%')
    background.setAttribute('fill', backgroundColor)
    root.append(background)
  }
  for (const item of objects.filter((object) => object.visible)) {
    const group = document.createElementNS(root.namespaceURI, 'g')
    group.setAttribute('transform', `translate(${item.x} ${item.y}) translate(${item.width / 2} ${item.height / 2}) rotate(${item.rotation}) scale(${item.flipX ? -1 : 1} ${item.flipY ? -1 : 1}) translate(${-item.width / 2} ${-item.height / 2})`)
    group.setAttribute('opacity', String(item.opacity))
    const wrapper = document.createElementNS(root.namespaceURI, 'svg')
    wrapper.setAttribute('width', String(item.width))
    wrapper.setAttribute('height', String(item.height))
    wrapper.setAttribute('viewBox', item.viewBox)
    const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${namespaceSvgIds(item.markup, item.objectId)}</svg>`, 'image/svg+xml')
    const artwork = Array.from(parsed.documentElement.childNodes).map((child) => document.importNode(child, true))
    const erasures = item.erasures ?? []
    if (erasures.length) {
      const [viewX, viewY, viewWidth, viewHeight] = item.viewBox.trim().split(/[\s,]+/).map(Number)
      const safeViewBox = [viewX, viewY, viewWidth, viewHeight].every(Number.isFinite) && viewWidth > 0 && viewHeight > 0
        ? { x: viewX, y: viewY, width: viewWidth, height: viewHeight }
        : { x: 0, y: 0, width: item.width, height: item.height }
      const maskId = `pixo-eraser-${item.objectId.replace(/[^a-zA-Z0-9_-]/g, '-')}`
      const defs = document.createElementNS(root.namespaceURI, 'defs')
      const mask = document.createElementNS(root.namespaceURI, 'mask')
      mask.setAttribute('id', maskId)
      mask.setAttribute('maskUnits', 'userSpaceOnUse')
      mask.setAttribute('maskContentUnits', 'userSpaceOnUse')
      mask.setAttribute('x', String(safeViewBox.x))
      mask.setAttribute('y', String(safeViewBox.y))
      mask.setAttribute('width', String(safeViewBox.width))
      mask.setAttribute('height', String(safeViewBox.height))
      const maskBackground = document.createElementNS(root.namespaceURI, 'rect')
      maskBackground.setAttribute('x', String(safeViewBox.x))
      maskBackground.setAttribute('y', String(safeViewBox.y))
      maskBackground.setAttribute('width', String(safeViewBox.width))
      maskBackground.setAttribute('height', String(safeViewBox.height))
      maskBackground.setAttribute('fill', 'white')
      mask.append(maskBackground)
      for (const stroke of erasures) {
        const path = document.createElementNS(root.namespaceURI, 'path')
        path.setAttribute('d', stroke.d)
        path.setAttribute('fill', 'none')
        path.setAttribute('stroke', 'black')
        path.setAttribute('stroke-width', String(stroke.strokeWidth))
        path.setAttribute('stroke-linecap', 'round')
        path.setAttribute('stroke-linejoin', 'round')
        mask.append(path)
      }
      defs.append(mask)
      const artworkGroup = document.createElementNS(root.namespaceURI, 'g')
      artworkGroup.setAttribute('mask', `url(#${maskId})`)
      artworkGroup.append(...artwork)
      wrapper.append(defs, artworkGroup)
    } else {
      wrapper.append(...artwork)
    }
    group.append(wrapper)
    root.append(group)
  }
  return new XMLSerializer().serializeToString(document)
}
