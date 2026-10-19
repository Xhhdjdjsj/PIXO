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
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name !== 'id') svg.setAttribute(attribute.name, attribute.value)
    }
    if (includeChildren) {
      for (const child of Array.from(element.childNodes)) svg.append(document.importNode(child, true))
    }
    return svg
  }

  let extracted = renderableElement(target, true)
  for (const ancestor of ancestors.slice(0, -1).reverse()) {
    const wrapper = renderableElement(ancestor, false)
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
  root.style.opacity = '0'
  root.style.pointerEvents = 'none'
  document.body.append(root)

  try {
    let element: Element = root
    for (const childIndex of path) {
      const child = element.children.item(childIndex)
      if (!child) return null
      element = child
    }

    const graphicsElement = element as SVGGraphicsElement
    const bounds = graphicsElement.getBBox()
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
    const padding = Math.max(0.5, Math.min(viewBoxWidth, viewBoxHeight) * 0.005)
    return { x: left - padding, y: top - padding, width: right - left + padding * 2, height: bottom - top + padding * 2 }
  } catch {
    return null
  } finally {
    root.remove()
  }
}
