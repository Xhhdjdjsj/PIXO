export function cleanSvg(source: string) {
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  const root = document.documentElement
  if (root.localName !== 'svg' || document.querySelector('parsererror')) {
    throw new Error('The file does not contain valid SVG markup.')
  }

  root.querySelectorAll('script, foreignObject, iframe, object, embed').forEach((node) => node.remove())
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim()
      if (name.startsWith('on')) element.removeAttribute(attribute.name)
      const embeddedImage = element.localName === 'image'
        && /^data:image\/(?:png|jpeg|webp|gif|avif);base64,[a-z0-9+/]+=*$/i.test(value)
      if ((name === 'href' || name === 'xlink:href' || name === 'src') && value && !value.startsWith('#') && !embeddedImage) {
        element.removeAttribute(attribute.name)
      }
      if (name === 'style' && /url\((?!\s*['"]?#)/i.test(value)) element.removeAttribute(attribute.name)
    }
  }
  root.querySelectorAll('style').forEach((style) => {
    if (/@import|url\((?!\s*['"]?#)/i.test(style.textContent ?? '')) style.remove()
  })

  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  const numeric = (value: string | null) => Number.parseFloat(value ?? '') || 0
  const width = box?.[2] || numeric(root.getAttribute('width')) || 512
  const height = box?.[3] || numeric(root.getAttribute('height')) || 512
  return {
    markup: root.innerHTML,
    viewBox: root.getAttribute('viewBox') || `0 0 ${width} ${height}`,
    width: Math.max(1, Math.min(width, 2000)),
    height: Math.max(1, Math.min(height, 2000)),
  }
}
