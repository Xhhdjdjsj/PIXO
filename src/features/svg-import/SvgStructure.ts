import type { SvgAsset } from '../../types/svg'

export interface SvgTreeNode {
  path: number[]
  tag: string
  label: string
  children: SvgTreeNode[]
}

const hiddenElements = new Set(['defs', 'title', 'desc', 'metadata', 'style'])

function elementLabel(element: Element, tag: string, index: number) {
  const explicitName = element.getAttribute('aria-label') || element.getAttribute('data-name') || element.getAttribute('id')
  if (explicitName) return explicitName
  const title = element.querySelector(':scope > title')?.textContent?.trim()
  if (title) return title
  const text = element.localName === 'text' ? element.textContent?.trim() : ''
  if (text) return text.slice(0, 32)
  return `${tag} ${index + 1}`
}

export function getSvgStructure(markup: string): SvgTreeNode[] {
  const document = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml')
  if (document.querySelector('parsererror')) return []

  function build(parent: Element, parentPath: number[]): SvgTreeNode[] {
    return Array.from(parent.children).flatMap((element, index) => {
      const tag = element.localName
      if (hiddenElements.has(tag)) return []
      const path = [...parentPath, index]
      return [{ path, tag, label: elementLabel(element, tag, index), children: build(element, path) }]
    })
  }

  return build(document.documentElement, [])
}

export function getSvgNodeViewBox(asset: SvgAsset, path: number[]) {
  const document = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${asset.markup}</svg>`, 'image/svg+xml')
  if (document.querySelector('parsererror') || path.length === 0) return asset.viewBox
  let element: Element = document.documentElement
  let symbolViewBox: string | null = null
  for (const childIndex of path) {
    const child = element.children.item(childIndex)
    if (!child) return asset.viewBox
    element = child
    if (element.localName === 'symbol') symbolViewBox = element.getAttribute('viewBox')
  }
  return symbolViewBox ?? asset.viewBox
}

export function extractSvgNode(asset: SvgAsset, path: number[]) {
  const document = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${asset.markup}</svg>`, 'image/svg+xml')
  if (document.querySelector('parsererror') || path.length === 0) return null

  const root = document.documentElement
  const ancestors: Element[] = []
  let target: Element = root
  for (const childIndex of path) {
    const child = target.children.item(childIndex)
    if (!child) return null
    target = child
    ancestors.push(target)
  }

  function renderableElement(element: Element, includeChildren: boolean) {
    if (element.localName !== 'symbol') return element.cloneNode(includeChildren) as Element
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    for (const attribute of Array.from(element.attributes)) {
      if (!['viewBox', 'preserveAspectRatio', 'refX', 'refY', 'width', 'height', 'overflow'].includes(attribute.name)) {
        group.setAttribute(attribute.name, attribute.value)
      }
    }
    if (includeChildren) {
      for (const child of Array.from(element.childNodes)) group.append(document.importNode(child, true))
    }
    return group
  }

  let extracted = renderableElement(target, true)
  for (const ancestor of ancestors.slice(0, -1).reverse()) {
    const wrapper = ancestor.localName === 'symbol'
      ? document.createElementNS('http://www.w3.org/2000/svg', 'g')
      : renderableElement(ancestor, false)
    if (ancestor.localName === 'symbol') {
      for (const attribute of Array.from(ancestor.attributes)) {
        if (!['viewBox', 'preserveAspectRatio', 'refX', 'refY', 'width', 'height', 'overflow'].includes(attribute.name)) {
          wrapper.setAttribute(attribute.name, attribute.value)
        }
      }
    }
    wrapper.append(extracted)
    extracted = wrapper
  }

  const output = document.implementation.createDocument('http://www.w3.org/2000/svg', 'svg', null).documentElement
  root.querySelectorAll('defs').forEach((defs) => output.append(document.importNode(defs, true)))
  root.querySelectorAll(':scope > style').forEach((style) => output.append(document.importNode(style, true)))
  root.querySelectorAll(':scope > mask, :scope > clipPath, :scope > filter, :scope > pattern, :scope > linearGradient, :scope > radialGradient, :scope > marker').forEach((resource) => output.append(document.importNode(resource, true)))
  for (const attribute of ['fill', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'fill-opacity', 'stroke-opacity', 'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'visibility', 'display', 'style']) {
    const rootValue = root.getAttribute(attribute)
    if (rootValue === null) continue
    const value = attribute === 'style' && extracted.hasAttribute('style')
      ? `${rootValue};${extracted.getAttribute('style')}`
      : rootValue
    if (attribute === 'style' || !extracted.hasAttribute(attribute)) extracted.setAttribute(attribute, value)
  }
  output.append(document.importNode(extracted, true))
  return output.innerHTML
}

export function flattenExtractedSymbolViewport(markup: string, sourceMarkup: string) {
  const partDocument = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml')
  const sourceDocument = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${sourceMarkup}</svg>`, 'image/svg+xml')
  if (partDocument.querySelector('parsererror') || sourceDocument.querySelector('parsererror')) return null
  const root = partDocument.documentElement
  const symbolViewport = Array.from(root.children).find((element) => element.localName === 'svg')
  const viewBox = symbolViewport?.getAttribute('viewBox')
  if (!symbolViewport || !viewBox) return null
  const viewBoxValues = viewBox.trim().split(/[\s,]+/).map(Number)
  if (viewBoxValues.length !== 4 || !viewBoxValues.every(Number.isFinite) || viewBoxValues[2] <= 0 || viewBoxValues[3] <= 0) return null
  const matchesSourceSymbol = Array.from(sourceDocument.querySelectorAll('symbol')).some((symbol) => {
    const symbolValues = (symbol.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
    return symbolValues.length === 4 && symbolValues.every(Number.isFinite)
      && symbolValues.every((value, index) => Math.abs(value - viewBoxValues[index]) < 0.001)
  })
  if (!matchesSourceSymbol) return null

  const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  for (const attribute of Array.from(symbolViewport.attributes)) {
    if (!['viewBox', 'preserveAspectRatio', 'refX', 'refY', 'width', 'height', 'overflow'].includes(attribute.name)) {
      wrapper.setAttribute(attribute.name, attribute.value)
    }
  }
  while (symbolViewport.firstChild) wrapper.append(symbolViewport.firstChild)
  symbolViewport.replaceWith(wrapper)
  return { markup: root.innerHTML, viewBox }
}

export function measureSvgNodeBounds(asset: SvgAsset, path: number[]) {
  const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${asset.markup}</svg>`, 'image/svg+xml')
  if (parsed.querySelector('parsererror') || path.length === 0) return null

  const root = parsed.documentElement as unknown as SVGSVGElement
  const viewBox = asset.viewBox.trim().split(/[\s,]+/).map(Number)
  const viewBoxWidth = viewBox[2]
  const viewBoxHeight = viewBox[3]
  if (viewBox.length !== 4 || !Number.isFinite(viewBoxWidth) || !Number.isFinite(viewBoxHeight) || viewBoxWidth <= 0 || viewBoxHeight <= 0) return null

  root.setAttribute('viewBox', asset.viewBox)
  root.setAttribute('width', '1000')
  root.setAttribute('height', String(1000 * viewBoxHeight / viewBoxWidth))
  root.style.position = 'fixed'
  root.style.left = '-10000px'
  root.style.top = '0'
  root.style.opacity = '1'
  root.style.pointerEvents = 'none'
  document.body.append(root)

  try {
    let element: Element = root
    for (const childIndex of path) {
      const child = element.children.item(childIndex)
      if (!child) return null
      element = child
    }

    let ancestor: Element | null = element
    while (ancestor && ancestor !== root) {
      const ancestorStyle = getComputedStyle(ancestor)
      if (ancestorStyle.display === 'none' || ancestorStyle.visibility === 'hidden' || ancestorStyle.visibility === 'collapse' || Number(ancestorStyle.opacity) === 0) return null
      ancestor = ancestor.parentElement
    }

    const computedStyle = getComputedStyle(element)
    const hasFill = computedStyle.fill !== 'none'
      && Number.parseFloat(computedStyle.fillOpacity) > 0
      && !/rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(computedStyle.fill)
    const hasStroke = computedStyle.stroke !== 'none'
      && !/rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/i.test(computedStyle.stroke)
      && Number.parseFloat(computedStyle.strokeWidth) > 0
      && Number.parseFloat(computedStyle.strokeOpacity) > 0
    if (!hasFill && !hasStroke && element.localName !== 'image') return null

    const graphicsElement = element as SVGGraphicsElement
    let bounds: DOMRect
    try {
      bounds = (graphicsElement.getBBox as (options?: { clipped?: boolean }) => DOMRect).call(graphicsElement, { clipped: true })
    } catch {
      bounds = graphicsElement.getBBox()
    }
    const elementMatrix = graphicsElement.getScreenCTM()
    const rootMatrix = root.getScreenCTM()
    if (!elementMatrix || !rootMatrix || bounds.width <= 0 || bounds.height <= 0) return null

    const rootInverse = rootMatrix.inverse()
    const corners = [
      [bounds.x, bounds.y],
      [bounds.x + bounds.width, bounds.y],
      [bounds.x, bounds.y + bounds.height],
      [bounds.x + bounds.width, bounds.y + bounds.height],
    ].map(([x, y]) => new DOMPoint(x, y).matrixTransform(elementMatrix).matrixTransform(rootInverse))
    const left = Math.min(...corners.map((point) => point.x))
    const top = Math.min(...corners.map((point) => point.y))
    const right = Math.max(...corners.map((point) => point.x))
    const bottom = Math.max(...corners.map((point) => point.y))
    const relativeMatrix = rootInverse.multiply(elementMatrix)
    const transformScale = Math.max(Math.hypot(relativeMatrix.a, relativeMatrix.b), Math.hypot(relativeMatrix.c, relativeMatrix.d))
    const strokeWidth = hasStroke ? Number.parseFloat(computedStyle.strokeWidth) : 0
    const strokePadding = Number.isFinite(strokeWidth) ? strokeWidth * transformScale / 2 : 0
    const padding = Math.max(0.5, Math.min(viewBoxWidth, viewBoxHeight) * 0.005, strokePadding)
    return { x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2 }
  } catch {
    return null
  } finally {
    root.remove()
  }
}

export async function measureSvgArtworkBounds(asset: SvgAsset, backgroundColor = 'transparent') {
  const viewBox = asset.viewBox.trim().split(/[\s,]+/).map(Number)
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) return null
  const [viewX, viewY, viewWidth, viewHeight] = viewBox
  const rasterScale = Math.min(1024 / viewWidth, 1024 / viewHeight)
  const width = Math.max(1, Math.ceil(viewWidth * rasterScale))
  const height = Math.max(1, Math.ceil(viewHeight * rasterScale))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="${viewBox.join(' ')}" preserveAspectRatio="none">${asset.markup}</svg>`
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))

  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Could not render SVG artwork'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    if (backgroundColor === 'transparent') context.clearRect(0, 0, width, height)
    else {
      context.fillStyle = backgroundColor
      context.fillRect(0, 0, width, height)
    }
    // Capture the canvas color before drawing the SVG. Sampling afterward can
    // mistake artwork touching the top-left corner for the page background.
    const background = context.getImageData(0, 0, 1, 1).data
    context.drawImage(image, 0, 0, width, height)
    const pixels = context.getImageData(0, 0, width, height).data
    const isBackgroundPixel = (index: number) => {
      const alpha = pixels[index + 3]
      if (background[3] < 8) return alpha < 8
      if (Math.abs(alpha - background[3]) >= 8) return false
      return Math.abs(pixels[index] - background[0])
        + Math.abs(pixels[index + 1] - background[1])
        + Math.abs(pixels[index + 2] - background[2]) < 48
    }
    // Only ignore pixels matching the canvas colour when they are reachable
    // from an edge. This drops an SVG artboard background while preserving
    // dark details inside the illustration that use the same colour.
    const edgeBackground = new Uint8Array(width * height)
    const queue = new Int32Array(width * height)
    let queueStart = 0
    let queueEnd = 0
    const enqueue = (x: number, y: number) => {
      const position = y * width + x
      if (edgeBackground[position] || !isBackgroundPixel(position * 4)) return
      edgeBackground[position] = 1
      queue[queueEnd++] = position
    }
    for (let x = 0; x < width; x += 1) {
      enqueue(x, 0)
      enqueue(x, height - 1)
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueue(0, y)
      enqueue(width - 1, y)
    }
    while (queueStart < queueEnd) {
      const position = queue[queueStart++]
      const x = position % width
      const y = Math.floor(position / width)
      if (x > 0) enqueue(x - 1, y)
      if (x + 1 < width) enqueue(x + 1, y)
      if (y > 0) enqueue(x, y - 1)
      if (y + 1 < height) enqueue(x, y + 1)
    }
    let left = width
    let top = height
    let right = -1
    let bottom = -1
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = (y * width + x) * 4
        if (pixels[pixel + 3] < 8 || edgeBackground[y * width + x]) continue
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    }
    if (right < left || bottom < top) return null
    left = Math.max(0, left - 1)
    top = Math.max(0, top - 1)
    right = Math.min(width, right + 2)
    bottom = Math.min(height, bottom + 2)
    return {
      x: viewX + left / width * viewWidth,
      y: viewY + top / height * viewHeight,
      width: (right - left) / width * viewWidth,
      height: (bottom - top) / height * viewHeight,
    }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}
