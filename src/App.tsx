import { Children, memo, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Circle,
  Clipboard,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FlipHorizontal2,
  FlipVertical2,
  FolderOpen,
  Grid2X2,
  Layers,
  LockKeyhole,
  LogOut,
  Maximize2,
  MousePointer2,
  Move,
  Pencil,
  Plus,
  Redo2,
  Search,
  Settings2,
  Shapes,
  Square,
  SquareDashed,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { CanvasObject, DragState, SvgAsset as Asset } from './types/svg'
import type { Project } from './types/project'
import { cleanSvg } from './features/svg-import/SvgSanitizer'
import { extractSvgNode, getSvgStructure, measureSvgNodeBounds } from './features/svg-import/SvgStructure'
import { namespaceSvgIds, serializeComposition } from './features/export/SvgExporter'
import { readWorkspaceValue, writeWorkspaceValue } from './features/storage/workspaceStorage'
import type { SvgTreeNode } from './features/svg-import/SvgStructure'
import './App.css'
import serviceIconsSvg from './assets/icons.svg?raw'
import reactLogoSvg from './assets/react.svg?raw'
import viteLogoSvg from './assets/vite.svg?raw'
import pixoMarkSvg from './assets/favicon.svg?raw'

type ThemeMode = 'system' | 'light' | 'dark'
type IconTool = 'rectangle' | 'ellipse' | 'pen' | 'text'
type IconShape = { id: string; kind: 'rect' | 'ellipse' | 'path' | 'text'; x: number; y: number; width: number; height: number; path?: string; text?: string; color: string }
type IconPoint = { x: number; y: number }
type ColorFormat = 'hex' | 'rgb' | 'hsl'
type RgbaColor = { r: number; g: number; b: number; a: number }

const defaultPaint = '#7049f5'

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value))
}

function getProportionalResizeScale(width: number, height: number, targetWidth: number, targetHeight: number) {
  if (width <= 0 || height <= 0) return 1
  const startDiagonal = Math.hypot(width, height)
  const targetDiagonal = Math.hypot(Math.max(30, targetWidth), Math.max(30, targetHeight))
  return Math.max(30 / width, 30 / height, targetDiagonal / startDiagonal)
}

function parseColor(value: string | null | undefined): RgbaColor {
  const source = (value || defaultPaint).trim()
  const hex = source.match(/^#([\da-f]{3,8})$/i)?.[1]
  if (hex) {
    const expanded = hex.length <= 4 ? hex.split('').map((part) => part + part).join('') : hex
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a: expanded.length >= 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    }
  }
  const channels = source.match(/rgba?\(\s*([\d.]+)[,\s]+\s*([\d.]+)[,\s]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i)
  if (channels) return { r: Number(channels[1]), g: Number(channels[2]), b: Number(channels[3]), a: channels[4] === undefined ? 1 : Number(channels[4]) }
  return parseColor(defaultPaint)
}

function colorToHex({ r, g, b }: RgbaColor) {
  return `#${[r, g, b].map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

function colorToCss({ r, g, b, a }: RgbaColor) {
  return `rgba(${Math.round(clamp(r, 0, 255))}, ${Math.round(clamp(g, 0, 255))}, ${Math.round(clamp(b, 0, 255))}, ${Number(clamp(a).toFixed(3))})`
}

function measureTextWidth(value: string, fontSize: number, fontFamily: string) {
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return Math.max(24, value.length * fontSize * .55 + 20)
  context.font = `600 ${fontSize}px ${fontFamily}`
  return Math.max(24, Math.ceil(context.measureText(value || ' ').width + 20))
}

function rgbToHsv({ r, g, b }: RgbaColor) {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let h = 0
  if (delta) {
    if (max === red) h = 60 * (((green - blue) / delta) % 6)
    else if (max === green) h = 60 * ((blue - red) / delta + 2)
    else h = 60 * ((red - green) / delta + 4)
  }
  return { h: (h + 360) % 360, s: max ? delta / max : 0, v: max }
}

function hsvToRgb(h: number, s: number, v: number, a = 1): RgbaColor {
  const chroma = v * s
  const segment = (h % 360) / 60
  const x = chroma * (1 - Math.abs(segment % 2 - 1))
  const m = v - chroma
  const [red, green, blue] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x]
  return { r: (red + m) * 255, g: (green + m) * 255, b: (blue + m) * 255, a }
}

function rgbToHsl({ r, g, b }: RgbaColor) {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2
  const delta = max - min
  let hue = 0
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }
  return { h: (hue + 360) % 360, s: delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0, l: lightness }
}

function hslToRgb(h: number, s: number, l: number, a = 1): RgbaColor {
  const chroma = (1 - Math.abs(2 * l - 1)) * s
  const segment = (h % 360) / 60
  const x = chroma * (1 - Math.abs(segment % 2 - 1))
  const m = l - chroma / 2
  const [red, green, blue] = segment < 1 ? [chroma, x, 0] : segment < 2 ? [x, chroma, 0] : segment < 3 ? [0, chroma, x] : segment < 4 ? [0, x, chroma] : segment < 5 ? [x, 0, chroma] : [chroma, 0, x]
  return { r: (red + m) * 255, g: (green + m) * 255, b: (blue + m) * 255, a }
}

function getSvgPaint(markup: string, property: 'fill' | 'stroke') {
  const document = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml')
  const element = [...document.querySelectorAll<SVGElement>(`[${property}]`)].find((node) => !node.closest('defs, mask, clipPath') && node.getAttribute(property) !== 'none')
  return element?.getAttribute(property) || defaultPaint
}

function setSvgPaint(markup: string, property: 'fill' | 'stroke', value: string) {
  const document = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml')
  const elements = [...document.querySelectorAll<SVGElement>(`${property === 'fill' ? 'path, rect, circle, ellipse, polygon, polyline, text' : 'path, rect, circle, ellipse, polygon, polyline, line, text'}`)]
    .filter((node) => !node.closest('defs, mask, clipPath'))
  const matching = elements.filter((node) => node.hasAttribute(property) && node.getAttribute(property) !== 'none')
  const targets = matching.length ? matching : elements.slice(0, 1)
  targets.forEach((node) => node.setAttribute(property, value))
  return document.documentElement.innerHTML
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `pixo-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getTimestamp() {
  return Date.now()
}

function readStored<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) as T : fallback
  } catch {
    return fallback
  }
}

function getInitialThemeMode(): ThemeMode {
  const saved = readStored<ThemeMode | null>('pixo-interface-theme-v3', null)
  if (saved === 'system' || saved === 'light' || saved === 'dark') return saved
  const previous = readStored<ThemeMode>('pixo-interface-theme-v2', 'dark')
  return previous === 'system' ? 'dark' : previous
}

function flattenSvgTree(nodes: SvgTreeNode[], depth = 0): Array<{ node: SvgTreeNode; depth: number }> {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flattenSvgTree(node.children, depth + 1),
  ])
}

function getObjectBounds(items: Pick<CanvasObject, 'x' | 'y' | 'width' | 'height'>[]) {
  if (!items.length) return null
  const left = Math.min(...items.map((item) => item.x))
  const top = Math.min(...items.map((item) => item.y))
  const right = Math.max(...items.map((item) => item.x + item.width))
  const bottom = Math.max(...items.map((item) => item.y + item.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function isCanvasPointInsideObject(point: IconPoint, item: CanvasObject) {
  const centerX = item.x + item.width / 2
  const centerY = item.y + item.height / 2
  const angle = -(item.rotation * Math.PI) / 180
  const dx = point.x - centerX
  const dy = point.y - centerY
  const localX = centerX + dx * Math.cos(angle) - dy * Math.sin(angle)
  const localY = centerY + dx * Math.sin(angle) + dy * Math.cos(angle)
  return localX >= item.x && localX <= item.x + item.width && localY >= item.y && localY <= item.y + item.height
}

function getCanvasBackgroundForTheme(background: string | undefined, theme: 'light' | 'dark') {
  const color = background ?? (theme === 'light' ? '#ffffff' : '#101115')
  if (theme === 'dark' && color.toLowerCase() === '#ffffff') return '#101115'
  if (theme === 'light' && color.toLowerCase() === '#101115') return '#ffffff'
  return color
}

function fitFrameBounds(objects: CanvasObject[]) {
  return objects.map((object) => {
    if (!object.isFrame || object.category !== 'Group') return object
    const bounds = getObjectBounds(getFrameDescendants(objects, object.objectId).filter((child) => !child.isFrame))
    return bounds ? { ...object, ...bounds } : object
  })
}

function regroupImportedSvgParts(objects: CanvasObject[], assets: Asset[]) {
  const addedGroups: CanvasObject[] = []
  const childParentIds = new Map<string, string>()
  const removableRootIds = new Set<string>()
  const rootParents = new Map<string, string | undefined>()

  for (const root of objects.filter((item) => item.isFrame && item.category === 'Group' && !item.isGroup)) {
    const children = objects.filter((item) => item.frameId === root.objectId && !item.isFrame)
    const source = assets.find((asset) => asset.id === root.id || asset.source === root.source)
    if (!source || children.length < 2) continue

    const logicalGroups = getSvgStructure(source.markup).filter(({ tag }) => tag === 'g')
    if (logicalGroups.length < 2) continue
    const sourceDocument = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${source.markup}</svg>`, 'image/svg+xml')
    const groupDetails = logicalGroups.flatMap((node, index) => {
      let element: Element = sourceDocument.documentElement
      for (const childIndex of node.path) element = element.children.item(childIndex) ?? element
      const svgId = element.getAttribute('id')
      return svgId ? [{ svgId, label: /^obj-[\w-]+$/.test(node.label) ? `Group ${index + 1}` : node.label }] : []
    })
    if (groupDetails.length < 2) continue
    const groupBySvgId = new Map(groupDetails.map((group) => [group.svgId, group.label]))
    const groupedChildren = new Map<string, CanvasObject[]>()

    for (const child of children) {
      const parsed = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${child.markup}</svg>`, 'image/svg+xml')
      const extracted = Array.from(parsed.documentElement.children).find((element) => !['defs', 'title', 'desc', 'metadata', 'style', 'mask', 'clipPath', 'filter', 'pattern', 'linearGradient', 'radialGradient', 'marker'].includes(element.localName))
      const svgGroupId = extracted?.localName === 'g' ? extracted.getAttribute('id') : null
      if (!svgGroupId || !groupBySvgId.has(svgGroupId)) continue
      groupedChildren.set(svgGroupId, [...(groupedChildren.get(svgGroupId) ?? []), child])
    }

    if (groupedChildren.size < 2) continue
    const groupIds = new Set<string>()
    for (const group of groupDetails) {
      const childrenInGroup = groupedChildren.get(group.svgId)
      if (!childrenInGroup?.length) continue
      const bounds = getObjectBounds(childrenInGroup)
      if (!bounds) continue
      const groupId = makeId()
      groupIds.add(groupId)
      addedGroups.push({
        ...root,
        id: groupId,
        objectId: groupId,
        name: `${root.name.replace(/ group$/i, '')} · ${group.label}`,
        category: 'Group',
        ...bounds,
        markup: '',
        isFrame: true,
        isGroup: true,
        frameId: root.objectId,
      })
      childrenInGroup.forEach((child) => childParentIds.set(child.objectId, groupId))
    }
    if (children.every((child) => childParentIds.has(child.objectId))) {
      removableRootIds.add(root.objectId)
      rootParents.set(root.objectId, root.frameId)
      for (const group of addedGroups) if (groupIds.has(group.objectId)) group.frameId = root.frameId
    } else rootParents.set(root.objectId, root.frameId)
  }

  if (!addedGroups.length) return objects
  const nextObjects = objects.flatMap((item) => {
    const frameId = childParentIds.get(item.objectId)
    if (removableRootIds.has(item.objectId)) return []
    if (frameId) return [{ ...item, frameId }]
    return [item]
  })
  const migrated = [...nextObjects, ...addedGroups].map((item) => removableRootIds.has(item.frameId ?? '')
    ? { ...item, frameId: rootParents.get(item.frameId!) }
    : item)
  const frames = migrated.filter((item) => item.isFrame)
  const contents = migrated.filter((item) => !item.isFrame)
  return fitFrameBounds([...frames, ...contents])
}

function getFrameDescendants(objects: CanvasObject[], frameId: string): CanvasObject[] {
  return objects.flatMap((item) => item.frameId === frameId
    ? [item, ...(item.isFrame ? getFrameDescendants(objects, item.objectId) : [])]
    : [])
}

function expandSelectedFrames(selected: CanvasObject[], objects: CanvasObject[]) {
  const expanded = new Map(selected.map((item) => [item.objectId, item]))
  selected.filter((item) => item.isFrame).forEach((frame) => {
    getFrameDescendants(objects, frame.objectId).forEach((item) => expanded.set(item.objectId, item))
  })
  return [...expanded.values()]
}

function getFrameAncestors(objects: CanvasObject[], item: CanvasObject) {
  const ancestors: CanvasObject[] = []
  const visited = new Set<string>()
  let frameId = item.frameId
  while (frameId && !visited.has(frameId)) {
    visited.add(frameId)
    const parent = objects.find((candidate) => candidate.objectId === frameId && candidate.isFrame)
    if (!parent) break
    ancestors.push(parent)
    frameId = parent.frameId
  }
  return ancestors
}

function isObjectEffectivelyVisible(objects: CanvasObject[], item: CanvasObject) {
  return item.visible && getFrameAncestors(objects, item).every((ancestor) => ancestor.visible)
}

function isObjectEffectivelyLocked(objects: CanvasObject[], item: CanvasObject) {
  return item.locked || getFrameAncestors(objects, item).some((ancestor) => ancestor.locked)
}

function flattenImportedRootFrames(objects: CanvasObject[], assets: Asset[]) {
  const removable = new Map<string, string | undefined>()
  for (const root of objects.filter((item) => item.isFrame && item.category === 'Group')) {
    const source = assets.find((asset) => asset.source === root.source)
    if (!source || root.name !== `${source.name} group`) continue
    const children = objects.filter((item) => item.frameId === root.objectId)
    const groups = children.filter((item) => item.isFrame && item.isGroup)
    if (groups.length >= 2 && children.every((item) => item.isFrame && item.isGroup)) removable.set(root.objectId, root.frameId)
  }
  if (!removable.size) return objects
  return objects.flatMap((item) => {
    if (removable.has(item.objectId)) return []
    const parentId = item.frameId
    return [parentId && removable.has(parentId) ? { ...item, frameId: removable.get(parentId) } : item]
  })
}

function putFrameHitTargetsBehindContents(objects: CanvasObject[]) {
  return [...objects.filter((item) => item.isFrame), ...objects.filter((item) => !item.isFrame)]
}

function assetThumbnail(asset: Asset) {
  const markup = namespaceSvgIds(asset.markup, asset.id)
  const document = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml')
  const symbol = document.querySelector(':scope > symbol')
  const symbolId = symbol?.getAttribute('id')
  const viewBox = symbol?.getAttribute('viewBox')
  if (!symbolId || !viewBox) return { markup, viewBox: asset.viewBox }

  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttribute('href', `#${symbolId}`)
  use.setAttribute('width', '100%')
  use.setAttribute('height', '100%')
  document.documentElement.append(use)
  return { markup: document.documentElement.innerHTML, viewBox }
}

function keepSourceObjects(objects: CanvasObject[], assets: Asset[]) {
  const sourceAssetIds = new Set(assets
    .filter((asset) => asset.imported || asset.sourceFileId)
    .map((asset) => asset.id))
  const keptObjects = objects.filter((object) => object.isFrame || object.source === 'PIXO' || sourceAssetIds.has(object.id))
  const frameIds = new Set(keptObjects.filter((object) => object.isFrame).map((object) => object.objectId))
  return keptObjects.map((object) => object.frameId && !frameIds.has(object.frameId) ? { ...object, frameId: undefined } : object)
}

function getAssetFileType(source: string) {
  return /\.(?:png|jpe?g|webp|gif|avif)$/i.test(source) ? 'Image' : 'SVG'
}

const svgDefinitionTags = new Set(['defs', 'mask', 'clippath', 'filter', 'pattern', 'lineargradient', 'radialgradient', 'marker'])

function inspectServiceNode(source: Asset, node: SvgTreeNode) {
  const document = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${source.markup}</svg>`, 'image/svg+xml')
  let element: Element = document.documentElement
  let symbol: Element | undefined
  let isDefinition = false
  for (const childIndex of node.path) {
    const child = element.children.item(childIndex)
    if (!child) return null
    element = child
    if (svgDefinitionTags.has(element.localName.toLowerCase())) isDefinition = true
    if (element.localName === 'symbol') symbol = element
  }
  return { element, symbol, isDefinition }
}

function tintServiceIconMarkup(markup: string, sourceId: string) {
  if (sourceId !== 'service-icons') return markup
  const document = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml')
  document.querySelectorAll('*').forEach((element) => {
    if (element.closest('defs, mask, clipPath')) return
    if (element.getAttribute('fill')?.toLowerCase() === '#08060d') element.setAttribute('fill', '#7049f5')
    const style = element.getAttribute('style')
    if (style) element.setAttribute('style', style.replace(/#08060d/gi, '#7049f5'))
  })
  document.querySelectorAll('style').forEach((style) => {
    style.textContent = (style.textContent ?? '').replace(/#08060d/gi, '#7049f5')
  })
  return document.documentElement.innerHTML
}

function getSvgDimensions(viewBox: string, fallback: { width: number; height: number }) {
  const values = viewBox.trim().split(/[\s,]+/).map(Number)
  if (values.length !== 4 || !Number.isFinite(values[2]) || !Number.isFinite(values[3]) || values[2] <= 0 || values[3] <= 0) return fallback
  return { width: values[2], height: values[3] }
}

function createServiceLibraryAssets(): Asset[] {
  const sourceFiles = [
    { id: 'service-icons', name: 'Service icon sprite', source: 'icons.svg', markup: serviceIconsSvg },
    { id: 'service-react', name: 'React logo', source: 'react.svg', markup: reactLogoSvg },
    { id: 'service-vite', name: 'Vite logo', source: 'vite.svg', markup: viteLogoSvg },
    { id: 'service-pixo', name: 'Pixo mark', source: 'favicon.svg', markup: pixoMarkSvg },
  ]
  const sources = sourceFiles.map((file): Asset => {
    const parsed = cleanSvg(file.markup)
    return {
      ...file,
      category: 'Imported',
      width: parsed.width,
      height: parsed.height,
      viewBox: parsed.viewBox,
      markup: parsed.markup,
      imported: true,
    }
  })
  const components: Asset[] = []

  for (const source of sources) {
    const nodes = flattenSvgTree(getSvgStructure(source.markup))
    for (const { node, depth } of nodes) {
      const isComponent = node.tag === 'symbol' || node.tag === 'path' || (node.tag === 'g' && depth === 0 && source.id !== 'service-icons')
      if (!isComponent || components.length >= 20) continue
      const inspected = inspectServiceNode(source, node)
      if (!inspected || inspected.isDefinition) continue
      const markup = extractSvgNode(source, node.path)
      if (!markup) continue

      const viewBox = inspected.symbol?.getAttribute('viewBox') || source.viewBox
      const dimensions = getSvgDimensions(viewBox, source)
      const symbolName = inspected.symbol?.getAttribute('id')?.replace(/-icon$/, '').replace(/-/g, ' ')
      const elementName = node.tag === 'symbol'
        ? node.label.replace(/-icon$/, '').replace(/-/g, ' ')
        : symbolName
          ? `${symbolName} detail ${node.label}`
          : `${source.name} ${node.label}`
      const componentMarkup = tintServiceIconMarkup(markup, source.id)
      components.push({
        id: `service-component-${components.length + 1}`,
        name: elementName,
        category: 'Service elements',
        width: dimensions.width,
        height: dimensions.height,
        viewBox,
        markup: componentMarkup,
        source: source.source,
        sourceFileId: source.id,
      })
    }
  }

  while (components.length < 20) {
    const source = sources[components.length % sources.length]
    components.push({
      ...source,
      id: `service-component-${components.length + 1}`,
      name: `${source.name} complete`,
      category: 'Service elements',
      imported: false,
      sourceFileId: source.id,
    })
  }

  return [...sources, ...components]
}

function getInitialLibraryAssets() {
  const stored = readStored<Asset[]>('pixo-library-assets', []).filter((asset) => asset.imported || asset.sourceFileId)
  const serviceAssets = createServiceLibraryAssets()
  if (!stored.length) return serviceAssets
  return stored.map((asset) => {
    const serviceAsset = serviceAssets.find((item) => item.id === asset.id)
    return serviceAsset ? { ...asset, name: serviceAsset.name, markup: serviceAsset.markup } : asset
  })
}

const ruCopy: Record<string, string> = {
  'Projects': 'Проекты', 'Components': 'Компоненты', 'Assets': 'Ресурсы', 'Search projects, components...': 'Поиск проектов и компонентов...',
  'Import SVG': 'Импорт SVG', 'Import': 'Импорт', 'Import files': 'Импорт файлов', 'SVG or photo · Up to 5 MB': 'SVG или фото · до 5 МБ', 'Export SVG': 'Экспорт SVG', 'Settings': 'Настройки', 'Sign out': 'Выйти', 'Nickname': 'Псевдоним', 'Local profile': 'Локальный профиль', 'Projects stay saved on this device.': 'Проекты сохраняются на этом устройстве.',
  'Pixo workspace': 'Рабочее пространство Pixo', 'Your workspace': 'Ваше рабочее пространство', 'New project': 'Новый проект', 'objects': 'объектов', 'Edited': 'Изменён', 'No matching projects': 'Нет подходящих проектов', 'Your workspace is empty': 'Рабочее пространство пусто', 'Try another search.': 'Попробуйте другой запрос.', 'Create a project to start composing.': 'Создайте проект, чтобы начать работу.',
  'Library': 'Библиотека', 'Files': 'Файлы', 'Search components...': 'Поиск компонентов...', 'People': 'Люди', 'All': 'Все', 'Objects': 'Объекты', 'Nature': 'Природа', 'Decorations': 'Декор', 'Recently added': 'Недавно добавленные', 'Name A–Z': 'Имя А–Я', 'Type': 'Тип', 'Imported files': 'Импортированные файлы', 'View all': 'Показать все', 'Source files': 'Исходные файлы', 'Project assets': 'Ресурсы проекта', 'Import SVG files': 'Импортировать SVG-файлы', 'Up to 5 MB each': 'До 5 МБ каждый', 'Import your first SVG': 'Импортируйте первый SVG', 'Drop a file or browse': 'Перетащите файл или выберите его',
  'Properties': 'Свойства', 'Layers': 'Слои', 'Transform': 'Трансформация', 'Appearance': 'Внешний вид', 'Stroke': 'Обводка', 'Object': 'Объект', 'Document': 'Документ', 'Canvas': 'Холст', 'Canvas size': 'Размер холста', 'Background': 'Фон', 'Image': 'Изображение', 'Zoom': 'Масштаб', 'Snap to grid': 'Привязка к сетке', 'Text': 'Текст', 'Duplicate': 'Дублировать', 'Delete': 'Удалить', 'Add component': 'Добавить компонент', 'Search layers...': 'Поиск слоёв...',
  'Select': 'Выбор', 'Pan': 'Перемещение', 'Help': 'Помощь', 'Undo': 'Отменить', 'Redo': 'Повторить', 'Zoom in': 'Увеличить', 'Zoom out': 'Уменьшить', 'Fit canvas': 'Уместить холст', 'Canvas settings': 'Настройки холста', 'Frame selection': 'Выделить область',
  'Export composition': 'Экспорт композиции', 'File name': 'Имя файла', 'Transparent background': 'Прозрачный фон', 'Vector shapes stay editable in your design tools.': 'Векторные формы останутся редактируемыми в графических редакторах.', 'Cancel': 'Отмена', 'Done': 'Готово', 'Close': 'Закрыть', 'Editor shortcuts': 'Горячие клавиши редактора', 'Select all': 'Выбрать всё', 'Deselect': 'Снять выделение', 'Move selection': 'Переместить выделение', 'Nudge 10 px': 'Сдвинуть на 10 px', 'Group selection': 'Сгруппировать', 'Ungroup selection': 'Разгруппировать', 'Create frame from selection': 'Создать фрейм из выделения',
  'Language': 'Язык', 'Choose the interface language': 'Выберите язык интерфейса', 'Interface theme': 'Тема интерфейса', 'Customise your application theme': 'Настройте внешний вид приложения', 'Light': 'Светлая', 'Dark': 'Тёмная', 'Workspace': 'Рабочая область', 'Canvas grid': 'Сетка на холсте', 'Show dots on the work area': 'Показывать точки на рабочей области', 'Canvas background': 'Фон холста', 'Ungroup': 'Разгруппировать',
  'Copy': 'Копировать', 'Cut': 'Вырезать', 'Paste': 'Вставить', 'Bring to front': 'На передний план', 'Send to back': 'На задний план', 'Flip horizontally': 'Отразить по горизонтали', 'Flip vertically': 'Отразить по вертикали', 'Save as component': 'Сохранить как компонент',
  'Account menu': 'Меню аккаунта', 'Add the whole source as one object': 'Добавить весь исходный файл одним объектом', 'Align bottom': 'Выровнять по нижнему краю', 'Align horizontal center': 'Выровнять по горизонтальному центру', 'Align left': 'Выровнять по левому краю', 'Align right': 'Выровнять по правому краю', 'Align top': 'Выровнять по верхнему краю', 'Align vertical center': 'Выровнять по вертикальному центру', 'Alpha': 'Альфа', 'Bring selection to front': 'Переместить выделенное на передний план', 'Close color picker': 'Закрыть выбор цвета', 'Close context menu': 'Закрыть контекстное меню', 'Close export dialog': 'Закрыть окно экспорта', 'Close help': 'Закрыть справку', 'Close icon editor': 'Закрыть редактор значка', 'Close settings': 'Закрыть настройки', 'Collapse library': 'Свернуть библиотеку', 'Collapse properties': 'Свернуть свойства', 'Color format': 'Формат цвета', 'Composition canvas': 'Холст композиции', 'Create SVG icon': 'Создать значок SVG', 'Delete project': 'Удалить проект', 'Distribute horizontally': 'Распределить по горизонтали', 'Distribute vertically': 'Распределить по вертикали', 'Double-click to rename': 'Дважды щёлкните, чтобы переименовать', 'Download project JSON': 'Скачать проект в формате JSON', 'Ellipse': 'Эллипс', 'Inspect SVG structure': 'Изучить структуру SVG', 'Icon name': 'Название значка', 'Lock proportions': 'Сохранять пропорции', 'Move layer backward': 'Переместить слой назад', 'Move layer forward': 'Переместить слой вперёд', 'Open account menu': 'Открыть меню аккаунта', 'Pixo home': 'На главную Pixo', 'Recent colors': 'Недавние цвета', 'Rectangle': 'Прямоугольник', 'Redo (Ctrl+Shift+Z)': 'Повторить (Ctrl+Shift+Z)', 'Resize imported files height': 'Изменить высоту панели файлов', 'Resize inspector panel': 'Изменить ширину панели свойств', 'Resize library panel': 'Изменить ширину библиотеки', 'Saturation and brightness': 'Насыщенность и яркость', 'Send selection to back': 'Переместить выделенное на задний план', 'Show inspector': 'Показать свойства', 'Show library': 'Показать библиотеку', 'Text content': 'Текстовое содержимое', 'Tools': 'Инструменты', 'Undo (Ctrl+Z)': 'Отменить (Ctrl+Z)', 'Undo last shape': 'Отменить последнее действие',
  'Drop files to import': 'Перетащите файлы для импорта', 'No components yet': 'Пока нет компонентов', 'No extractable SVG elements found.': 'В SVG не найдены элементы для извлечения.', 'The file does not contain valid SVG markup.': 'Файл не содержит корректную SVG-разметку.', 'Save icon': 'Сохранить значок', 'Save your work in the format you need': 'Сохраните работу в нужном формате', 'Select an object to inspect its properties.': 'Выберите объект, чтобы посмотреть его свойства.', 'Separate into group': 'Разделить на группу', 'Source': 'Источник', 'SVG structure': 'Структура SVG', 'Your imported SVGs will appear here.': 'Здесь появятся импортированные SVG-файлы.', 'Saved': 'Сохранено', 'Saving': 'Сохранение', 'Synced': 'Синхронизировано', 'Guest': 'Гость', 'Local project': 'Локальный проект', 'Stored on this device': 'Сохранено на этом устройстве', 'Recent projects': 'Недавние проекты', 'Name': 'Название', 'Font': 'Шрифт', 'Size': 'Размер', 'Hue': 'Тон', 'Opacity': 'Непрозрачность', 'My dashboard': 'Моя панель', 'Service elements': 'Служебные элементы', 'Groups': 'Группы', 'Frames': 'Фреймы', 'Imported': 'Импортировано', 'English': 'Английский', 'Russian': 'Русский', 'Sans serif': 'Без засечек', 'Monospace': 'Моноширинный', 'Serif': 'С засечками', 'Browse components': 'Открыть библиотеку компонентов', 'Extract': 'Извлечь', 'Import SVG source': 'Импортировать исходный SVG', 'Pen': 'Карандаш', 'Expand group': 'Развернуть группу', 'Collapse group': 'Свернуть группу', 'Hide layer': 'Скрыть слой', 'Show layer': 'Показать слой', 'Lock layer': 'Заблокировать слой', 'Unlock layer': 'Разблокировать слой', 'Group object': 'Объект-группа', 'SVG group': 'Группа SVG', 'Inspector': 'Свойства', 'Objects object': 'Объект', 'Fill': 'Заливка', 'Drawing color': 'Цвет рисования', 'Shape color': 'Цвет фигуры', 'System': 'Системная', 'Ready': 'Всё готово', 'Could not load local workspace storage': 'Не удалось загрузить локальные данные рабочей области', 'Could not save the workspace locally': 'Не удалось сохранить рабочую область на устройстве', 'Select at least three layers to distribute': 'Для распределения выберите не менее трёх слоёв', 'Brought to front': 'Перемещено на передний план', 'Sent to back': 'Перемещено на задний план', 'Moved layer forward': 'Слой перемещён вперёд', 'Moved layer backward': 'Слой перемещён назад', 'This SVG has no separate vector objects': 'В этом SVG нет отдельных векторных объектов', 'Group separated into individual objects': 'Группа разделена на отдельные объекты', 'Select at least two layers to group': 'Для группировки выберите не менее двух слоёв', 'Select layers from the same group': 'Выберите слои из одной группы', 'Layers grouped': 'Слои сгруппированы', 'Select objects without frames to create a frame': 'Чтобы создать фрейм, выберите объекты без фреймов', 'Frame created': 'Фрейм создан', 'Could not extract this SVG element': 'Не удалось извлечь этот элемент SVG', 'Drag to move the canvas': 'Перетащите, чтобы переместить холст', 'Project created': 'Проект создан', 'Could not read this SVG.': 'Не удалось прочитать этот SVG-файл.', 'SVG exported': 'SVG экспортирован', 'Saved to your library': 'Сохранено в библиотеке', 'Signed out. Project remains saved locally.': 'Вы вышли из аккаунта. Проект сохранён на устройстве.', 'Canvas fitted to view': 'Холст уместился в рабочей области',
}

function translateRussian(value: string, language: 'en' | 'ru') {
  if (language === 'ru') {
    const exact = ruCopy[value]
    if (exact) return exact
    const objects = value.match(/^(\d+) objects$/)
    if (objects) {
      const count = Number(objects[1])
      const lastTwo = count % 100
      const last = count % 10
      const noun = lastTwo >= 11 && lastTwo <= 14 ? 'объектов' : last === 1 ? 'объект' : last >= 2 && last <= 4 ? 'объекта' : 'объектов'
      return `${count} ${noun}`
    }
    const patterns: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
      [/^(\d+) layers$/, ([, count]) => `${count} слоёв`],
      [/^(\d+) selected$/, ([, count]) => `Выбрано: ${count}`],
      [/^(\d+) elements$/, ([, count]) => `Элементов: ${count}`],
      [/^(\d+) source illustrations$/, ([, count]) => `Исходных иллюстраций: ${count}`],
      [/^(\d+) local projects?$/, ([, count]) => `Локальных проектов: ${count}`],
      [/^Edited (.+)$/, ([, date]) => `Изменён: ${date}`],
      [/^Aligned (left|center|right|top|middle|bottom)$/, ([, side]) => `Выравнивание: ${{ left: 'по левому краю', center: 'по центру', right: 'по правому краю', top: 'по верхнему краю', middle: 'по середине', bottom: 'по нижнему краю' }[side]}`],
      [/^Distributed (horizontal|vertical)$/, ([, axis]) => `Распределено ${axis === 'horizontal' ? 'по горизонтали' : 'по вертикали'}`],
      [/^(.+) added as (\d+) objects$/, ([, name, count]) => `${name}: добавлено объектов — ${count}`],
      [/^(.+) added to canvas$/, ([, name]) => `${name} добавлен на холст`],
      [/^Separated into a group with (\d+) objects$/, ([, count]) => `Создана группа из ${count} объектов`],
      [/^(.+) extracted to Library$/, ([, name]) => `${name} добавлен в библиотеку`],
      [/^(.+) imported$/, ([, name]) => `${name} импортирован`],
      [/^(.+) created$/, ([, name]) => `${name} создан`],
      [/^(.+): choose an SVG smaller than 5 MB$/, ([, name]) => `${name}: выберите SVG-файл размером менее 5 МБ`],
      [/^Add (.+) to canvas$/, ([, name]) => `Добавить ${name} на холст`],
      [/^Download (.+)$/, ([, name]) => `Скачать ${name}`],
      [/^Delete (.+)$/, ([, name]) => `Удалить проект ${name}`],
      [/^Inspect (.+)$/, ([, name]) => `Изучить ${name}`],
      [/^Extract (.+)$/, ([, name]) => `Извлечь ${name}`],
      [/^Preview of (.+)$/, ([, name]) => `Предпросмотр: ${name}`],
      [/^(.+) color picker$/, ([, label]) => `Выбор цвета: ${label}`],
      [/^(.+) color$/, ([, label]) => `${ruCopy[label] ?? label}: цвет`],
      [/^Use (.+)$/, ([, color]) => `Использовать цвет ${color}`],
    ]
    for (const [pattern, translate] of patterns) {
      const match = value.match(pattern)
      if (match) return translate(match)
    }
    return value
  }
  const dynamicRussian: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^(\d+) (?:объект|объекта|объектов)$/, ([, count]) => `${count} ${Number(count) === 1 ? 'object' : 'objects'}`],
    [/^(\d+) слоёв$/, ([, count]) => `${count} layers`],
    [/^Выбрано: (\d+)$/, ([, count]) => `${count} selected`],
    [/^Элементов: (\d+)$/, ([, count]) => `${count} elements`],
    [/^Исходных иллюстраций: (\d+)$/, ([, count]) => `${count} source illustrations`],
    [/^Локальных проектов: (\d+)$/, ([, count]) => `${count} local project${Number(count) === 1 ? '' : 's'}`],
    [/^Изменён: (.+)$/, ([, date]) => `Edited ${date}`],
    [/^Выравнивание: (.+)$/, ([, side]) => `Aligned ${{ 'по левому краю': 'left', 'по центру': 'center', 'по правому краю': 'right', 'по верхнему краю': 'top', 'по середине': 'middle', 'по нижнему краю': 'bottom' }[side] ?? side}`],
    [/^Распределено по горизонтали$/, () => 'Distributed horizontal'],
    [/^Распределено по вертикали$/, () => 'Distributed vertical'],
    [/^(.+): добавлено объектов — (\d+)$/, ([, name, count]) => `${name} added as ${count} objects`],
    [/^(.+) добавлен на холст$/, ([, name]) => `${name} added to canvas`],
    [/^Создана группа из (\d+) объектов$/, ([, count]) => `Separated into a group with ${count} objects`],
    [/^(.+) добавлен в библиотеку$/, ([, name]) => `${name} extracted to Library`],
    [/^(.+) импортирован$/, ([, name]) => `${name} imported`],
    [/^(.+) создан$/, ([, name]) => `${name} created`],
    [/^(.+): выберите SVG-файл размером менее 5 МБ$/, ([, name]) => `${name}: choose an SVG smaller than 5 MB`],
    [/^Добавить (.+) на холст$/, ([, name]) => `Add ${name} to canvas`],
    [/^Скачать (.+)$/, ([, name]) => `Download ${name}`],
    [/^Удалить проект (.+)$/, ([, name]) => `Delete ${name}`],
    [/^Изучить (.+)$/, ([, name]) => `Inspect ${name}`],
    [/^Извлечь (.+)$/, ([, name]) => `Extract ${name}`],
    [/^Предпросмотр: (.+)$/, ([, name]) => `Preview of ${name}`],
    [/^Выбор цвета: (.+)$/, ([, label]) => `${Object.entries(ruCopy).find(([, russian]) => russian === label)?.[0] ?? label} color picker`],
    [/^(.+): цвет$/, ([, label]) => `${Object.entries(ruCopy).find(([, russian]) => russian === label)?.[0] ?? label} color`],
    [/^Использовать цвет (.+)$/, ([, color]) => `Use ${color}`],
    [/^Всё готово$/, () => 'Ready'],
  ]
  for (const [pattern, translate] of dynamicRussian) {
    const match = value.match(pattern)
    if (match) return translate(match)
  }
  const original = Object.entries(ruCopy).find(([, russian]) => russian === value)?.[0]
  return original ?? value
}

function App() {
  const [customAssets, setCustomAssets] = useState<Asset[]>(getInitialLibraryAssets)
  const [fileDragActive, setFileDragActive] = useState(false)
  const [objects, setObjects] = useState<CanvasObject[]>(() => keepSourceObjects(readStored('pixo-project-objects', []), customAssets))
  const [projects, setProjects] = useState<Project[]>(() => readStored<Project[]>('pixo-projects', []).map((project) => ({
    ...project,
    objects: keepSourceObjects(project.objects, customAssets),
  })))
  const [storageReady, setStorageReady] = useState(false)
  const [currentProjectId, setCurrentProjectId] = useState(() => readStored('pixo-active-project-id', 'local-project'))
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [libraryTab, setLibraryTab] = useState('Library')
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState('Inspector')
  const [collapsedLayerGroups, setCollapsedLayerGroups] = useState<string[]>([])
  const [category, setCategory] = useState('All')
  const [assetSort, setAssetSort] = useState<'name' | 'type'>('name')
  const [assetSortMenuOpen, setAssetSortMenuOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [projectName, setProjectName] = useState('Launch day')
  const [editingName, setEditingName] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [zoom, setZoom] = useState(1)
  const [canvasWidth, setCanvasWidth] = useState(1440)
  const [canvasHeight, setCanvasHeight] = useState(900)
  const [canvasCenter, setCanvasCenter] = useState({ x: 720, y: 450 })
  const [isPanning, setIsPanning] = useState(false)
  const [saved, setSaved] = useState(true)
  const [toast, setToast] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; objectId?: string } | null>(null)
  const [showExport, setShowExport] = useState(false)
  const [showIconEditor, setShowIconEditor] = useState(false)
  const [iconName, setIconName] = useState('my-icon')
  const [iconTool, setIconTool] = useState<IconTool>('rectangle')
  const [iconColor, setIconColor] = useState(() => readStored('pixo-drawing-color', '#7049f5'))
  const [iconText, setIconText] = useState('')
  const [iconShapes, setIconShapes] = useState<IconShape[]>([])
  const [iconPreview, setIconPreview] = useState<IconShape | null>(null)
  const [iconPoints, setIconPoints] = useState<IconPoint[]>([])
  const [canvasTextDraft, setCanvasTextDraft] = useState<{ x: number; y: number; value: string } | null>(null)
  const [canvasTextFontSize, setCanvasTextFontSize] = useState(42)
  const [canvasTextFontFamily, setCanvasTextFontFamily] = useState('sans-serif')
  const [canvasDrawing, setCanvasDrawing] = useState<{ kind: 'rect' | 'ellipse' | 'path'; start: IconPoint; current: IconPoint; points: IconPoint[] } | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [profileName, setProfileName] = useState(() => readStored('pixo-profile-name', 'Mira'))
  const [snapToGrid, setSnapToGrid] = useState(() => readStored('pixo-snap-to-grid', false))
  const [interfaceTheme, setInterfaceTheme] = useState<ThemeMode>(getInitialThemeMode)
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const resolvedTheme = interfaceTheme === 'system' ? systemTheme : interfaceTheme
  const [canvasBackground, setCanvasBackground] = useState(() => {
    const stored = readStored<string>('pixo-canvas-background', '#101115')
    if (resolvedTheme === 'dark' && stored.toLowerCase() === '#ffffff') return '#101115'
    if (resolvedTheme === 'light' && stored.toLowerCase() === '#101115') return '#ffffff'
    return stored
  })
  const [language, setLanguage] = useState<'en' | 'ru'>(() => readStored('pixo-language', 'ru'))
  const [exportName, setExportName] = useState('launch-day')
  const [transparentBackground, setTransparentBackground] = useState(true)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [activeNav, setActiveNav] = useState('Projects')
  const [showLanding, setShowLanding] = useState(() => readStored<'landing' | 'projects' | 'editor'>('pixo-last-view', 'landing') === 'landing')
  const [showProjects, setShowProjects] = useState(() => readStored<'landing' | 'projects' | 'editor'>('pixo-last-view', 'landing') === 'projects')
  const [activeTool, setActiveTool] = useState('Select')
  const [activeRailItem, setActiveRailItem] = useState<'Library' | 'Layers' | 'Files' | 'Assets' | null>('Library')
  const [mobilePanel, setMobilePanel] = useState<'library' | 'inspector' | null>(null)
  const [libraryWidth, setLibraryWidth] = useState(250)
  const [importedFilesHeight, setImportedFilesHeight] = useState(132)
  const [inspectorWidth, setInspectorWidth] = useState(250)
  const [libraryCollapsed, setLibraryCollapsed] = useState(false)
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const projectsRef = useRef(projects)
  const objectsRef = useRef(objects)
  const fileInput = useRef<HTMLInputElement>(null)
  const globalSearchRef = useRef<HTMLInputElement>(null)
  const appShellRef = useRef<HTMLElement>(null)
  const landingFrameRef = useRef<HTMLIFrameElement>(null)
  const openLastProjectFromLandingRef = useRef<() => void>(() => {})
  const pendingLandingOpenRef = useRef(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const languageControlRef = useRef<HTMLDivElement>(null)
  const assetSortControlRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<SVGSVGElement>(null)
  const iconCanvasRef = useRef<SVGSVGElement>(null)
  const iconDrawRef = useRef<{ start: IconPoint; tool: IconTool } | null>(null)
  const snapToGridRef = useRef(snapToGrid)
  const previousResolvedTheme = useRef(resolvedTheme)
  const resolvedThemeRef = useRef(resolvedTheme)
  const dragRef = useRef<DragState | null>(null)
  const selectionDragRef = useRef<{ startX: number; startY: number } | null>(null)
  const canvasDrawRef = useRef<{ kind: 'rect' | 'ellipse' | 'path'; start: IconPoint; points: IconPoint[] } | null>(null)
  const suppressCanvasClickRef = useRef(false)
  const panRef = useRef<{ startX: number; startY: number; centerX: number; centerY: number } | null>(null)
  const panelResizeRef = useRef<{ panel: 'library' | 'inspector'; startX: number; width: number } | null>(null)
  const importedFilesResizeRef = useRef<{ startY: number; height: number } | null>(null)
  const colorEditRef = useRef(false)
  const undoStack = useRef<CanvasObject[][]>([])
  const redoStack = useRef<CanvasObject[][]>([])
  const clipboard = useRef<CanvasObject[]>([])
  function pushHistory(snapshot = objectsRef.current) {
    undoStack.current = [...undoStack.current.slice(-39), snapshot.map((item) => ({ ...item }))]
    redoStack.current = []
    setCanUndo(true)
    setCanRedo(false)
  }
  const selected = objects.filter((item) => selectedIds.includes(item.objectId))
  const selectedBounds = getObjectBounds(selected.flatMap((item) => item.isGroup
    ? getFrameDescendants(objects, item.objectId).filter((child) => !child.isFrame)
    : [item]))
  const current = selected.length === 1 ? selected[0] : undefined
  const canUngroupSelection = selected.length === 1 && Boolean(selected[0].isFrame && objects.some((item) => item.frameId === selected[0].objectId))
  const selectedParentIds = new Set(selected.map((item) => item.frameId ?? ''))
  const selectedContainsAncestor = selected.some((item) => getFrameAncestors(objects, item).some((ancestor) => selectedIds.includes(ancestor.objectId)))
  const canGroupSelection = selected.length > 1 && selectedParentIds.size === 1 && !selectedContainsAncestor
  const canvasTextDraftWidth = canvasTextDraft ? Math.min(720, measureTextWidth(canvasTextDraft.value, canvasTextFontSize, canvasTextFontFamily)) : 0
  const assets = customAssets.filter((asset) => !asset.imported && asset.sourceFileId)
  const importedFiles = customAssets.filter((asset) => asset.imported)
  const expandedSource = importedFiles.find((asset) => asset.id === expandedSourceId)
  const expandedNodes = expandedSource ? flattenSvgTree(getSvgStructure(expandedSource.markup)) : []
  const categories = ['All', ...new Set(assets.map((asset) => asset.category))]
  const filteredAssets = assets.filter((asset) => {
    const matchesCategory = category === 'All' || asset.category === category
    const matchesSearch = `${asset.name} ${asset.category} ${asset.source}`.toLowerCase().includes(search.toLowerCase())
    return matchesCategory && matchesSearch
  })
  const sortedAssets = [...filteredAssets].sort((a, b) => assetSort === 'name'
    ? a.name.localeCompare(b.name)
    : a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  const filteredProjects = projects.filter((project) => project.name.toLowerCase().includes(search.toLowerCase()))
  const layerMatchesSearch = (item: CanvasObject) => item.name.toLowerCase().includes(search.toLowerCase())
  const frameIds = new Set(objects.filter((item) => item.isFrame).map((item) => item.objectId))
  const childrenOf = (item: CanvasObject) => item.isFrame ? objects.filter((candidate) => candidate.frameId === item.objectId).reverse() : []
  const hasLayerMatch = (item: CanvasObject): boolean => layerMatchesSearch(item) || childrenOf(item).some(hasLayerMatch)
  const buildLayerRows = (item: CanvasObject, depth: number): { item: CanvasObject; depth: number; hasChildren: boolean }[] => {
    const children = childrenOf(item)
    if (!hasLayerMatch(item)) return []
    const childrenToShow = search && !layerMatchesSearch(item) ? children.filter(hasLayerMatch) : children
    return [
      { item, depth, hasChildren: children.length > 0 },
      ...(item.isFrame && !collapsedLayerGroups.includes(item.objectId)
        ? childrenToShow.flatMap((child) => buildLayerRows(child, depth + 1))
        : []),
    ]
  }
  const layerRows = objects
    .filter((item) => !item.frameId || !frameIds.has(item.frameId))
    .slice()
    .reverse()
    .flatMap((item) => buildLayerRows(item, 0))

  function selectTheme(mode: ThemeMode) {
    setInterfaceTheme(mode)
  }

  useEffect(() => {
    const previousTheme = previousResolvedTheme.current
    previousResolvedTheme.current = resolvedTheme
    resolvedThemeRef.current = resolvedTheme
    if (previousTheme === resolvedTheme) return
    if (canvasBackground.toLowerCase() === (previousTheme === 'light' ? '#ffffff' : '#101115')) {
      startTransition(() => setCanvasBackground(resolvedTheme === 'light' ? '#ffffff' : '#101115'))
    }
  }, [canvasBackground, resolvedTheme])

  useEffect(() => {
    landingFrameRef.current?.contentWindow?.postMessage({ type: 'pixo:theme', theme: resolvedTheme }, window.location.origin)
  }, [resolvedTheme, showLanding])

  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  useEffect(() => {
    objectsRef.current = objects
  }, [objects])

  useEffect(() => {
    let cancelled = false
    async function hydrateWorkspace() {
      const legacyAssets = readStored<Asset[]>('pixo-library-assets', [])
      const legacyObjects = readStored<CanvasObject[]>('pixo-project-objects', [])
      const legacyProjects = readStored<Project[]>('pixo-projects', [])
      const legacyActiveId = readStored('pixo-active-project-id', 'local-project')
      const [storedAssets, storedObjects, storedProjects, storedActiveId, serviceLibrarySeeded] = await Promise.all([
        readWorkspaceValue<Asset[] | null>('assets', null),
        readWorkspaceValue<CanvasObject[] | null>('objects', null),
        readWorkspaceValue<Project[] | null>('projects', null),
        readWorkspaceValue<string | null>('active-project-id', null),
        readWorkspaceValue<boolean>('service-library-seeded', false),
      ])
      const storedLibrary = (storedAssets ?? legacyAssets).filter((asset) => asset.imported || asset.sourceFileId)
      const shouldSeedServiceLibrary = storedLibrary.length === 0 && !serviceLibrarySeeded
      const serviceAssets = createServiceLibraryAssets()
      const nextAssets = shouldSeedServiceLibrary
        ? serviceAssets
        : storedLibrary.map((asset) => {
          const serviceAsset = serviceAssets.find((item) => item.id === asset.id)
          return serviceAsset ? { ...asset, name: serviceAsset.name, markup: serviceAsset.markup } : asset
        })
      const nextActiveId = storedActiveId ?? legacyActiveId
      const normalizeObjects = (items: CanvasObject[]) => {
        const sourceObjects = keepSourceObjects(items, nextAssets).flatMap((item) => {
          if (item.isFrame || item.frameId || (!item.imported && !item.sourceFileId) || getAssetFileType(item.source) !== 'SVG') return [item]
          const separated = buildSvgGroupParts(item)
          return separated?.parts.length ? [...(separated.group ? [separated.group] : []), ...separated.parts] : [item]
        })
        return putFrameHitTargetsBehindContents(
          fitFrameBounds(regroupImportedSvgParts(flattenImportedRootFrames(sourceObjects, nextAssets), nextAssets)),
        )
      }
      const nextObjects = normalizeObjects(storedObjects ?? legacyObjects)
      const nextProjects = (storedProjects ?? legacyProjects).map((project) => ({
        ...project,
        objects: project.id === nextActiveId ? nextObjects : normalizeObjects(project.objects ?? []),
      }))
      await Promise.all([
        writeWorkspaceValue('assets', nextAssets),
        writeWorkspaceValue('objects', nextObjects),
        writeWorkspaceValue('projects', nextProjects),
        writeWorkspaceValue('active-project-id', nextActiveId),
        writeWorkspaceValue('service-library-seeded', serviceLibrarySeeded || shouldSeedServiceLibrary || storedLibrary.length > 0),
      ])
      if (cancelled) return
      setCustomAssets(nextAssets)
      objectsRef.current = nextObjects
      setObjects(nextObjects)
      setProjects(nextProjects)
      projectsRef.current = nextProjects
      setCurrentProjectId(nextActiveId)
      const activeProject = nextProjects.find((project) => project.id === nextActiveId)
      if (activeProject) {
        setProjectName(activeProject.name)
        setCanvasWidth(activeProject.width || 1440)
        setCanvasHeight(activeProject.height || 900)
        setCanvasBackground(getCanvasBackgroundForTheme(activeProject.backgroundColor, resolvedThemeRef.current))
        setCanvasCenter({ x: (activeProject.width || 1440) / 2, y: (activeProject.height || 900) / 2 })
      }
      setStorageReady(true)
    }
    void hydrateWorkspace().catch(() => {
      if (!cancelled) {
        setToast('Could not load local workspace storage')
        setStorageReady(true)
      }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!storageReady) return
    const timer = window.setTimeout(() => {
      void Promise.all([
        writeWorkspaceValue('objects', objects),
        writeWorkspaceValue('assets', customAssets),
      ]).then(() => setSaved(true)).catch(() => {
        setSaved(false)
        setToast('Could not save the workspace locally')
      })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [objects, customAssets, storageReady])

  useEffect(() => {
    if (!storageReady) return
    void writeWorkspaceValue('active-project-id', currentProjectId)
    const timer = window.setTimeout(() => {
      const existing = projectsRef.current.find((project) => project.id === currentProjectId)
      const active: Project = {
        id: currentProjectId,
        name: projectName,
        width: canvasWidth,
        height: canvasHeight,
        backgroundColor: canvasBackground,
        objects,
        createdAt: existing?.createdAt ?? getTimestamp(),
        updatedAt: getTimestamp(),
      }
      const next = [active, ...projectsRef.current.filter((project) => project.id !== currentProjectId)]
      projectsRef.current = next
      setProjects(next)
      void writeWorkspaceValue('projects', next).then(() => setSaved(true)).catch(() => setSaved(false))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [currentProjectId, objects, projectName, canvasWidth, canvasHeight, canvasBackground, storageReady])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateTheme = (event: MediaQueryListEvent) => setSystemTheme(event.matches ? 'dark' : 'light')
    media.addEventListener('change', updateTheme)
    return () => media.removeEventListener('change', updateTheme)
  }, [])

  useEffect(() => {
    const lastView = showLanding ? 'landing' : showProjects ? 'projects' : 'editor'
    localStorage.setItem('pixo-last-view', JSON.stringify(lastView))
  }, [showLanding, showProjects])

  useEffect(() => {
    localStorage.setItem('pixo-profile-name', JSON.stringify(profileName))
    localStorage.setItem('pixo-drawing-color', JSON.stringify(iconColor))
    localStorage.setItem('pixo-canvas-background', JSON.stringify(canvasBackground))
    localStorage.setItem('pixo-snap-to-grid', JSON.stringify(snapToGrid))
    localStorage.setItem('pixo-interface-theme', JSON.stringify(interfaceTheme))
    localStorage.setItem('pixo-interface-theme-v2', JSON.stringify(interfaceTheme))
    localStorage.setItem('pixo-interface-theme-v3', JSON.stringify(interfaceTheme))
    localStorage.setItem('pixo-language', JSON.stringify(language))
    document.documentElement.style.colorScheme = resolvedTheme
    document.documentElement.lang = language
  }, [profileName, iconColor, canvasBackground, snapToGrid, interfaceTheme, resolvedTheme, language])

  useEffect(() => {
    const root = appShellRef.current
    if (!root) return
    const localise = () => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      while (walker.nextNode()) nodes.push(walker.currentNode as Text)
      nodes.forEach((node) => {
        if (node.parentElement?.closest('kbd')) {
          const keycapText = node.data
          if (keycapText.trim() === 'Удалить') node.data = keycapText.replace('Удалить', 'Delete')
          return
        }
        const text = node.data
        const trimmed = text.trim()
        if (!trimmed) return
        const translated = translateRussian(trimmed, language)
        if (translated !== trimmed) node.data = text.replace(trimmed, translated)
      })
      root.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label]').forEach((element) => {
        ;(['placeholder', 'title', 'aria-label'] as const).forEach((attribute) => {
          const value = element.getAttribute(attribute)
          if (!value) return
          const translated = translateRussian(value, language)
          if (translated !== value) element.setAttribute(attribute, translated)
        })
      })
    }
    localise()
    const observer = new MutationObserver(localise)
    observer.observe(root, { childList: true, subtree: true, characterData: true })
    return () => observer.disconnect()
  }, [language])

  useEffect(() => {
    if (!profileMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setProfileMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [profileMenuOpen])

  useEffect(() => {
    if (!languageMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!languageControlRef.current?.contains(event.target as Node)) setLanguageMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [languageMenuOpen])

  useEffect(() => {
    if (!assetSortMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!assetSortControlRef.current?.contains(event.target as Node)) setAssetSortMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [assetSortMenuOpen])

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const filesResize = importedFilesResizeRef.current
      if (filesResize) {
        setImportedFilesHeight(Math.max(90, Math.min(360, filesResize.height + filesResize.startY - event.clientY)))
        return
      }
      const panelResize = panelResizeRef.current
      if (panelResize) {
        const delta = event.clientX - panelResize.startX
        if (panelResize.panel === 'library') {
          setLibraryWidth(Math.max(190, Math.min(420, panelResize.width + delta)))
        } else {
          setInspectorWidth(Math.max(210, Math.min(420, panelResize.width - delta)))
        }
        return
      }
      const pan = panRef.current
      const canvas = canvasRef.current
      if (pan && canvas) {
        const bounds = canvas.getBoundingClientRect()
        const scaleX = canvasWidth / (bounds.width * zoom)
        const scaleY = canvasHeight / (bounds.height * zoom)
        setCanvasCenter({
          x: pan.centerX - (event.clientX - pan.startX) * scaleX,
          y: pan.centerY - (event.clientY - pan.startY) * scaleY,
        })
        return
      }
      const selectionDrag = selectionDragRef.current
      if (selectionDrag && canvas) {
        const point = canvas.createSVGPoint()
        point.x = event.clientX
        point.y = event.clientY
        const local = point.matrixTransform(canvas.getScreenCTM()?.inverse())
        setSelectionRect({
          x: Math.min(selectionDrag.startX, local.x),
          y: Math.min(selectionDrag.startY, local.y),
          width: Math.abs(local.x - selectionDrag.startX),
          height: Math.abs(local.y - selectionDrag.startY),
        })
        return
      }
      const drag = dragRef.current
      if (!canvas) return
      const point = canvas.createSVGPoint()
      point.x = event.clientX
      point.y = event.clientY
      const local = point.matrixTransform(canvas.getScreenCTM()?.inverse())
      const shouldSnap = snapToGridRef.current
      if (!drag) return
      const dx = local.x - drag.startX
      const dy = local.y - drag.startY
      if (!drag.moved) {
        const movementThreshold = 2 / Math.max(.55, zoom)
        if (Math.hypot(dx, dy) < movementThreshold) return
        drag.moved = true
        pushHistory()
        setSaved(false)
      }
      if (drag.mode === 'resize' && drag.snapshots && drag.snapshots.length > 1 && drag.bounds) {
        const { bounds, snapshots } = drag
        const signX = drag.handle?.includes('w') ? -1 : 1
        const signY = drag.handle?.includes('n') ? -1 : 1
        const width = bounds.width + dx * signX
        const height = bounds.height + dy * signY
        const scale = getProportionalResizeScale(bounds.width, bounds.height, width, height)
        const nextWidth = bounds.width * scale
        const nextHeight = bounds.height * scale
        const nextX = signX < 0 ? bounds.x + bounds.width - nextWidth : bounds.x
        const nextY = signY < 0 ? bounds.y + bounds.height - nextHeight : bounds.y
        setObjects((items) => {
          const next = fitFrameBounds(items.map((item) => {
          const snapshot = snapshots.find((entry) => entry.objectId === item.objectId)
          if (!snapshot) return item
          return {
            ...item,
            x: nextX + (snapshot.x - bounds.x) * scale,
            y: nextY + (snapshot.y - bounds.y) * scale,
            width: snapshot.width * scale,
            height: snapshot.height * scale,
          }
          }))
          objectsRef.current = next
          return next
        })
        return
      }
      setObjects((items) => {
        const next = fitFrameBounds(items.map((item) => {
          if (!drag.objectIds?.includes(item.objectId) && item.objectId !== drag.id) return item
          if (drag.mode === 'resize') {
          const signX = drag.handle?.includes('w') ? -1 : 1
          const signY = drag.handle?.includes('n') ? -1 : 1
          let width = drag.width + dx * signX
          let height = drag.height + dy * signY
          if (item.proportionsLocked && drag.width > 0 && drag.height > 0) {
            let scale = getProportionalResizeScale(drag.width, drag.height, width, height)
            if (shouldSnap) {
              const snapBasis = Math.max(drag.width, drag.height)
              scale = Math.max(30 / drag.width, 30 / drag.height, Math.round(snapBasis * scale / 24) * 24 / snapBasis)
            }
            width = drag.width * scale
            height = drag.height * scale
          } else {
            width = Math.max(30, width)
            height = Math.max(30, height)
            if (shouldSnap) {
              width = Math.max(30, Math.round(width / 24) * 24)
              height = Math.max(30, Math.round(height / 24) * 24)
            }
          }
            return { ...item, width, height, x: drag.handle?.includes('w') ? drag.x + drag.width - width : drag.x, y: drag.handle?.includes('n') ? drag.y + drag.height - height : drag.y }
          }
          const initial = drag.snapshots?.find((snapshot) => snapshot.objectId === item.objectId)
          const x = (initial?.x ?? drag.x) + dx
          const y = (initial?.y ?? drag.y) + dy
          return { ...item, x: shouldSnap ? Math.round(x / 24) * 24 : x, y: shouldSnap ? Math.round(y / 24) * 24 : y }
        }))
        objectsRef.current = next
        return next
      })
    }
    const onPointerUp = () => {
      const drag = dragRef.current
      if (drag && !drag.moved && drag.selectOnClick) setSelectedIds([drag.selectOnClick])
      dragRef.current = null
      selectionDragRef.current = null
      panelResizeRef.current = null
      importedFilesResizeRef.current = null
      panRef.current = null
      setIsPanning(false)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [canvasWidth, canvasHeight, zoom])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onPointerDown = (event: PointerEvent) => {
      if (activeTool !== 'Select' || event.button !== 0 || event.target !== canvas) return
      const point = canvas.createSVGPoint()
      point.x = event.clientX
      point.y = event.clientY
      const local = point.matrixTransform(canvas.getScreenCTM()?.inverse())
      selectionDragRef.current = { startX: local.x, startY: local.y }
      setSelectionRect({ x: local.x, y: local.y, width: 0, height: 0 })
      canvas.setPointerCapture(event.pointerId)
    }

    const onPointerUp = (event: PointerEvent) => {
      const selectionDrag = selectionDragRef.current
      if (!selectionDrag) return
      const point = canvas.createSVGPoint()
      point.x = event.clientX
      point.y = event.clientY
      const local = point.matrixTransform(canvas.getScreenCTM()?.inverse())
      const left = Math.min(selectionDrag.startX, local.x)
      const top = Math.min(selectionDrag.startY, local.y)
      const right = Math.max(selectionDrag.startX, local.x)
      const bottom = Math.max(selectionDrag.startY, local.y)
      const ids = objects.filter((item) => isObjectEffectivelyVisible(objects, item)
        && item.x < right && item.x + item.width > left
        && item.y < bottom && item.y + item.height > top)
        .map((item) => item.objectId)
      const moved = Math.abs(right - left) > 2 || Math.abs(bottom - top) > 2
      setSelectedIds(moved ? ids : [])
      suppressCanvasClickRef.current = moved
      selectionDragRef.current = null
      setSelectionRect(null)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
    }
  }, [activeTool, objects])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2200)
    return () => window.clearTimeout(timer)
  }, [toast])

  function undo() {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(objectsRef.current.map((item) => ({ ...item })))
    const fitted = fitFrameBounds(previous)
    objectsRef.current = fitted
    setObjects(fitted)
    setSaved(false)
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
  }

  function redo() {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(objectsRef.current.map((item) => ({ ...item })))
    const fitted = fitFrameBounds(next)
    objectsRef.current = fitted
    setObjects(fitted)
    setSaved(false)
    setCanUndo(true)
    setCanRedo(redoStack.current.length > 0)
  }

  function commit(next: CanvasObject[]) {
    pushHistory()
    const fitted = fitFrameBounds(next)
    objectsRef.current = fitted
    setObjects(fitted)
    setSaved(false)
  }

  function updateObjects(updater: (items: CanvasObject[]) => CanvasObject[]) {
    pushHistory()
    setObjects((items) => {
      const next = fitFrameBounds(updater(items))
      objectsRef.current = next
      return next
    })
    setSaved(false)
  }

  function startPanelResize(event: React.PointerEvent<HTMLDivElement>, panel: 'library' | 'inspector') {
    if (event.button !== 0 || (panel === 'library' ? libraryCollapsed : inspectorCollapsed)) return
    event.preventDefault()
    panelResizeRef.current = {
      panel,
      startX: event.clientX,
      width: panel === 'library' ? libraryWidth : inspectorWidth,
    }
  }

  function resizeFromKeyboard(panel: 'library' | 'inspector', event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 24 : 12
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? step : -step
    if (panel === 'library') setLibraryWidth((width) => Math.max(190, Math.min(420, width + delta)))
    else setInspectorWidth((width) => Math.max(210, Math.min(420, width - delta)))
  }

  function startImportedFilesResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    importedFilesResizeRef.current = { startY: event.clientY, height: importedFilesHeight }
  }

  function resizeImportedFilesByKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation()
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const step = event.shiftKey ? 24 : 12
    const delta = event.key === 'ArrowUp' ? step : -step
    setImportedFilesHeight((height) => Math.max(90, Math.min(360, height + delta)))
  }

  function updateSelected(patch: Partial<CanvasObject>) {
    if (!selectedIds.length) return
    commit(objectsRef.current.map((item) => selectedIds.includes(item.objectId) ? { ...item, ...patch } : item))
  }

  function updateTextStyle(patch: Pick<CanvasObject, 'fontSize' | 'fontFamily'>) {
    if (!current || current.category !== 'Text') return
    const fontSize = Math.max(8, Math.min(240, patch.fontSize ?? current.fontSize ?? 42))
    const fontFamily = patch.fontFamily ?? current.fontFamily ?? 'sans-serif'
    const textContent = current.textContent ?? current.markup.match(/<text[^>]*>([\s\S]*?)<\/text>/i)?.[1]?.replace(/<[^>]*>/g, '') ?? current.name
    const safeText = textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const width = Math.max(90, Math.min(1440, textContent.length * fontSize * .62))
    const height = Math.max(56, fontSize * 1.35)
    const markup = `<text x="0" y="${Math.round(fontSize)}" fill="${getSvgPaint(current.markup, 'fill')}" font-family="${fontFamily}" font-size="${fontSize}">${safeText}</text>`
    updateSelected({ markup, width, height, viewBox: `0 0 ${width} ${height}`, textContent, fontSize, fontFamily })
  }

  function beginColorEdit() {
    if (colorEditRef.current) return
    pushHistory()
    colorEditRef.current = true
  }

  function updateSelectedPaint(property: 'fill' | 'stroke', color: string) {
    if (!selectedIds.length) return
    setObjects((items) => {
      const next = items.map((item) => selectedIds.includes(item.objectId)
        ? { ...item, markup: setSvgPaint(item.markup, property, color) }
        : item)
      objectsRef.current = next
      return next
    })
    setIconColor(colorToHex(parseColor(color)))
    setSaved(false)
  }

  function finishColorEdit() {
    colorEditRef.current = false
  }

  function updateSelectedDimension(axis: 'width' | 'height', value: number) {
    if (!current) return
    if (!current.proportionsLocked || current.width <= 0 || current.height <= 0) {
      updateSelected({ [axis]: value })
      return
    }
    const ratio = current.width / current.height
    updateSelected(axis === 'width' ? { width: value, height: value / ratio } : { height: value, width: value * ratio })
  }

  function toggleSnapToGrid() {
    const enabled = !snapToGridRef.current
    snapToGridRef.current = enabled
    setSnapToGrid(enabled)
  }

  function updateCanvasDimension(axis: 'width' | 'height', value: number) {
    const dimension = Math.max(64, Math.min(4096, Math.round(value)))
    if (axis === 'width') {
      setCanvasWidth(dimension)
      setCanvasCenter((center) => ({ ...center, x: dimension / 2 }))
    } else {
      setCanvasHeight(dimension)
      setCanvasCenter((center) => ({ ...center, y: dimension / 2 }))
    }
    setSaved(false)
  }

  function alignSelected(mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    if (!selectedBounds) return
    const parentFrame = selected.length === 1 && selected[0].frameId
      ? objects.find((item) => item.objectId === selected[0].frameId && item.isFrame)
      : undefined
    const alignmentBounds = parentFrame ? getObjectBounds([parentFrame]) : selectedBounds
    if (!alignmentBounds) return
    const minX = alignmentBounds.x
    const maxX = alignmentBounds.x + alignmentBounds.width
    const minY = alignmentBounds.y
    const maxY = alignmentBounds.y + alignmentBounds.height
    const targetX = minX
    const targetRight = maxX
    const targetY = minY
    const targetBottom = maxY
    commit(objects.map((item) => {
      if (!selectedIds.includes(item.objectId)) return item
      if (mode === 'left') return { ...item, x: targetX }
      if (mode === 'right') return { ...item, x: targetRight - item.width }
      if (mode === 'center') return { ...item, x: (targetX + targetRight - item.width) / 2 }
      if (mode === 'top') return { ...item, y: targetY }
      if (mode === 'bottom') return { ...item, y: targetBottom - item.height }
      return { ...item, y: (targetY + targetBottom - item.height) / 2 }
    }))
    setToast(`Aligned ${mode}`)
  }

  function distributeSelected(axis: 'horizontal' | 'vertical') {
    if (selected.length < 3) { setToast('Select at least three layers to distribute'); return }
    const ordered = [...selected].sort((a, b) => axis === 'horizontal' ? a.x - b.x : a.y - b.y)
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    const totalSize = ordered.reduce((sum, item) => sum + (axis === 'horizontal' ? item.width : item.height), 0)
    const distance = (axis === 'horizontal' ? last.x + last.width - first.x : last.y + last.height - first.y) - totalSize
    let cursor = axis === 'horizontal' ? first.x : first.y
    const positions = new Map<string, number>()
    ordered.forEach((item, index) => { positions.set(item.objectId, cursor); cursor += (axis === 'horizontal' ? item.width : item.height) + (index < ordered.length - 1 ? distance / (ordered.length - 1) : 0) })
    commit(objects.map((item) => positions.has(item.objectId) ? { ...item, [axis === 'horizontal' ? 'x' : 'y']: positions.get(item.objectId)! } : item))
    setToast(`Distributed ${axis}`)
  }

  function arrangeSelected(direction: 'front' | 'back' | 'forward' | 'backward') {
    if (!selectedIds.length) return
    let next = [...objectsRef.current]
    if (direction === 'front') next = [...next.filter((item) => !selectedIds.includes(item.objectId)), ...next.filter((item) => selectedIds.includes(item.objectId))]
    if (direction === 'back') next = [...next.filter((item) => selectedIds.includes(item.objectId)), ...next.filter((item) => !selectedIds.includes(item.objectId))]
    if (direction === 'forward') for (let index = next.length - 2; index >= 0; index--) if (selectedIds.includes(next[index].objectId) && !selectedIds.includes(next[index + 1].objectId)) [next[index], next[index + 1]] = [next[index + 1], next[index]]
    if (direction === 'backward') for (let index = 1; index < next.length; index++) if (selectedIds.includes(next[index].objectId) && !selectedIds.includes(next[index - 1].objectId)) [next[index], next[index - 1]] = [next[index - 1], next[index]]
    commit(next)
    setToast(direction === 'front' ? 'Brought to front' : direction === 'back' ? 'Sent to back' : direction === 'forward' ? 'Moved layer forward' : 'Moved layer backward')
  }

  function buildSvgGroupParts(root: CanvasObject, granularity: 'logical' | 'primitive' = 'logical'): { group?: CanvasObject; parts: CanvasObject[] } | null {
    const renderableTags = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'image', 'use'])
    const structure = getSvgStructure(root.markup)
    const isLogicalNode = (node: SvgTreeNode) => renderableTags.has(node.tag)
      || (node.tag === 'g' || node.tag === 'symbol') && flattenSvgTree(node.children).some(({ node: child }) => renderableTags.has(child.tag))
    let logicalNodes = structure.filter(isLogicalNode).map((node) => ({ node, depth: 0 }))
    while (logicalNodes.length === 1 && (logicalNodes[0].node.tag === 'g' || logicalNodes[0].node.tag === 'symbol')) {
      const children = logicalNodes[0].node.children.filter(isLogicalNode).map((node) => ({ node, depth: 1 }))
      if (!children.length) break
      logicalNodes = children
    }
    const nodes = (granularity === 'primitive'
      ? flattenSvgTree(structure).filter(({ node }) => node.children.length === 0 && renderableTags.has(node.tag))
      : logicalNodes).slice(0, 200)
    if (nodes.length < 2) return null
    const values = root.viewBox.trim().split(/[\s,]+/).map(Number)
    const [viewX, viewY, viewWidth, viewHeight] = values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0
      ? values
      : [0, 0, root.width, root.height]
    const scaleX = root.width / viewWidth
    const scaleY = root.height / viewHeight
    const groupId = granularity === 'primitive' ? makeId() : null
    const parts = nodes.flatMap(({ node }, index) => {
      const markup = extractSvgNode(root, node.path)
      if (!markup) return []
      const bounds = measureSvgNodeBounds(root, node.path) ?? { x: viewX, y: viewY, width: viewWidth, height: viewHeight }
      const label = node.tag === 'g' && /^obj-[\w-]+$/.test(node.label) ? `Group ${index + 1}` : node.label
      return [{
        ...root,
        objectId: makeId(),
        name: `${root.name} · ${label || `Object ${index + 1}`}`,
        x: root.x + (bounds.x - viewX) * scaleX,
        y: root.y + (bounds.y - viewY) * scaleY,
        width: bounds.width * scaleX,
        height: bounds.height * scaleY,
        viewBox: `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,
        markup,
        frameId: groupId ?? root.frameId,
        isFrame: false,
      }]
    })
    if (parts.length < 2) return null
    if (!groupId) return { parts }
    const groupBounds = getObjectBounds(parts) ?? root
    const group: CanvasObject = {
      ...root,
      id: groupId,
      objectId: groupId,
      name: `${root.name} group`,
      category: 'Group',
      x: groupBounds.x,
      y: groupBounds.y,
      width: groupBounds.width,
      height: groupBounds.height,
      markup: '',
      isFrame: true,
      isGroup: true,
      frameId: root.frameId,
    }
    return { group, parts }
  }

  function addAsset(asset: Asset, at?: { x: number; y: number }) {
    const scale = Math.min(290 / asset.width, 290 / asset.height)
    const width = asset.width * scale
    const height = asset.height * scale
    const next: CanvasObject = {
      ...asset, objectId: makeId(), x: at?.x ?? canvasWidth / 2 - width / 2, y: at?.y ?? canvasHeight / 2 - height / 2,
      width, height, rotation: 0, opacity: 1, visible: true, locked: false,
      proportionsLocked: true,
    }
    const separated = asset.imported && getAssetFileType(asset.source) === 'SVG' ? buildSvgGroupParts(next) : null
    commit(separated ? [...objectsRef.current, ...(separated.group ? [separated.group] : []), ...separated.parts] : [...objectsRef.current, next])
    setSelectedIds([separated?.group?.objectId ?? separated?.parts[0]?.objectId ?? next.objectId])
    setActiveTool('Select')
    setToast(separated ? `${asset.name} added as ${separated.parts.length} objects` : `${asset.name} added to canvas`)
    if (window.matchMedia('(max-width: 680px)').matches) setMobilePanel(null)
    return next
  }

  function separateSelectedSvg() {
    if (!current || (!current.imported && !current.sourceFileId)) return
    const separated = buildSvgGroupParts(current, 'primitive')
    if (!separated?.group) {
      setToast('This SVG has no separate vector objects')
      return
    }
    const group = separated.group
    const next = objectsRef.current.flatMap((item) => item.objectId === current.objectId ? [group, ...separated.parts] : [item])
    commit(next)
    setSelectedIds([group.objectId])
    setToast(`Separated into a group with ${separated.parts.length} objects`)
  }

  function ungroupSelected() {
    if (!current?.isFrame) return
    const children = objectsRef.current.filter((item) => item.frameId === current.objectId)
    if (!children.length) return
    const next = objectsRef.current
      .filter((item) => item.objectId !== current.objectId)
      .map((item) => item.frameId === current.objectId ? { ...item, frameId: current.frameId } : item)
    commit(next)
    setSelectedIds([children[0].objectId])
    setToast('Group separated into individual objects')
  }

  function groupSelected() {
    if (!canGroupSelection) {
      setToast(selected.length < 2 ? 'Select at least two layers to group' : 'Select layers from the same group')
      return
    }
    const items = objectsRef.current.filter((item) => selectedIds.includes(item.objectId))
    const bounds = getObjectBounds(expandSelectedFrames(items, objectsRef.current))
    if (!bounds) return
    const groupId = makeId()
    const parentId = items[0].frameId
    const group: CanvasObject = {
      id: groupId,
      objectId: groupId,
      name: `Group ${objectsRef.current.filter((item) => item.isGroup).length + 1}`,
      category: 'Group',
      width: bounds.width,
      height: bounds.height,
      viewBox: `0 0 ${bounds.width} ${bounds.height}`,
      markup: '',
      source: 'PIXO',
      x: bounds.x,
      y: bounds.y,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      isFrame: true,
      isGroup: true,
      frameId: parentId,
    }
    const next = objectsRef.current.map((item) => selectedIds.includes(item.objectId) ? { ...item, frameId: groupId } : item)
    const insertionIndex = next.findIndex((item) => selectedIds.includes(item.objectId))
    next.splice(insertionIndex < 0 ? next.length : insertionIndex, 0, group)
    commit(next)
    setSelectedIds([groupId])
    setCollapsedLayerGroups((groups) => groups.filter((id) => id !== groupId))
    setToast('Layers grouped')
  }

  function createFrameFromSelection() {
    if (!selected.length || !selectedBounds) return
    if (selected.some((item) => item.isFrame)) {
      setToast('Select objects without frames to create a frame')
      return
    }
    const frameId = makeId()
    const frame: CanvasObject = {
      id: frameId,
      objectId: frameId,
      name: `Frame ${objects.filter((item) => item.isFrame).length + 1}`,
      category: 'Frames',
      width: selectedBounds.width,
      height: selectedBounds.height,
      viewBox: `0 0 ${selectedBounds.width} ${selectedBounds.height}`,
      markup: '',
      source: 'PIXO',
      x: selectedBounds.x,
      y: selectedBounds.y,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      isFrame: true,
    }
    const selectedObjectIds = new Set(selectedIds)
    const insertionIndex = objects.findIndex((item) => selectedObjectIds.has(item.objectId))
    const next = objects.map((item) => selectedObjectIds.has(item.objectId) ? { ...item, frameId } : item)
    next.splice(insertionIndex, 0, frame)
    commit(next)
    setSelectedIds([frameId])
    setToast('Frame created')
  }

  function extractComponent(source: Asset, node: SvgTreeNode) {
    const markup = extractSvgNode(source, node.path)
    if (!markup) {
      setToast('Could not extract this SVG element')
      return
    }
    const category = node.tag === 'g' || node.tag === 'svg' ? 'Groups' : 'Objects'
    const component: Asset = {
      id: makeId(), name: node.label, category, width: source.width, height: source.height,
      viewBox: source.viewBox, markup, source: source.source, sourceFileId: source.id,
    }
    setCustomAssets((items) => [component, ...items])
    setSaved(false)
    setToast(`${component.name} extracted to Library`)
  }

  function canvasPoint(clientX: number, clientY: number) {
    const canvas = canvasRef.current
    if (!canvas) return { x: canvasWidth / 2, y: canvasHeight / 2 }
    const point = canvas.createSVGPoint()
    point.x = clientX
    point.y = clientY
    const local = point.matrixTransform(canvas.getScreenCTM()?.inverse())
    return { x: local.x, y: local.y }
  }

  function addCanvasSvg(name: string, markup: string, x: number, y: number, width: number, height: number, category = 'Objects', textOptions?: Pick<CanvasObject, 'textContent' | 'fontSize' | 'fontFamily'>) {
    const id = makeId()
    const item: CanvasObject = {
      id, objectId: id, name, category, width, height, viewBox: `0 0 ${width} ${height}`,
      markup, source: 'PIXO', x, y, rotation: 0, opacity: 1, visible: true, locked: false,
      proportionsLocked: true, ...textOptions,
    }
    commit([...objectsRef.current, item])
    setSelectedIds([id])
    return item
  }

  function commitCanvasText() {
    if (!canvasTextDraft) return
    const value = canvasTextDraft.value.trim()
    if (value) {
      const width = Math.min(1440, measureTextWidth(value, canvasTextFontSize, canvasTextFontFamily))
      const safeText = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      const height = Math.max(56, canvasTextFontSize * 1.35)
      const markup = `<text x="0" y="${canvasTextFontSize}" fill="${iconColor}" font-family="${canvasTextFontFamily}" font-size="${canvasTextFontSize}" font-weight="600">${safeText}</text>`
      addCanvasSvg(value.slice(0, 32), markup, canvasTextDraft.x, canvasTextDraft.y - canvasTextFontSize, width, height, 'Text', { textContent: value, fontSize: canvasTextFontSize, fontFamily: canvasTextFontFamily })
    }
    setCanvasTextDraft(null)
  }

  function startCanvasTool(event: React.PointerEvent<SVGSVGElement>) {
    if (activeTool === 'Select' || activeTool === 'Pan') return
    event.preventDefault()
    event.stopPropagation()
    const start = canvasPoint(event.clientX, event.clientY)
    if (activeTool === 'Text') {
      setCanvasTextDraft({ ...start, value: '' })
      return
    }
    const kind = activeTool === 'Pen' ? 'path' : activeTool === 'Ellipse' ? 'ellipse' : 'rect'
    canvasDrawRef.current = { kind, start, points: [start] }
    setCanvasDrawing({ kind, start, current: start, points: [start] })
    canvasRef.current?.setPointerCapture(event.pointerId)
  }

  function moveCanvasTool(event: React.PointerEvent<SVGSVGElement>) {
    const drawing = canvasDrawRef.current
    if (!drawing) return
    const current = canvasPoint(event.clientX, event.clientY)
    const points = drawing.kind === 'path'
      && Math.hypot(current.x - drawing.points[drawing.points.length - 1].x, current.y - drawing.points[drawing.points.length - 1].y) >= 2
      ? [...drawing.points, current]
      : drawing.points
    canvasDrawRef.current = { ...drawing, points }
    setCanvasDrawing({ ...drawing, current, points })
  }

  function finishCanvasTool(event: React.PointerEvent<SVGSVGElement>) {
    const drawing = canvasDrawRef.current
    if (!drawing) return
    const end = canvasPoint(event.clientX, event.clientY)
    if (drawing.kind === 'path') {
      const points = [...drawing.points, end]
      if (points.length > 1) {
        const left = Math.min(...points.map((point) => point.x))
        const top = Math.min(...points.map((point) => point.y))
        const width = Math.max(1, Math.max(...points.map((point) => point.x)) - left)
        const height = Math.max(1, Math.max(...points.map((point) => point.y)) - top)
        const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${(point.x - left).toFixed(2)} ${(point.y - top).toFixed(2)}`).join(' ')
        addCanvasSvg('Path', `<path d="${path}" fill="none" stroke="${iconColor}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`, left, top, width, height)
      }
    } else {
      const left = Math.min(drawing.start.x, end.x)
      const top = Math.min(drawing.start.y, end.y)
      const width = Math.abs(end.x - drawing.start.x)
      const height = Math.abs(end.y - drawing.start.y)
      if (width >= 3 && height >= 3) {
        const markup = drawing.kind === 'ellipse'
          ? `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${iconColor}"/>`
          : `<rect x="0" y="0" width="${width}" height="${height}" fill="${iconColor}"/>`
        addCanvasSvg(drawing.kind === 'ellipse' ? 'Ellipse' : 'Rectangle', markup, left, top, width, height)
      }
    }
    canvasDrawRef.current = null
    setCanvasDrawing(null)
  }

  function activateTool(name: string) {
    setActiveTool(name)
    if (name === 'Components') {
      setLibraryTab('Library')
      setActiveNav('Components')
    } else if (name === 'Layers') {
      setInspectorTab('Layers')
    } else if (name === 'Pan') {
      setToast('Drag to move the canvas')
    }
  }

  function handleCanvasClick(event: React.MouseEvent<SVGSVGElement>) {
    const clickedObject = event.target instanceof Element && event.target.closest('.canvas-object')
    if (!clickedObject && (activeTool === 'Select' || activeTool === 'Layers') && !suppressCanvasClickRef.current) setSelectedIds([])
    suppressCanvasClickRef.current = false
  }

  function handleCanvasPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (canvasTextDraft) {
      event.preventDefault()
      commitCanvasText()
      return
    }
    const clickedObject = event.target instanceof Element && event.target.closest('.canvas-object')
    const clickedHandle = event.target instanceof Element && event.target.closest('.resize-handle')
    if (activeTool === 'Select' && event.button === 0 && !clickedObject && !clickedHandle) {
      const point = canvasPoint(event.clientX, event.clientY)
      const hitObject = [...objects].reverse().filter((item) => {
        if (item.isFrame || isObjectEffectivelyLocked(objects, item) || !isObjectEffectivelyVisible(objects, item)) return false
        return isCanvasPointInsideObject(point, item)
      }).sort((left, right) => Math.abs(left.width * left.height) - Math.abs(right.width * right.height))[0]
      if (hitObject) {
        startDrag(event, hitObject)
        return
      }
    }
    if (activeTool === 'Pan' && !clickedObject && !clickedHandle) {
      event.preventDefault()
      panRef.current = { startX: event.clientX, startY: event.clientY, centerX: canvasCenter.x, centerY: canvasCenter.y }
      setIsPanning(true)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    if (event.button === 0 && !clickedObject && !clickedHandle && selectedIds.length) {
      suppressCanvasClickRef.current = false
      setSelectedIds([])
      return
    }
    startCanvasTool(event)
  }

  function handleCanvasWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? canvas.clientHeight
        : 1
    const nextZoom = Math.max(.55, Math.min(1.8, zoom * Math.exp(-event.deltaY * unit * .0015)))
    if (nextZoom === zoom) return

    const cursor = canvasPoint(event.clientX, event.clientY)
    const view = canvas.viewBox.baseVal
    const ratioX = (cursor.x - view.x) / view.width
    const ratioY = (cursor.y - view.y) / view.height
    setCanvasCenter({
      x: cursor.x - (ratioX - .5) * canvasWidth / nextZoom,
      y: cursor.y - (ratioY - .5) * canvasHeight / nextZoom,
    })
    setZoom(nextZoom)
  }

  function handleLayerRename(item: CanvasObject) {
    setRenamingId(item.objectId)
    setRenameValue(item.name)
  }

  function finishLayerRename(commit: boolean) {
    if (commit && renamingId && renameValue.trim()) {
      const name = renameValue.trim()
      updateObjects((items) => items.map((item) => item.objectId === renamingId ? { ...item, name } : item))
    }
    setRenamingId(null)
    setRenameValue('')
  }

  function duplicateSelected() {
    if (!selected.length) return
    const sourceItems = expandSelectedFrames(selected, objectsRef.current)
    const idMap = new Map<string, string>(sourceItems.map((item) => [item.objectId, makeId()]))
    const copies = sourceItems.map((item) => {
      const objectId = idMap.get(item.objectId)!
      return {
        ...item,
        id: item.isFrame ? objectId : item.id,
        objectId,
        frameId: item.frameId ? idMap.get(item.frameId) ?? item.frameId : undefined,
        x: item.x + 24,
        y: item.y + 24,
        name: `${item.name} copy`,
      }
    })
    commit([...objectsRef.current, ...copies])
    setSelectedIds(selected.map((item) => idMap.get(item.objectId)).filter((id): id is string => Boolean(id)))
  }

  function copySelected() {
    clipboard.current = expandSelectedFrames(selected, objectsRef.current)
  }

  function pasteObjects() {
    if (!clipboard.current.length) return
    const idMap = new Map<string, string>(clipboard.current.map((item) => [item.objectId, makeId()]))
    const copies = clipboard.current.map((item) => {
      const objectId = idMap.get(item.objectId)!
      return {
        ...item,
        id: item.isFrame ? objectId : item.id,
        objectId,
        frameId: item.frameId ? idMap.get(item.frameId) ?? item.frameId : undefined,
        x: item.x + 32,
        y: item.y + 32,
      }
    })
    commit([...objectsRef.current, ...copies])
    const copiedIds = new Set(clipboard.current.map((item) => item.objectId))
    setSelectedIds(clipboard.current
      .filter((item) => !item.frameId || !copiedIds.has(item.frameId))
      .map((item) => idMap.get(item.objectId)!)
      .filter(Boolean))
  }

  function deleteSelected() {
    if (!selectedIds.length) return
    const deletedIds = new Set(expandSelectedFrames(selected, objectsRef.current).map((item) => item.objectId))
    commit(objectsRef.current.filter((item) => !deletedIds.has(item.objectId)))
    setSelectedIds([])
    setContextMenu(null)
  }

  function saveProjects(next: Project[]) {
    projectsRef.current = next
    setProjects(next)
    void writeWorkspaceValue('projects', next)
  }

  function persistActiveProject() {
    const existing = projectsRef.current.find((project) => project.id === currentProjectId)
    const project: Project = {
      id: currentProjectId, name: projectName, width: canvasWidth, height: canvasHeight, backgroundColor: canvasBackground,
      objects: objects.map((item) => ({ ...item })),
      createdAt: existing?.createdAt ?? getTimestamp(), updatedAt: getTimestamp(),
    }
    const next = [project, ...projectsRef.current.filter((item) => item.id !== currentProjectId)]
    saveProjects(next)
  }

  function openProject(project: Project) {
    persistActiveProject()
    setCurrentProjectId(project.id)
    setProjectName(project.name)
    const nextObjects = project.objects.map((item) => ({ ...item }))
    objectsRef.current = nextObjects
    setObjects(nextObjects)
    setCanvasWidth(project.width || 1440)
    setCanvasHeight(project.height || 900)
    setCanvasBackground(getCanvasBackgroundForTheme(project.backgroundColor, resolvedTheme))
    setCanvasCenter({ x: (project.width || 1440) / 2, y: (project.height || 900) / 2 })
    setSelectedIds([])
    undoStack.current = []
    redoStack.current = []
    setCanUndo(false)
    setCanRedo(false)
    setShowLanding(false)
    setShowProjects(false)
    setActiveNav('Projects')
  }

  function createProject() {
    persistActiveProject()
    const defaultBackground = getCanvasBackgroundForTheme(undefined, resolvedTheme)
    const project: Project = {
      id: makeId(), name: 'Untitled project', width: 1440, height: 900,
      backgroundColor: defaultBackground, objects: [], createdAt: getTimestamp(), updatedAt: getTimestamp(),
    }
    const next = [project, ...projectsRef.current.filter((item) => item.id !== project.id)]
    saveProjects(next)
    setCurrentProjectId(project.id)
    setProjectName(project.name)
    objectsRef.current = []
    setObjects([])
    setCanvasWidth(project.width)
    setCanvasHeight(project.height)
    setCanvasBackground(defaultBackground)
    setCanvasCenter({ x: project.width / 2, y: project.height / 2 })
    setSelectedIds([])
    undoStack.current = []
    redoStack.current = []
    setCanUndo(false)
    setCanRedo(false)
    setShowLanding(false)
    setShowProjects(false)
    setActiveNav('Projects')
    setToast('Project created')
  }

  function openLastProjectFromLanding() {
    if (!storageReady) {
      pendingLandingOpenRef.current = true
      return
    }
    const lastProject = projectsRef.current.find((project) => project.id === currentProjectId)
      ?? projectsRef.current.reduce<Project | undefined>((latest, project) => (
        !latest || project.updatedAt > latest.updatedAt ? project : latest
      ), undefined)
    if (lastProject) {
      openProject(lastProject)
      return
    }
    setShowLanding(false)
    setShowProjects(true)
    setActiveNav('Projects')
  }
  useLayoutEffect(() => {
    openLastProjectFromLandingRef.current = openLastProjectFromLanding
  })

  useEffect(() => {
    if (!storageReady || !pendingLandingOpenRef.current) return
    pendingLandingOpenRef.current = false
    openLastProjectFromLandingRef.current()
  }, [storageReady])

  useEffect(() => {
    function handleLandingMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== landingFrameRef.current?.contentWindow) return
      const message = event.data as { type?: string; theme?: unknown } | null
      if (message?.type === 'pixo:open-editor') {
        openLastProjectFromLandingRef.current()
        return
      }
      if (message?.type === 'pixo:set-theme' && (message.theme === 'light' || message.theme === 'dark')) {
        setInterfaceTheme(message.theme)
      }
    }
    window.addEventListener('message', handleLandingMessage)
    return () => window.removeEventListener('message', handleLandingMessage)
  }, [])

  function deleteProject(project: Project) {
    const next = projectsRef.current.filter((item) => item.id !== project.id)
    if (project.id !== currentProjectId) {
      saveProjects(next)
      return
    }
    if (next.length) {
      const replacement = next[0]
      saveProjects(next)
      setCurrentProjectId(replacement.id)
      setProjectName(replacement.name)
      const nextObjects = replacement.objects.map((item) => ({ ...item }))
      objectsRef.current = nextObjects
      setObjects(nextObjects)
      setCanvasWidth(replacement.width || 1440)
      setCanvasHeight(replacement.height || 900)
      setCanvasBackground(getCanvasBackgroundForTheme(replacement.backgroundColor, resolvedTheme))
      setCanvasCenter({ x: (replacement.width || 1440) / 2, y: (replacement.height || 900) / 2 })
      setSelectedIds([])
      setCanUndo(false)
      setCanRedo(false)
    } else {
      const defaultBackground = getCanvasBackgroundForTheme(undefined, resolvedTheme)
      const replacement: Project = { id: makeId(), name: 'Untitled project', width: 1440, height: 900, backgroundColor: defaultBackground, objects: [], createdAt: getTimestamp(), updatedAt: getTimestamp() }
      saveProjects([replacement])
      setCurrentProjectId(replacement.id)
      setProjectName(replacement.name)
      objectsRef.current = []
      setObjects([])
      setCanvasWidth(replacement.width)
      setCanvasHeight(replacement.height)
      setCanvasBackground(defaultBackground)
      setCanvasCenter({ x: replacement.width / 2, y: replacement.height / 2 })
      setSelectedIds([])
      setShowProjects(false)
    }
  }

  function exportProject(project: Project) {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = `${project.name.trim().replace(/[^a-z0-9-_]+/gi, '-') || 'pixo-project'}.pixo.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function startDrag(event: React.PointerEvent<SVGElement>, item: CanvasObject, mode: DragState['mode'] = 'move', handle?: string) {
    let dragItem = item
    let selectOnClick: string | undefined
    if (!event.altKey && mode === 'move' && !selectedIds.includes(item.objectId)) {
      const point = canvasPoint(event.clientX, event.clientY)
      const selectedUnderPointer = [...objects].reverse().find((candidate) => selectedIds.includes(candidate.objectId)
        && candidate.objectId !== item.objectId
        && !candidate.isFrame
        && !isObjectEffectivelyLocked(objects, candidate)
        && isObjectEffectivelyVisible(objects, candidate)
        && isCanvasPointInsideObject(point, candidate))
      if (selectedUnderPointer) {
        dragItem = selectedUnderPointer
        selectOnClick = item.objectId
      }
    }
    if (event.altKey && mode === 'move') {
      const point = canvasPoint(event.clientX, event.clientY)
      const overlapStack = [...objects].reverse().filter((candidate) => !candidate.isFrame
        && !isObjectEffectivelyLocked(objects, candidate)
        && isObjectEffectivelyVisible(objects, candidate)
        && isCanvasPointInsideObject(point, candidate))
      const currentIndex = overlapStack.findIndex((candidate) => candidate.objectId === item.objectId)
      dragItem = overlapStack[currentIndex + 1] ?? (currentIndex === -1 ? overlapStack[0] : undefined) ?? item
    }
    const frameAncestors = getFrameAncestors(objects, dragItem)
    const moveIndividual = event.altKey && mode === 'move'
    const selectedFrameAncestor = moveIndividual ? undefined : frameAncestors.find((ancestor) => selectedIds.includes(ancestor.objectId) && !ancestor.isGroup)
    const dragFrameAncestor = selectedFrameAncestor
    if ((activeTool !== 'Select' && activeTool !== 'Pan') || event.button !== 0 || isObjectEffectivelyLocked(objects, dragItem)) return
    event.stopPropagation()
    const clickedSelection = selectedIds.includes(dragItem.objectId) || Boolean(dragFrameAncestor)
    if (!event.shiftKey && !clickedSelection) setSelectedIds([dragItem.objectId])
    if (event.shiftKey) {
      setSelectedIds((ids) => ids.includes(dragItem.objectId) ? ids.filter((id) => id !== dragItem.objectId) : [...ids, dragItem.objectId])
      return
    }
    const point = canvasRef.current?.createSVGPoint()
    if (!point || !canvasRef.current) return
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(canvasRef.current.getScreenCTM()?.inverse())
    // A click on a group child selects that child; selected frame containers still drag as a unit.
    const movingSelection = dragFrameAncestor
      ? [dragFrameAncestor]
      : clickedSelection ? selected : [dragItem]
    const dragItems = movingSelection.flatMap((selectedItem) => selectedItem.isFrame
      ? [selectedItem, ...getFrameDescendants(objects, selectedItem.objectId)]
      : [selectedItem])
      .filter((candidate, index, items) => items.findIndex((other) => other.objectId === candidate.objectId) === index)
      .filter((selectedItem) => !selectedItem.locked)
    const boundsItems = dragItems.some((selectedItem) => selectedItem.isFrame)
      ? dragItems.filter((selectedItem) => !selectedItem.isFrame)
      : dragItems
    const bounds = getObjectBounds(boundsItems) ?? getObjectBounds(dragItems) ?? undefined
    dragRef.current = {
      id: dragItem.objectId, mode, handle, startX: local.x, startY: local.y,
      x: dragItem.x, y: dragItem.y, width: dragItem.width, height: dragItem.height,
      selectOnClick,
      objectIds: dragItems.map((selectedItem) => selectedItem.objectId),
      snapshots: dragItems.map(({ objectId, x, y, width, height }) => ({ objectId, x, y, width, height })),
      bounds,
    }
  }

  async function importFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        setToast(`${file.name || 'File'}: choose an SVG smaller than 5 MB`)
        continue
      }
      try {
        const sourceName = file.name.trim() || 'Imported file'
        const extension = sourceName.split('.').pop()?.toLowerCase() ?? ''
        const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' }
        const mimeType = file.type.startsWith('image/') ? file.type : imageTypes[extension]
        let asset: Asset
        if (mimeType && mimeType !== 'image/svg+xml' && Object.values(imageTypes).includes(mimeType)) {
          const bitmap = await createImageBitmap(file)
          const width = bitmap.width
          const height = bitmap.height
          bitmap.close()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error ?? new Error('Could not read image file.'))
            reader.readAsDataURL(file)
          })
          const assetName = sourceName.replace(/\.(?:png|jpe?g|webp|gif|avif)$/i, '').trim() || 'Imported photo'
          asset = {
            id: makeId(), name: assetName, category: 'Imported', width, height, viewBox: `0 0 ${width} ${height}`,
            markup: `<image href="${dataUrl}" width="${width}" height="${height}" preserveAspectRatio="none"/>`,
            source: sourceName, imported: true,
          }
        } else {
          const parsed = cleanSvg(await file.text())
          const assetName = sourceName.replace(/\.svg$/i, '').trim() || 'Imported SVG'
          asset = {
            id: makeId(), name: assetName, category: 'Imported',
            width: parsed.width, height: parsed.height, viewBox: parsed.viewBox, markup: parsed.markup,
            source: sourceName, imported: true,
          }
        }
        setCustomAssets((items) => [asset, ...items])
        setSaved(false)
        setToast(`${asset.name} imported`)
      } catch (error) {
        setToast(error instanceof Error ? error.message : 'Could not read this SVG.')
      }
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  function getIconPoint(event: React.PointerEvent<SVGSVGElement>): IconPoint {
    const canvas = iconCanvasRef.current
    if (!canvas) return { x: 64, y: 64 }
    const point = canvas.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const local = point.matrixTransform(canvas.getScreenCTM()?.inverse())
    return { x: Math.max(0, Math.min(128, local.x)), y: Math.max(0, Math.min(128, local.y)) }
  }

  function startIconDrawing(event: React.PointerEvent<SVGSVGElement>) {
    event.preventDefault()
    const start = getIconPoint(event)
    if (iconTool === 'text') {
      if (iconText.trim()) setIconShapes((shapes) => [...shapes, { id: makeId(), kind: 'text', x: start.x, y: start.y, width: 0, height: 28, text: iconText, color: iconColor }])
      return
    }
    iconDrawRef.current = { start, tool: iconTool }
    if (iconTool === 'pen') setIconPoints([start])
    else setIconPreview({ id: 'preview', kind: iconTool === 'rectangle' ? 'rect' : 'ellipse', x: start.x, y: start.y, width: 0, height: 0, color: iconColor })
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveIconDrawing(event: React.PointerEvent<SVGSVGElement>) {
    const draw = iconDrawRef.current
    if (!draw) return
    const point = getIconPoint(event)
    if (draw.tool === 'text') {
      iconDrawRef.current = null
      return
    }
    if (draw.tool === 'pen') {
      setIconPoints((points) => points.length && Math.hypot(point.x - points[points.length - 1].x, point.y - points[points.length - 1].y) >= 1.5 ? [...points, point] : points)
      return
    }
    setIconPreview({
      id: 'preview',
      kind: draw.tool === 'rectangle' ? 'rect' : 'ellipse',
      x: Math.min(draw.start.x, point.x),
      y: Math.min(draw.start.y, point.y),
      width: Math.abs(point.x - draw.start.x),
      height: Math.abs(point.y - draw.start.y),
      color: iconColor,
    })
  }

  function finishIconDrawing(event: React.PointerEvent<SVGSVGElement>) {
    const draw = iconDrawRef.current
    if (!draw) return
    const end = getIconPoint(event)
    if (draw.tool === 'pen') {
      const points = [...iconPoints, end]
      if (points.length > 1) {
        const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
        setIconShapes((shapes) => [...shapes, { id: makeId(), kind: 'path', x: 0, y: 0, width: 128, height: 128, path, color: iconColor }])
      }
      setIconPoints([])
    } else {
      const x = Math.min(draw.start.x, end.x)
      const y = Math.min(draw.start.y, end.y)
      const width = Math.abs(end.x - draw.start.x)
      const height = Math.abs(end.y - draw.start.y)
      if (width >= 3 && height >= 3) setIconShapes((shapes) => [...shapes, {
        id: makeId(), kind: draw.tool === 'rectangle' ? 'rect' : 'ellipse', x, y, width, height, color: iconColor,
      }])
    }
    iconDrawRef.current = null
    setIconPreview(null)
  }

  function saveCustomIcon() {
    if (!iconShapes.length) return
    const safeName = iconName.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.svg$/i, '') || `icon-${customAssets.length + 1}`
    const markup = iconShapes.map((shape) => {
      if (shape.kind === 'path') return `<path d="${shape.path ?? ''}" fill="none" stroke="${shape.color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`
      if (shape.kind === 'ellipse') return `<ellipse cx="${shape.x + shape.width / 2}" cy="${shape.y + shape.height / 2}" rx="${shape.width / 2}" ry="${shape.height / 2}" fill="${shape.color}"/>`
      if (shape.kind === 'text') return `<text x="${shape.x}" y="${shape.y}" fill="${shape.color}" font-family="sans-serif" font-size="${shape.height}">${(shape.text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</text>`
      return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${shape.color}"/>`
    }).join('')
    const id = makeId()
    const asset: Asset = {
      id, name: safeName, category: 'Objects', width: 128, height: 128, viewBox: '0 0 128 128',
      markup, source: `${safeName}.svg`, sourceFileId: id, imported: false,
    }
    setCustomAssets((assets) => [asset, ...assets])
    setSaved(false)
    setShowIconEditor(false)
    setIconShapes([])
    setIconName(`icon-${customAssets.length + 1}`)
    setToast(`${safeName} created`)
  }

  function openIconEditor(tool: IconTool) {
    setIconTool(tool)
    setShowIconEditor(true)
    setLibraryTab('Assets')
    setActiveRailItem('Assets')
  }

  function exportSvg() {
    const visibleObjects = objects.filter((item) => isObjectEffectivelyVisible(objects, item))
    const blob = new Blob([serializeComposition(visibleObjects, transparentBackground, canvasBackground, canvasWidth, canvasHeight)], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const link = window.document.createElement('a')
    link.href = url
    link.download = `${exportName.trim() || 'pixo-composition'}.svg`
    link.click()
    URL.revokeObjectURL(url)
    setShowExport(false)
    setToast('SVG exported')
  }

  function contextAction(action: string) {
    if (contextMenu?.objectId && !selectedIds.includes(contextMenu.objectId)) setSelectedIds([contextMenu.objectId])
    if (action === 'duplicate') duplicateSelected()
    if (action === 'copy') copySelected()
    if (action === 'cut') { copySelected(); deleteSelected() }
    if (action === 'paste') pasteObjects()
    if (action === 'delete') deleteSelected()
    if (action === 'front') { commit([...objectsRef.current.filter((item) => !selectedIds.includes(item.objectId)), ...selected]); }
    if (action === 'back') { commit([...selected, ...objects.filter((item) => !selectedIds.includes(item.objectId))]); }
    if (action === 'flipX' && current) updateSelected({ flipX: !current.flipX })
    if (action === 'flipY' && current) updateSelected({ flipY: !current.flipY })
    if (action === 'saveComponent' && current) {
      setCustomAssets((items) => [{ ...current, id: makeId(), name: `${current.name} component`, category: 'Objects', source: current.source, imported: false, sourceFileId: current.sourceFileId ?? (current.imported ? current.id : undefined) }, ...items])
      setSaved(false)
      setToast('Saved to your library')
    }
    setContextMenu(null)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) {
        if (event.key === 'Escape') (target as HTMLElement).blur()
        return
      }
      const command = event.ctrlKey || event.metaKey
      if (command && event.key.toLowerCase() === 'k') { event.preventDefault(); globalSearchRef.current?.focus(); return }
      if (command && event.key.toLowerCase() === 'i') { event.preventDefault(); fileInput.current?.click(); return }
      if (command && event.key.toLowerCase() === 'e') { event.preventDefault(); setShowExport(true); return }
      if (event.key === 'Escape') { setContextMenu(null); setShowHelp(false); setShowExport(false); setShowSettings(false); setProfileMenuOpen(false); setSelectedIds([]) }
      if (command && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      if (command && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected() }
      if (command && event.key.toLowerCase() === 'g') { event.preventDefault(); if (event.shiftKey) ungroupSelected(); else groupSelected() }
      if (command && event.code === 'BracketRight') { event.preventDefault(); arrangeSelected(event.shiftKey ? 'front' : 'forward') }
      if (command && event.code === 'BracketLeft') { event.preventDefault(); arrangeSelected(event.shiftKey ? 'back' : 'backward') }
      if (command && event.key.toLowerCase() === 'c') copySelected()
      if (command && event.key.toLowerCase() === 'v') pasteObjects()
      if (command && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelectedIds(objects.map((item) => item.objectId)) }
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected()
      if (event.key.startsWith('Arrow') && selected.length) {
        event.preventDefault()
        const distance = event.shiftKey ? 10 : 1
        const patch = event.key === 'ArrowLeft' ? { x: -distance } : event.key === 'ArrowRight' ? { x: distance } : event.key === 'ArrowUp' ? { y: -distance } : { y: distance }
        const movingIds = new Set<string>()
        for (const item of selected) {
          movingIds.add(item.objectId)
          if (item.isFrame) {
            getFrameDescendants(objectsRef.current, item.objectId).forEach((child) => movingIds.add(child.objectId))
          }
        }
        const movableIds = new Set(objectsRef.current
          .filter((item) => movingIds.has(item.objectId) && !isObjectEffectivelyLocked(objectsRef.current, item))
          .map((item) => item.objectId))
        if (!movableIds.size) return
        pushHistory()
        setSaved(false)
        setObjects((items) => {
          const next = fitFrameBounds(items.map((item) => movableIds.has(item.objectId) ? { ...item, x: item.x + (patch.x ?? 0), y: item.y + (patch.y ?? 0) } : item))
          objectsRef.current = next
          return next
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function renderLayerRow(item: CanvasObject, depth: number, hasChildren: boolean) {
    const expanded = hasChildren && !collapsedLayerGroups.includes(item.objectId)
    return <div key={item.objectId} className={`layer-row ${depth ? 'nested' : ''} ${selectedIds.includes(item.objectId) ? 'active' : ''}`} style={{ paddingLeft: `${depth * 12}px` }} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!selectedIds.includes(item.objectId)) setSelectedIds([item.objectId]); setContextMenu({ x: event.clientX, y: event.clientY, objectId: item.objectId }) }}>
      {hasChildren ? <button className="layer-group-toggle" title={expanded ? 'Collapse group' : 'Expand group'} aria-label={expanded ? 'Collapse group' : 'Expand group'} aria-expanded={expanded} onClick={() => setCollapsedLayerGroups((groups) => expanded ? [...groups, item.objectId] : groups.filter((id) => id !== item.objectId))}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button> : <span className="layer-group-spacer" />}
      <button className="visibility-button" title={item.visible ? 'Hide layer' : 'Show layer'} onClick={() => updateObjects((items) => items.map((object) => object.objectId === item.objectId ? { ...object, visible: !object.visible } : object))}>{item.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
      {renamingId === item.objectId ? <input className="layer-rename-input" autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onBlur={() => finishLayerRename(true)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') finishLayerRename(true); if (event.key === 'Escape') finishLayerRename(false) }} /> : <button className="layer-name" title="Double-click to rename" onClick={(event) => setSelectedIds(event.shiftKey ? [...new Set([...selectedIds, item.objectId])] : [item.objectId])} onDoubleClick={() => handleLayerRename(item)}><span className="layer-symbol" title={`${item.category} object`}>{item.isFrame ? <FolderOpen size={14} /> : <ObjectTypeIcon item={item} />}</span>{item.name}</button>}
      <button className={`visibility-button ${item.locked ? 'is-locked' : ''}`} title={item.locked ? 'Unlock layer' : 'Lock layer'} onClick={() => updateObjects((items) => items.map((object) => object.objectId === item.objectId ? { ...object, locked: !object.locked } : object))}><LockKeyhole size={12} /></button>
      <button className="visibility-button" title="Move layer forward" onClick={() => { setSelectedIds([item.objectId]); const index = objects.findIndex((object) => object.objectId === item.objectId); if (index < objects.length - 1) { const next = [...objects]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; commit(next) } }}><ArrowUp size={12} /></button>
      <button className="visibility-button" title="Move layer backward" onClick={() => { setSelectedIds([item.objectId]); const index = objects.findIndex((object) => object.objectId === item.objectId); if (index > 0) { const next = [...objects]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; commit(next) } }}><ArrowDown size={12} /></button>
    </div>
  }

  const viewBox = `${canvasCenter.x - canvasWidth / (2 * zoom)} ${canvasCenter.y - canvasHeight / (2 * zoom)} ${canvasWidth / zoom} ${canvasHeight / zoom}`

  return (
    <main ref={appShellRef} className={`app-shell theme-${resolvedTheme} ${showLanding ? 'is-landing' : ''}`} onDragEnter={(event) => { if (event.dataTransfer.types.includes('Files')) setFileDragActive(true) }} onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) setFileDragActive(true) }} onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFileDragActive(false) }} onDrop={(event) => { event.preventDefault(); setFileDragActive(false); if (event.dataTransfer.files.length) void importFiles(event.dataTransfer.files) }}>
      {fileDragActive && <div className="file-drop-overlay" role="status"><div><Download size={22} /><b>Drop files to import</b></div></div>}
      <input ref={fileInput} className="visually-hidden" type="file" accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp,image/gif,image/avif" multiple onChange={(event) => { if (event.target.files) void importFiles(event.target.files) }} />
      {!showLanding && <header className="topbar">
        <button className="brand" aria-label="Pixo home" onClick={() => { persistActiveProject(); setActiveNav('Projects'); setShowProjects(false); setShowLanding(true) }}><span className="brand-mark"><i /><i /><i /></span><span>Pixo</span></button>
        <div className="top-divider" />
        <button className="top-project-switcher" aria-label={language === 'ru' ? 'Показать мои проекты' : 'Show my projects'} onClick={() => { persistActiveProject(); setActiveNav('Projects'); setShowLanding(false); setShowProjects(true) }}><FileImage size={15} /><span>{projectName}</span><ChevronDown size={13} /></button>
        <nav className="global-nav" aria-label="Workspace">
          {[
            { name: 'Projects', icon: FolderOpen },
            { name: 'Components', icon: Shapes },
            { name: 'Assets', icon: FileImage },
          ].map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${activeNav === name ? 'active' : ''}`} onClick={() => { setActiveNav(name); setShowLanding(false); if (name === 'Projects') { persistActiveProject(); setShowProjects(true) } else { setShowProjects(false); if (name === 'Components') setLibraryTab('Library'); if (name === 'Assets') setLibraryTab('Assets') } }}><Icon size={14} />{name}</button>)}
        </nav>
        <label className="global-search"><Search size={14} /><input ref={globalSearchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects, components..." /></label>
        <div className="header-actions">
          <div className="history-actions">
            <button className="icon-button" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}><Undo2 size={15} /></button>
            <button className="icon-button" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}><Redo2 size={15} /></button>
          </div>
          <span className={`save-state ${saved ? 'is-saved' : ''}`}><i />{saved ? 'Saved' : 'Saving'}</span>
          <button className="button button-subtle" onClick={() => fileInput.current?.click()}><Download size={14} />Import</button>
          <button className="button button-primary" onClick={() => setShowExport(true)}><Upload size={14} />Export SVG</button>
          <div className="account-area" ref={accountMenuRef}>
            <button className="profile-trigger" title="Account menu" aria-label="Open account menu" aria-haspopup="menu" aria-expanded={profileMenuOpen} onClick={() => setProfileMenuOpen((open) => !open)}><span className="avatar">{profileName.trim().charAt(0).toUpperCase() || 'M'}</span><ChevronDown size={13} /></button>
            {profileMenuOpen && <div className="account-menu" role="menu"><div className="account-menu-heading"><strong>{profileName || 'Guest'}</strong><span>Local profile</span></div><button className="account-menu-action" role="menuitem" onClick={() => { setProfileMenuOpen(false); setShowSettings(true) }}><Settings2 size={14} />Settings</button><button className="account-menu-action signout-action" role="menuitem" onClick={() => { setProfileMenuOpen(false); setProfileName('Guest'); setToast('Signed out. Project remains saved locally.') }}><LogOut size={14} />Sign out</button><p className="account-note">Projects stay saved on this device.</p></div>}
          </div>
        </div>
      </header>}

      {showLanding ? <section className="landing-frame-shell"><iframe ref={landingFrameRef} title="Pixo — главная страница" src="/pixo-landing.html?v=motion-v4-mobile" onLoad={() => landingFrameRef.current?.contentWindow?.postMessage({ type: 'pixo:theme', theme: resolvedTheme }, window.location.origin)} /></section> : showProjects ? <section className="projects-page">
        <div className="projects-page-header">
          <div><span className="eyebrow">Pixo workspace</span><h1>{language === 'ru' ? 'Мои проекты' : 'My projects'}</h1><p>{language === 'ru' ? `Проектов: ${projects.length}` : `${projects.length} saved projects`}</p></div>
          <button className="button button-primary" onClick={createProject}><Plus size={15} />{language === 'ru' ? 'Новый проект' : 'New project'}</button>
        </div>
        <div className="projects-toolbar"><span>{language === 'ru' ? 'Недавно открытые' : 'Recent projects'}</span><span>{filteredProjects.length} {language === 'ru' ? 'проектов' : 'projects'}</span></div>
        {filteredProjects.length ? <div className="project-grid">{filteredProjects.map((project) => <article className="project-card" key={project.id}>
          <button className="project-open" title={language === 'ru' ? 'Открыть проект' : 'Open project'} onClick={() => openProject(project)}>
            <ProjectCanvasPreview project={project} language={language} />
            <span className="project-card-info"><strong>{project.name}</strong><small>{new Date(project.updatedAt || project.createdAt).toLocaleDateString(language === 'ru' ? 'ru-RU' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</small></span>
          </button>
          <div className="project-card-actions"><button title={language === 'ru' ? 'Скачать проект' : 'Download project JSON'} aria-label={language === 'ru' ? `Скачать проект ${project.name}` : `Download project ${project.name}`} onClick={() => exportProject(project)}><DownloadIcon /></button><button title={language === 'ru' ? 'Удалить проект' : 'Delete project'} aria-label={language === 'ru' ? `Удалить проект ${project.name}` : `Delete project ${project.name}`} onClick={() => deleteProject(project)}><Trash2 size={14} /></button></div>
        </article>)}</div> : <div className="projects-empty"><FolderOpen size={25} /><strong>{search ? (language === 'ru' ? 'Ничего не найдено' : 'No projects found') : (language === 'ru' ? 'Пока нет проектов' : 'No projects yet')}</strong><span>{search ? (language === 'ru' ? 'Измени запрос и попробуй ещё раз.' : 'Try another search.') : (language === 'ru' ? 'Создай проект, чтобы начать работу.' : 'Create a project to get started.')}</span>{!search && <button className="button button-primary" onClick={createProject}><Plus size={15} />{language === 'ru' ? 'Создать проект' : 'Create project'}</button>}</div>}
      </section> : <div className="editor-layout" style={{ '--library-width': libraryCollapsed ? '0px' : `${libraryWidth}px`, '--inspector-width': inspectorCollapsed ? '0px' : `${inspectorWidth}px` } as React.CSSProperties}>
        <aside className="tool-rail" aria-label="Tools">
          <button title="Library" aria-label="Library" aria-pressed={activeRailItem === 'Library'} className={`tool-button ${activeRailItem === 'Library' ? 'selected' : ''}`} onClick={() => { setShowProjects(false); setLibraryTab('Library'); setActiveNav('Components'); setActiveRailItem('Library'); setMobilePanel('library') }}><Shapes size={17} /></button>
          <button title="Rectangle" aria-label="Rectangle" aria-pressed={activeTool === 'Rectangle'} className={`tool-button ${activeTool === 'Rectangle' ? 'selected' : ''}`} onClick={() => setActiveTool('Rectangle')}><Square size={17} /></button>
          <button title="Ellipse" aria-label="Ellipse" aria-pressed={activeTool === 'Ellipse'} className={`tool-button ${activeTool === 'Ellipse' ? 'selected' : ''}`} onClick={() => setActiveTool('Ellipse')}><Circle size={17} /></button>
          <button title="Pen" aria-label="Pen" aria-pressed={activeTool === 'Pen'} className={`tool-button ${activeTool === 'Pen' ? 'selected' : ''}`} onClick={() => setActiveTool('Pen')}><Pencil size={17} /></button>
          <button title="Text" aria-label="Text" aria-pressed={activeTool === 'Text'} className={`tool-button ${activeTool === 'Text' ? 'selected' : ''}`} onClick={() => setActiveTool('Text')}><Type size={17} /></button>
          <button title="Layers" aria-label="Layers" aria-pressed={activeRailItem === 'Layers'} className={`tool-button ${activeRailItem === 'Layers' ? 'selected' : ''}`} onClick={() => { setInspectorTab('Layers'); setActiveTool('Layers'); setActiveRailItem('Layers'); setMobilePanel('inspector') }}><Layers size={17} /></button>
          <button title="Files" aria-label="Files" aria-pressed={activeRailItem === 'Files'} className={`tool-button ${activeRailItem === 'Files' ? 'selected' : ''}`} onClick={() => { setShowProjects(false); setLibraryTab('Files'); setActiveRailItem('Files'); setMobilePanel('library') }}><FileImage size={17} /></button>
          <button title="Assets" aria-label="Assets" aria-pressed={activeRailItem === 'Assets'} className={`tool-button ${activeRailItem === 'Assets' ? 'selected' : ''}`} onClick={() => { setShowProjects(false); setLibraryTab('Assets'); setActiveNav('Assets'); setActiveRailItem('Assets'); setMobilePanel('library') }}><Grid2X2 size={17} /></button>
          <div className="rail-spacer" />
          <button className="tool-button" title="Help" aria-label="Help" onClick={() => setShowHelp(true)}><CircleHelp size={17} /></button>
          <button className="tool-button" title="Settings" aria-label="Settings" onClick={() => setShowSettings(true)}><Settings2 size={17} /></button>
        </aside>

        <aside className={`library-panel panel ${libraryCollapsed ? 'is-collapsed' : ''} ${mobilePanel === 'library' ? 'mobile-open' : ''}`} style={{ '--imported-files-height': `${importedFilesHeight}px` } as React.CSSProperties}>
          <div className="panel-tabs">
            {['Library', 'Files', 'Assets'].map((tab) => <button key={tab} className={libraryTab === tab ? 'active' : ''} onClick={() => setLibraryTab(tab)}>{tab}</button>)}
          </div>
          {libraryTab === 'Library' ? <>
            <div className="panel-search"><Search size={14} /><input placeholder="Search components..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <div className="category-row">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
            <div className="library-section-header"><div className="asset-sort-control" ref={assetSortControlRef} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setAssetSortMenuOpen(false) } }}><button type="button" className="asset-sort-button" aria-label={language === 'ru' ? 'Сортировка компонентов' : 'Sort components'} aria-haspopup="listbox" aria-expanded={assetSortMenuOpen} onClick={() => setAssetSortMenuOpen((open) => !open)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setAssetSortMenuOpen(true); requestAnimationFrame(() => assetSortControlRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()) } }}><span>{assetSort === 'name' ? (language === 'ru' ? 'Имя А–Я' : 'Name A–Z') : (language === 'ru' ? 'Тип' : 'Type')}</span><ChevronDown size={13} /></button>{assetSortMenuOpen && <div className="asset-sort-options" role="listbox" aria-label={language === 'ru' ? 'Сортировка компонентов' : 'Sort components'}>{([{ value: 'name', label: language === 'ru' ? 'Имя А–Я' : 'Name A–Z' }, { value: 'type', label: language === 'ru' ? 'Тип' : 'Type' }] as const).map((option) => <button type="button" role="option" aria-selected={assetSort === option.value} key={option.value} className={`asset-sort-option ${assetSort === option.value ? 'selected' : ''}`} onClick={() => { setAssetSort(option.value); setAssetSortMenuOpen(false); requestAnimationFrame(() => assetSortControlRef.current?.querySelector<HTMLButtonElement>('.asset-sort-button')?.focus()) }} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); const options = Array.from(assetSortControlRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []); const direction = event.key === 'ArrowDown' ? 1 : -1; options[(options.indexOf(event.currentTarget) + direction + options.length) % options.length]?.focus() } }}>{option.label}{assetSort === option.value && <Check size={14} />}</button>)}</div>}</div></div>
            <div className="asset-grid">
              {sortedAssets.map((asset) => <button className="asset-card" key={asset.id} onClick={() => addAsset(asset)} title={`Add ${asset.name} to canvas`}>
                <span className="asset-art"><svg viewBox={asset.viewBox} aria-hidden="true" dangerouslySetInnerHTML={{ __html: namespaceSvgIds(asset.markup, asset.id) }} /></span>
                <span className="asset-meta"><span className="asset-name">{asset.name}</span></span>
                <span className="asset-kind">{asset.category}</span>
              </button>)}
              {sortedAssets.length === 0 && <div className="library-empty"><Shapes size={20} /><strong>No components yet</strong><button onClick={() => { setLibraryTab('Files'); fileInput.current?.click() }}>Import SVG source</button></div>}
            </div>
            <div className="imported-files-resizer" role="separator" aria-label="Resize imported files height" aria-orientation="horizontal" tabIndex={0} onPointerDown={startImportedFilesResize} onKeyDown={resizeImportedFilesByKeyboard} />
            <section className="imported-files-area">
              <div className="section-heading"><span>Imported files</span><button onClick={() => setLibraryTab('Files')}>View all</button></div>
              <div className="imported-list">
            {importedFiles.map((asset) => <div className="source-file-entry" key={asset.id}><button className="file-row" title="Add the whole source as one object" onClick={() => addAsset(asset)}><span className="file-thumb"><svg viewBox={assetThumbnail(asset).viewBox} dangerouslySetInnerHTML={{ __html: assetThumbnail(asset).markup }} /></span><span className="file-info"><b>{asset.source}</b><small>{getAssetFileType(asset.source)} · {Math.round(asset.width)} × {Math.round(asset.height)}</small></span><ArrowRight size={13} /></button><button className={`inspect-source-button ${expandedSourceId === asset.id ? 'active' : ''}`} title="Inspect SVG structure" aria-label={`Inspect ${asset.source}`} onClick={() => setExpandedSourceId((id) => id === asset.id ? null : asset.id)}><Layers size={13} /></button>{expandedSourceId === asset.id && <div className="svg-tree-panel"><div className="svg-tree-heading"><span>SVG structure</span><small>{translateRussian(`${expandedNodes.length} elements`, language)}</small></div>{expandedNodes.length ? expandedNodes.map(({ node, depth }) => <div className="svg-tree-row" key={node.path.join('-')} style={{ paddingLeft: `${7 + depth * 12}px` }}><span className="svg-tree-node"><code>{node.tag}</code><span>{node.label}</span></span><button title={`Extract ${node.label}`} aria-label={`Extract ${node.label}`} onClick={() => extractComponent(asset, node)}>Extract</button></div>) : <p className="svg-tree-empty">No extractable SVG elements found.</p>}</div>}</div>)}
                {customAssets.length === 0 && <button className="file-row sample-file" onClick={() => fileInput.current?.click()}><span className="file-thumb sample-thumb"><Sparkles size={19} /></span><span className="file-info"><b>Import your first SVG</b><small>Drop a file or browse</small></span><Plus size={13} /></button>}
              </div>
            </section>
          </> : <div className="files-view">
            <div className="section-heading"><span>{libraryTab === 'Files' ? 'Source files' : 'Project assets'}</span><button title={libraryTab === 'Assets' ? 'Create SVG icon' : 'Import SVG'} aria-label={libraryTab === 'Assets' ? 'Create SVG icon' : 'Import SVG'} onClick={() => libraryTab === 'Assets' ? openIconEditor('rectangle') : fileInput.current?.click()}>{libraryTab === 'Assets' ? <Pencil size={13} /> : <Plus size={13} />}</button></div>
            <button className="import-drop" onClick={() => fileInput.current?.click()}><Download size={18} /><b>Import files</b><span>SVG or photo · Up to 5 MB</span></button>
            {(libraryTab === 'Files' ? importedFiles : customAssets).map((asset) => <button className="file-row" key={asset.id} title="Add the whole source as one object" onClick={() => addAsset(asset)}><span className="file-thumb"><svg viewBox={assetThumbnail(asset).viewBox} dangerouslySetInnerHTML={{ __html: assetThumbnail(asset).markup }} /></span><span className="file-info"><b>{asset.source}</b><small>{asset.category} · {getAssetFileType(asset.source)}</small></span><ArrowRight size={13} /></button>)}
            {(libraryTab === 'Files' ? importedFiles : customAssets).length === 0 && <p className="empty-note">Your imported SVGs will appear here.</p>}
          </div>}
          <button className="library-collapse" title="Collapse library" aria-label="Collapse library" onClick={() => setLibraryCollapsed(true)}><ChevronRight size={13} /></button>
        </aside>

        <div className={`panel-resizer library-resizer ${libraryCollapsed ? 'is-collapsed' : ''}`} role="separator" aria-label="Resize library panel" aria-orientation="vertical" aria-valuenow={libraryWidth} aria-valuemin={190} aria-valuemax={420} tabIndex={libraryCollapsed ? -1 : 0} onPointerDown={(event) => startPanelResize(event, 'library')} onKeyDown={(event) => resizeFromKeyboard('library', event)}>
          {libraryCollapsed && <button className="restore-panel" title="Show library" aria-label="Show library" onClick={() => setLibraryCollapsed(false)}><ChevronRight size={14} /></button>}
        </div>

        <section className="workspace panel" aria-label="Composition canvas" onContextMenu={(event) => { if (event.target === event.currentTarget || event.target === canvasRef.current) { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }) } }}>
          <div className="canvas-toolbar">
            <button className="canvas-mode" title="Select" onClick={() => setActiveTool('Select')}><MousePointer2 size={15} /></button>
            <button className="project-title" onClick={() => setEditingName(true)}>{editingName ? <input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} onBlur={() => setEditingName(false)} onKeyDown={(event) => { if (event.key === 'Enter') setEditingName(false) }} /> : <>{projectName}<ChevronDown size={12} /></>}</button>
            <div className="toolbar-divider" />
            <button className={`canvas-action ${activeTool === 'Select' ? 'tool-active' : ''}`} title="Select" onClick={() => setActiveTool('Select')}><MousePointer2 size={14} /></button>
            <button className={`canvas-action ${activeTool === 'Pan' ? 'tool-active' : ''}`} title="Pan" onClick={() => activateTool('Pan')}><Move size={14} /></button>
            <ColorPicker compact label="Drawing color" value={iconColor} onChangeStart={() => undefined} onChange={(color) => setIconColor(colorToHex(parseColor(color)))} onChangeEnd={() => undefined} />
            <button className="canvas-action" title="Frame selection" onClick={() => { setZoom(1); setCanvasCenter({ x: canvasWidth / 2, y: canvasHeight / 2 }); setToast('Canvas fitted to view') }}><Maximize2 size={14} /></button>
            <div className="toolbar-spacer" />
            <button className="canvas-action" title="Canvas settings" onClick={() => setInspectorTab('Inspector')}><Settings2 size={15} /></button>
          </div>
              <div className="canvas-stage" style={{ '--canvas-background': canvasBackground, '--canvas-grid-image': 'none' } as React.CSSProperties}>
            <svg ref={canvasRef} className={`composition-svg ${activeTool === 'Pan' ? 'pan-mode' : ''} ${isPanning ? 'pan-dragging' : ''} ${activeTool === 'Select' ? '' : 'frame-mode'}`} viewBox={viewBox} onWheel={handleCanvasWheel} onPointerDown={handleCanvasPointerDown} onPointerMove={moveCanvasTool} onPointerUp={finishCanvasTool} onPointerCancel={finishCanvasTool} onClick={handleCanvasClick} onContextMenu={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }) } }}>
              {objects.filter((item) => isObjectEffectivelyVisible(objects, item)).map((item) => <g key={item.objectId} transform={`translate(${item.x + item.width / 2} ${item.y + item.height / 2}) rotate(${item.rotation}) scale(${item.flipX ? -1 : 1} ${item.flipY ? -1 : 1}) translate(${-item.width / 2} ${-item.height / 2})`} onPointerDown={(event) => startDrag(event, item)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); if (!selectedIds.includes(item.objectId)) setSelectedIds([item.objectId]); setContextMenu({ x: event.clientX, y: event.clientY, objectId: item.objectId }) }} className={`canvas-object ${isObjectEffectivelyLocked(objects, item) ? 'locked' : ''}`} opacity={item.opacity}>
                <rect x={0} y={0} width={item.width} height={item.height} fill="transparent" stroke="transparent" strokeWidth={6} vectorEffect="non-scaling-stroke" pointerEvents="all" />
                <CanvasObjectArtwork item={item} />
                {selected.length === 1 && selectedIds.includes(item.objectId) && !item.isFrame && <g className="selection-box" pointerEvents="none"><rect x={0} y={0} width={item.width} height={item.height} fill="none" stroke="#8f78ff" strokeWidth={2} vectorEffect="non-scaling-stroke" />{[[0, 0, 'nw'], [item.width, 0, 'ne'], [0, item.height, 'sw'], [item.width, item.height, 'se']].map(([x, y, handle]) => <rect key={String(handle)} className={`resize-handle handle-${handle}`} x={Number(x) - 4} y={Number(y) - 4} width={8} height={8} rx={1} fill="#fff" stroke="#8f78ff" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="all" onPointerDown={(event) => startDrag(event, item, 'resize', String(handle))} />)}</g>}
              </g>)}
              {canvasDrawing?.kind === 'rect' && <rect className="frame-preview" x={Math.min(canvasDrawing.start.x, canvasDrawing.current.x)} y={Math.min(canvasDrawing.start.y, canvasDrawing.current.y)} width={Math.abs(canvasDrawing.current.x - canvasDrawing.start.x)} height={Math.abs(canvasDrawing.current.y - canvasDrawing.start.y)} />}
              {canvasDrawing?.kind === 'ellipse' && <ellipse className="frame-preview" cx={(canvasDrawing.start.x + canvasDrawing.current.x) / 2} cy={(canvasDrawing.start.y + canvasDrawing.current.y) / 2} rx={Math.abs(canvasDrawing.current.x - canvasDrawing.start.x) / 2} ry={Math.abs(canvasDrawing.current.y - canvasDrawing.start.y) / 2} />}
              {canvasDrawing?.kind === 'path' && canvasDrawing.points.length > 1 && <path d={canvasDrawing.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} fill="none" stroke={iconColor} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
              {canvasTextDraft && <><text x={canvasTextDraft.x} y={canvasTextDraft.y} fill={iconColor} fontFamily={canvasTextFontFamily} fontSize={canvasTextFontSize} fontWeight="600" pointerEvents="none">{canvasTextDraft.value}</text><rect x={canvasTextDraft.x + canvasTextDraftWidth - 10} y={canvasTextDraft.y - canvasTextFontSize} width="1.5" height={canvasTextFontSize * 1.06} fill={iconColor} pointerEvents="none" /><foreignObject x={canvasTextDraft.x} y={canvasTextDraft.y - canvasTextFontSize - 4} width={canvasTextDraftWidth} height={Math.max(38, canvasTextFontSize * 1.35)}><input className="canvas-text-editor" autoFocus style={{ caretColor: 'transparent', fontSize: canvasTextFontSize, fontFamily: canvasTextFontFamily }} value={canvasTextDraft.value} onPointerDown={(event) => event.stopPropagation()} onChange={(event) => setCanvasTextDraft((draft) => draft ? { ...draft, value: event.target.value } : null)} onBlur={commitCanvasText} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } if (event.key === 'Escape') { setCanvasTextDraft(null); setActiveTool('Select') } }} /></foreignObject></>}
            </svg>
            {(selected.length > 1 || selected.some((item) => item.isFrame) || selectionRect) && <svg className="selection-overlay" viewBox={viewBox}>
              {(selected.length > 1 || selected.some((item) => item.isFrame)) && selectedBounds && <g className="selection-box">
                <rect x={selectedBounds.x} y={selectedBounds.y} width={selectedBounds.width} height={selectedBounds.height} fill="none" stroke="#8f78ff" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                {[[selectedBounds.x, selectedBounds.y, 'nw'], [selectedBounds.x + selectedBounds.width, selectedBounds.y, 'ne'], [selectedBounds.x, selectedBounds.y + selectedBounds.height, 'sw'], [selectedBounds.x + selectedBounds.width, selectedBounds.y + selectedBounds.height, 'se']].map(([x, y, handle]) => <rect key={String(handle)} className={`resize-handle handle-${handle}`} x={Number(x) - 4} y={Number(y) - 4} width={8} height={8} rx={1} fill="#fff" stroke="#8f78ff" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="all" onPointerDown={(event) => { if (selected[0]) startDrag(event, selected[0], 'resize', String(handle)) }} />)}
              </g>}
              {selectionRect && <rect className="frame-preview" x={selectionRect.x} y={selectionRect.y} width={selectionRect.width} height={selectionRect.height} pointerEvents="none" />}
            </svg>}
            <div className="canvas-status"><span><i />{translateRussian(selected.length ? `${selected.length} selected` : 'Ready', language)}</span><span>{translateRussian(`${objects.length} objects`, language)}</span><span>{translateRussian(`${new Set(objects.map((item) => item.sourceFileId ?? item.id)).size} source illustrations`, language)}</span><span>x: {Math.round(current?.x ?? canvasWidth / 2)} &nbsp; y: {Math.round(current?.y ?? canvasHeight / 2)}</span></div>
            <div className="zoom-controls"><button title="Zoom out" onClick={() => setZoom((value) => Math.max(.55, +(value - .1).toFixed(2)))}><ZoomOut size={14} /></button><span>{Math.round(zoom * 100)}%</span><button title="Zoom in" onClick={() => setZoom((value) => Math.min(1.8, +(value + .1).toFixed(2)))}><ZoomIn size={14} /></button><span className="zoom-divider" /><button title="Fit canvas" onClick={() => setZoom(1)}><Maximize2 size={13} /></button></div>
          </div>
        </section>

        <div className={`panel-resizer inspector-resizer ${inspectorCollapsed ? 'is-collapsed' : ''}`} role="separator" aria-label="Resize inspector panel" aria-orientation="vertical" aria-valuenow={inspectorWidth} aria-valuemin={210} aria-valuemax={420} tabIndex={inspectorCollapsed ? -1 : 0} onPointerDown={(event) => startPanelResize(event, 'inspector')} onKeyDown={(event) => resizeFromKeyboard('inspector', event)}>
          {inspectorCollapsed && <button className="restore-panel" title="Show inspector" aria-label="Show inspector" onClick={() => setInspectorCollapsed(false)}><ChevronLeft size={14} /></button>}
        </div>

        <aside className={`inspector-panel panel ${inspectorCollapsed ? 'is-collapsed' : ''} ${mobilePanel === 'inspector' ? 'mobile-open' : ''}`}>
          <div className="panel-tabs inspector-tabs"><button className={inspectorTab === 'Inspector' ? 'active' : ''} onClick={() => setInspectorTab('Inspector')}>Properties</button><button className={inspectorTab === 'Layers' ? 'active' : ''} onClick={() => setInspectorTab('Layers')}>Layers</button><button className="panel-collapse" title="Collapse properties" aria-label="Collapse properties" onClick={() => setInspectorCollapsed(true)}><ChevronRight size={13} /></button></div>
          {inspectorTab === 'Inspector' ? <div className="inspector-content">
            <InspectorSection title="Document"><ChevronRight size={13} /><div className="field-grid"><NumericField label="W" value={canvasWidth} onChange={(value) => updateCanvasDimension('width', value)} /><NumericField label="H" value={canvasHeight} onChange={(value) => updateCanvasDimension('height', value)} /></div><ColorPicker label="Background" value={canvasBackground} onChangeStart={() => undefined} onChange={(color) => { setCanvasBackground(colorToHex(parseColor(color))); setSaved(false) }} onChangeEnd={() => undefined} /></InspectorSection>
            {current ? <>
              <InspectorSection title="Transform"><ChevronRight size={13} />
                <div className="transform-align-row"><button title="Align left" onClick={() => alignSelected('left')}>↤</button><button title="Align horizontal center" onClick={() => alignSelected('center')}>↔</button><button title="Align right" onClick={() => alignSelected('right')}>↦</button><button title="Align top" onClick={() => alignSelected('top')}>↥</button><button title="Align vertical center" onClick={() => alignSelected('middle')}>↕</button><button title="Align bottom" onClick={() => alignSelected('bottom')}>↧</button></div>
                <div className="field-grid"><NumericField label="X" value={current.x} onChange={(value) => updateSelected({ x: value })} /><NumericField label="Y" value={current.y} onChange={(value) => updateSelected({ y: value })} /><NumericField label="W" value={current.width} onChange={(value) => updateSelectedDimension('width', value)} /><NumericField label="H" value={current.height} onChange={(value) => updateSelectedDimension('height', value)} /></div>
                <div className="transform-actions"><span className="rotation-icon">↻</span><NumericField label="" value={current.rotation} suffix="°" onChange={(value) => updateSelected({ rotation: value })} /><button title="Flip horizontally" onClick={() => updateSelected({ flipX: !current.flipX })}><FlipVertical2 size={14} /></button><button title="Flip vertically" onClick={() => updateSelected({ flipY: !current.flipY })}><FlipHorizontal2 size={14} /></button><button className={current.proportionsLocked ? 'active' : ''} title={current.proportionsLocked ? 'Unlock proportions' : 'Lock proportions'} aria-label="Lock proportions" aria-pressed={Boolean(current.proportionsLocked)} onClick={() => updateSelected({ proportionsLocked: !current.proportionsLocked })}><LockKeyhole size={13} /></button></div>
              </InspectorSection>
              <InspectorSection title="Appearance"><ChevronRight size={13} />
                <label className="opacity-label"><span>Opacity</span><span>{Math.round(current.opacity * 100)}%</span></label><input className="opacity-slider" type="range" min="0" max="1" step="0.01" value={current.opacity} onChange={(event) => updateObjects((items) => items.map((item) => item.objectId === current.objectId ? { ...item, opacity: Number(event.target.value) } : item))} />
                <ColorPicker label="Fill" value={getSvgPaint(current.markup, 'fill')} onChangeStart={beginColorEdit} onChange={(color) => updateSelectedPaint('fill', color)} onChangeEnd={finishColorEdit} />
                <ColorPicker label="Stroke" value={getSvgPaint(current.markup, 'stroke')} onChangeStart={beginColorEdit} onChange={(color) => updateSelectedPaint('stroke', color)} onChangeEnd={finishColorEdit} />
              </InspectorSection>
              {current.category === 'Text' && <InspectorSection title="Text"><ChevronRight size={13} /><TextControls fontFamily={current.fontFamily ?? 'sans-serif'} fontSize={current.fontSize ?? Number(current.markup.match(/font-size="([\d.]+)/)?.[1] ?? 42)} onFontFamily={(fontFamily) => updateTextStyle({ fontFamily })} onFontSize={(fontSize) => updateTextStyle({ fontSize })} /></InspectorSection>}
              <InspectorSection title="Object"><ChevronRight size={13} />
                <label className="inspector-field"><span>Name</span><input value={current.name} onChange={(event) => updateObjects((items) => items.map((item) => item.objectId === current.objectId ? { ...item, name: event.target.value } : item))} /></label>
                <label className="inspector-field"><span>Type</span><input value={getAssetFileType(current.source) === 'Image' ? 'Image' : 'SVG group'} readOnly /></label>
                <label className="inspector-field"><span>Source</span><input value={current.source} readOnly /></label>
                <div className="object-actions">{current.isFrame && objects.some((item) => item.frameId === current.objectId) ? <button onClick={ungroupSelected}><Layers size={13} />Ungroup</button> : !current.isFrame && (current.imported || current.sourceFileId) ? <button onClick={separateSelectedSvg}><Layers size={13} />Separate into group</button> : null}<button onClick={duplicateSelected}><Copy size={13} />Duplicate</button><button className="delete-action" onClick={deleteSelected}><Trash2 size={13} />Delete</button></div>
              </InspectorSection>
            </> : canvasTextDraft ? <InspectorSection title="Text"><ChevronRight size={13} /><TextControls fontFamily={canvasTextFontFamily} fontSize={canvasTextFontSize} onFontFamily={setCanvasTextFontFamily} onFontSize={setCanvasTextFontSize} /></InspectorSection> : <>
              {selected.length > 1 && <InspectorSection title="Transform"><ChevronRight size={13} />
                <div className="transform-align-row"><button title="Align left" onClick={() => alignSelected('left')}>↤</button><button title="Align horizontal center" onClick={() => alignSelected('center')}>↔</button><button title="Align right" onClick={() => alignSelected('right')}>↦</button><button title="Align top" onClick={() => alignSelected('top')}>↥</button><button title="Align vertical center" onClick={() => alignSelected('middle')}>↕</button><button title="Align bottom" onClick={() => alignSelected('bottom')}>↧</button></div>
              </InspectorSection>}
              <div className="empty-inspector">{selected.length > 1 ? <span>{translateRussian(`${selected.length} selected`, language)}</span> : <><MousePointer2 size={19} /><span>Select an object to inspect its properties.</span></>}</div>
            </>}
            <InspectorSection title="Canvas"><ChevronRight size={13} /><label className="inspector-field"><span>Zoom</span><input value={`${Math.round(zoom * 100)}%`} readOnly /></label><button className="canvas-option" aria-pressed={snapToGrid} onClick={toggleSnapToGrid}><span>Snap to grid</span><span className={`toggle ${snapToGrid ? 'is-on' : ''}`}><i /></span></button></InspectorSection>
          </div> : <div className="layer-list-panel">
            <div className="layers-toolbar"><span>{translateRussian(`${objects.length} layers`, language)}</span><div><button title="Group selection" aria-label="Group selection" disabled={!canGroupSelection} onClick={groupSelected}><Layers size={13} /></button><button title="Ungroup selection" aria-label="Ungroup selection" disabled={!canUngroupSelection} onClick={ungroupSelected}><FolderOpen size={13} /></button>{selected.length > 2 && <><button title="Distribute horizontally" onClick={() => distributeSelected('horizontal')}>↔</button><button title="Distribute vertically" onClick={() => distributeSelected('vertical')}>↕</button></>}<button title="Bring selection to front" onClick={() => arrangeSelected('front')}>⇥</button><button title="Send selection to back" onClick={() => arrangeSelected('back')}>⇤</button></div></div>
            <div className="panel-search"><Search size={13} /><input placeholder="Search layers..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            {layerRows.map(({ item, depth, hasChildren }) => renderLayerRow(item, depth, hasChildren))}
            {assets.length > 0 && <button className="add-layer" onClick={() => { setInspectorTab('Inspector'); setLibraryTab('Library') }}><Plus size={14} />Browse components</button>}
          </div>}
          <div className="inspector-footer"><span>Local project</span><span className="save-state"><i />{saved ? 'Synced' : 'Saving'}</span></div>
        </aside>
        {mobilePanel && <button className="mobile-panel-backdrop" aria-label={language === 'ru' ? 'Закрыть панель' : 'Close panel'} onClick={() => setMobilePanel(null)} />}
        <nav className="mobile-panel-tabs" aria-label={language === 'ru' ? 'Панели редактора' : 'Editor panels'}>
          <button className={mobilePanel === 'library' ? 'active' : ''} aria-pressed={mobilePanel === 'library'} onClick={() => { setLibraryTab('Library'); setActiveRailItem('Library'); setMobilePanel((panel) => panel === 'library' ? null : 'library') }}><Shapes size={15} />{language === 'ru' ? 'Библиотека' : 'Library'}</button>
          <button className={!mobilePanel ? 'active' : ''} aria-pressed={!mobilePanel} onClick={() => setMobilePanel(null)}><MousePointer2 size={15} />{language === 'ru' ? 'Холст' : 'Canvas'}</button>
          <button className={mobilePanel === 'inspector' ? 'active' : ''} aria-pressed={mobilePanel === 'inspector'} onClick={() => { setInspectorTab('Inspector'); setMobilePanel((panel) => panel === 'inspector' ? null : 'inspector') }}><Settings2 size={15} />{language === 'ru' ? 'Свойства' : 'Properties'}</button>
        </nav>
      </div>}

      {contextMenu && <><button className="menu-dismiss" aria-label="Close context menu" onClick={() => setContextMenu(null)} /><div className="context-menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 236), top: Math.min(contextMenu.y, window.innerHeight - 475) }}>
        <ContextAction icon={<MousePointer2 size={14} />} label="Select" shortcut="V" onClick={() => { if (contextMenu.objectId) setSelectedIds([contextMenu.objectId]); setContextMenu(null) }} />
        <ContextAction icon={<Copy size={14} />} label="Duplicate" shortcut="Ctrl + D" onClick={() => contextAction('duplicate')} />
        <ContextAction icon={<Clipboard size={14} />} label="Copy" shortcut="Ctrl + C" onClick={() => contextAction('copy')} />
        <ContextAction icon={<Trash2 size={14} />} label="Cut" shortcut="Ctrl + X" onClick={() => contextAction('cut')} />
        <ContextAction icon={<Clipboard size={14} />} label="Paste" shortcut="Ctrl + V" onClick={() => contextAction('paste')} />
        <div className="menu-separator" />
        <ContextAction icon={<Sparkles size={14} />} label="Save as component" onClick={() => contextAction('saveComponent')} disabled={!current} />
        <ContextAction icon={<SquareDashed size={14} />} label="Create frame from selection" onClick={() => { createFrameFromSelection(); setContextMenu(null) }} disabled={!selected.length} />
        <ContextAction icon={<Layers size={14} />} label="Group selection" shortcut="Ctrl + G" onClick={() => { groupSelected(); setContextMenu(null) }} disabled={!canGroupSelection} />
        <ContextAction icon={<FolderOpen size={14} />} label="Ungroup" shortcut="Ctrl + Shift + G" onClick={() => { ungroupSelected(); setContextMenu(null) }} disabled={!canUngroupSelection} />
        <div className="menu-separator" />
        <ContextAction icon={<ArrowUp size={14} />} label="Bring to front" shortcut="Ctrl + ]" onClick={() => contextAction('front')} disabled={!selected.length} />
        <ContextAction icon={<ArrowDown size={14} />} label="Send to back" shortcut="Ctrl + [" onClick={() => contextAction('back')} disabled={!selected.length} />
        <div className="menu-separator" />
        <ContextAction icon={<FlipVertical2 size={14} />} label="Flip horizontally" onClick={() => contextAction('flipX')} disabled={!current} />
        <ContextAction icon={<FlipHorizontal2 size={14} />} label="Flip vertically" onClick={() => contextAction('flipY')} disabled={!current} />
        <div className="menu-separator" />
        <ContextAction icon={<Trash2 size={14} />} label="Delete" shortcut="Delete" onClick={() => contextAction('delete')} disabled={!selected.length} danger />
      </div></>}

      {showIconEditor && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowIconEditor(false) }}>
          <section className="export-dialog icon-editor-dialog" role="dialog" aria-modal="true" aria-label="Create SVG icon">
            <div className="icon-editor-header">
              <input aria-label="Icon name" value={iconName} onChange={(event) => setIconName(event.target.value)} />
              <button className="icon-button" aria-label="Close icon editor" onClick={() => setShowIconEditor(false)}><X size={16} /></button>
            </div>
            <div className="icon-editor-tools">
              <button type="button" title="Rectangle" aria-label="Rectangle" aria-pressed={iconTool === 'rectangle'} className={iconTool === 'rectangle' ? 'active' : ''} onClick={() => setIconTool('rectangle')}><Square size={15} /></button>
              <button type="button" title="Ellipse" aria-label="Ellipse" aria-pressed={iconTool === 'ellipse'} className={iconTool === 'ellipse' ? 'active' : ''} onClick={() => setIconTool('ellipse')}><Circle size={15} /></button>
              <button type="button" title="Pen" aria-label="Pen" aria-pressed={iconTool === 'pen'} className={iconTool === 'pen' ? 'active' : ''} onClick={() => setIconTool('pen')}><Pencil size={15} /></button>
              <button type="button" title="Text" aria-label="Text" aria-pressed={iconTool === 'text'} className={iconTool === 'text' ? 'active' : ''} onClick={() => setIconTool('text')}><Type size={15} /></button>
              <ColorPicker compact label="Shape color" value={iconColor} onChangeStart={() => undefined} onChange={(color) => setIconColor(colorToHex(parseColor(color)))} onChangeEnd={() => undefined} />
              <button type="button" title="Undo last shape" aria-label="Undo last shape" onClick={() => setIconShapes((shapes) => shapes.slice(0, -1))}><Undo2 size={14} /></button>
            </div>
            {iconTool === 'text' && <input className="icon-editor-text" aria-label="Text content" value={iconText} onChange={(event) => setIconText(event.target.value)} />}
            <svg ref={iconCanvasRef} className="icon-drawing-canvas" viewBox="0 0 128 128" onPointerDown={startIconDrawing} onPointerMove={moveIconDrawing} onPointerUp={finishIconDrawing} onPointerCancel={finishIconDrawing}>
              <rect className="icon-drawing-board" x="0" y="0" width="128" height="128" pointerEvents="none" />
              {iconShapes.map((shape) => shape.kind === 'path'
                ? <path key={shape.id} d={shape.path} fill="none" stroke={shape.color} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
                : shape.kind === 'ellipse'
                  ? <ellipse key={shape.id} cx={shape.x + shape.width / 2} cy={shape.y + shape.height / 2} rx={shape.width / 2} ry={shape.height / 2} fill={shape.color} />
                  : shape.kind === 'text'
                    ? <text key={shape.id} x={shape.x} y={shape.y} fill={shape.color} fontFamily="sans-serif" fontSize={shape.height}>{shape.text}</text>
                    : <rect key={shape.id} x={shape.x} y={shape.y} width={shape.width} height={shape.height} fill={shape.color} />)}
              {iconPreview?.kind === 'rect' && <rect x={iconPreview.x} y={iconPreview.y} width={iconPreview.width} height={iconPreview.height} fill={iconPreview.color} opacity={0.7} />}
              {iconPreview?.kind === 'ellipse' && <ellipse cx={iconPreview.x + iconPreview.width / 2} cy={iconPreview.y + iconPreview.height / 2} rx={iconPreview.width / 2} ry={iconPreview.height / 2} fill={iconPreview.color} opacity={0.7} />}
              {iconTool === 'pen' && iconPoints.length > 1 && <path d={iconPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')} fill="none" stroke={iconColor} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
            </svg>
            <div className="dialog-actions">
              <button className="button button-subtle" onClick={() => setShowIconEditor(false)}>Cancel</button>
              <button className="button button-primary" disabled={!iconShapes.length} onClick={saveCustomIcon}><Check size={14} />Save icon</button>
            </div>
          </section>
        </div>
      )}
      {showExport && <div className="modal-backdrop export-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowExport(false) }}><section className="export-dialog export-composition-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="export-header"><div className="export-heading"><span className="dialog-icon"><Upload size={15} /></span><div><h2 id="export-title">Export composition</h2><p>Save your work in the format you need</p></div></div><button className="icon-button" aria-label="Close export dialog" onClick={() => setShowExport(false)}><X size={17} /></button></div>
        <label className="export-name-field"><span>File name</span><div><input placeholder="launch-day55" value={exportName} onChange={(event) => setExportName(event.target.value)} /><b>.svg</b></div></label>
        <div className="export-canvas-field"><span className="export-field-label">Canvas</span><div className="export-dimensions"><div className="export-dimension"><span>W</span><NumericField label="" value={canvasWidth} onChange={(value) => updateCanvasDimension('width', value)} /></div><span className="export-multiply">×</span><div className="export-dimension"><span>H</span><NumericField label="" value={canvasHeight} onChange={(value) => updateCanvasDimension('height', value)} /></div><span className="export-units">px</span></div></div>
        <button className="background-toggle" aria-pressed={transparentBackground} onClick={() => setTransparentBackground((value) => !value)}><span className={`check-box ${transparentBackground ? 'is-checked' : ''}`}>{transparentBackground && <Check size={12} />}</span><span className="background-toggle-copy"><span>Transparent background</span><small>Vector shapes stay editable in your design tools.</small></span></button>
        <div className="dialog-actions"><button className="button button-subtle" onClick={() => setShowExport(false)}>Cancel</button><button className="button button-primary" onClick={exportSvg}><Upload size={14} />Export SVG</button></div>
      </section></div>}
      {showSettings && <div className="modal-backdrop settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowSettings(false) }}><section className="export-dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div className="dialog-header"><div><h2 id="settings-title">{language === 'ru' ? 'Настройки' : 'Settings'}</h2></div><button className="icon-button" aria-label="Close settings" onClick={() => setShowSettings(false)}><X size={22} /></button></div><div className="settings-tabs"><button className="active">{language === 'ru' ? 'Внешний вид' : 'Appearance'}</button></div><div className="settings-content"><div className="settings-row"><div><b>{language === 'ru' ? 'Язык' : 'Language'}</b><small>{language === 'ru' ? 'Выберите язык интерфейса' : 'Choose the interface language'}</small></div><div className="language-control" ref={languageControlRef} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setLanguageMenuOpen(false) } if (event.key === 'ArrowDown') { event.preventDefault(); setLanguageMenuOpen(true); requestAnimationFrame(() => languageControlRef.current?.querySelector<HTMLButtonElement>('[role="option"]')?.focus()) } }}><button type="button" className="settings-select" aria-haspopup="listbox" aria-expanded={languageMenuOpen} onClick={() => setLanguageMenuOpen((open) => !open)}><span>{language === 'en' ? 'English' : 'Русский'}</span><ChevronDown size={17} /></button>{languageMenuOpen && <div className="language-options" role="listbox" aria-label={language === 'ru' ? 'Язык интерфейса' : 'Interface language'}>{([{ value: 'en', label: 'English' }, { value: 'ru', label: 'Русский' }] as const).map((option) => <button type="button" role="option" aria-selected={language === option.value} key={option.value} className={`language-option ${language === option.value ? 'selected' : ''}`} onClick={() => { setLanguage(option.value); setLanguageMenuOpen(false) }} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const options = Array.from(languageControlRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []); const direction = event.key === 'ArrowDown' ? 1 : -1; options[(options.indexOf(event.currentTarget) + direction + options.length) % options.length]?.focus() } }}>{option.label}{language === option.value && <Check size={15} />}</button>)}</div>}</div></div><div className="settings-divider" /><div className="theme-heading"><b>{language === 'ru' ? 'Тема интерфейса' : 'Interface theme'}</b><small>{language === 'ru' ? 'Настройте внешний вид приложения' : 'Customise your application theme'}</small></div><div className="theme-options">{(['system', 'light', 'dark'] as const).map((mode) => <button key={mode} type="button" aria-pressed={interfaceTheme === mode} className={`theme-card ${interfaceTheme === mode ? 'selected' : ''}`} onClick={() => selectTheme(mode)}><ThemePreview mode={mode} /><b>{mode === 'system' ? (language === 'ru' ? 'Системная' : 'System') : mode === 'light' ? (language === 'ru' ? 'Светлая' : 'Light') : (language === 'ru' ? 'Тёмная' : 'Dark')}</b>{interfaceTheme === mode && <span className="theme-check"><Check size={14} /></span>}</button>)}</div></div><div className="dialog-actions"><button className="button button-primary" onClick={() => setShowSettings(false)}>{language === 'ru' ? 'Готово' : 'Done'}</button></div></section></div>}
      {showHelp && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowHelp(false) }}><section className="export-dialog help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><div className="dialog-header"><div><span className="dialog-icon"><CircleHelp size={16} /></span><h2 id="help-title">Editor shortcuts</h2></div><button className="icon-button" aria-label="Close help" onClick={() => setShowHelp(false)}><X size={16} /></button></div><div className="shortcut-list">{[['Select all', 'Ctrl + A'], ['Duplicate', 'Ctrl + D'], ['Undo', 'Ctrl + Z'], ['Redo', 'Ctrl + Shift + Z'], ['Delete', 'Delete'], ['Deselect', 'Escape'], ['Move selection', 'Arrow keys'], ['Nudge 10 px', 'Shift + Arrow']].map(([label, shortcut]) => <div className="shortcut-row" key={label}><span>{label}</span><kbd>{shortcut}</kbd></div>)}</div><div className="dialog-actions"><button className="button button-subtle" onClick={() => setShowHelp(false)}>Close</button></div></section></div>}
      {toast && <div className="toast"><Check size={14} />{toast}</div>}
    </main>
  )
}

function DownloadIcon() {
  return <Download size={14} />
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  return <span className={`theme-preview ${mode}-preview`} aria-hidden="true">
    <span className="preview-toolbar"><i /><i /><i /></span>
    <span className="preview-sidebar"><i /><i /><i /><i /><i /></span>
    <span className="preview-content"><b>My dashboard</b><i /><strong><i /><i /></strong></span>
  </span>
}

const CanvasObjectArtwork = memo(function CanvasObjectArtwork({ item }: { item: CanvasObject }) {
  const markup = useMemo(() => namespaceSvgIds(item.markup, item.objectId), [item.markup, item.objectId])
  if (item.isGroup) return null
  if (item.isFrame) return <rect className="canvas-frame" x={0} y={0} width={item.width} height={item.height} fill="transparent" pointerEvents="all" />
  return <svg x={0} y={0} width={item.width} height={item.height} viewBox={item.viewBox} preserveAspectRatio="xMidYMid meet" dangerouslySetInnerHTML={{ __html: markup }} />
})

function ProjectCanvasPreview({ project, language }: { project: Project; language: 'en' | 'ru' }) {
  const width = project.width || 1440
  const height = project.height || 900
  return <span className="project-preview" style={{ aspectRatio: `${width} / ${height}` }}>
    <svg className="project-canvas-thumbnail" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" aria-label={`Preview of ${project.name}`}>
      <rect width={width} height={height} fill={project.backgroundColor || '#ffffff'} />
      {project.objects.filter((item) => isObjectEffectivelyVisible(project.objects, item)).map((item) => <g key={item.objectId} transform={`translate(${item.x + item.width / 2} ${item.y + item.height / 2}) rotate(${item.rotation}) scale(${item.flipX ? -1 : 1} ${item.flipY ? -1 : 1}) translate(${-item.width / 2} ${-item.height / 2})`} opacity={item.opacity}>
        <CanvasObjectArtwork item={item} />
      </g>)}
    </svg>
    {!project.objects.some((item) => isObjectEffectivelyVisible(project.objects, item)) && <span className="preview-empty-mark"><Layers size={24} /></span>}
      <span className="preview-count">{translateRussian(`${project.objects.length} objects`, language)}</span><span className="preview-size">{width} × {height}</span>
  </span>
}

function ObjectTypeIcon({ item }: { item: CanvasObject }) {
  return <LayerObjectThumbnail item={item} />
}

const LayerObjectThumbnail = memo(function LayerObjectThumbnail({ item }: { item: CanvasObject }) {
  const markup = useMemo(() => namespaceSvgIds(item.markup, item.objectId), [item.markup, item.objectId])
  return <svg className="layer-thumbnail" viewBox={item.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true" dangerouslySetInnerHTML={{ __html: markup }} />
})

function ColorPicker({ label, value, onChange, onChangeStart, onChangeEnd, compact = false }: { label: string; value: string; onChange: (color: string) => void; onChangeStart: () => void; onChangeEnd: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ColorFormat>('hex')
  const [draft, setDraft] = useState<string[] | null>(null)
  const [position, setPosition] = useState({ top: 8, left: 8 })
  const [recentColors, setRecentColors] = useState<string[]>(() => readStored('pixo-recent-colors', ['#7049F5', '#2F80ED', '#27AE60', '#F2994A', '#EB5757', '#20233C']))
  const anchorRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const color = parseColor(value)
  const hsv = rgbToHsv(color)
  const hsl = rgbToHsl(color)

  function updatePosition() {
    const bounds = anchorRef.current?.getBoundingClientRect()
    if (!bounds) return
    const width = 270
    const height = 380
    const left = clamp(bounds.right - width, 8, window.innerWidth - width - 8)
    const top = bounds.bottom + 8 + height <= window.innerHeight ? bounds.bottom + 8 : Math.max(8, bounds.top - height - 8)
    setPosition({ left, top })
  }

  function rememberColor(next: string) {
    const hex = colorToHex(parseColor(next))
    const colors = [hex, ...recentColors.filter((color) => color !== hex)].slice(0, 8)
    setRecentColors(colors)
    localStorage.setItem('pixo-recent-colors', JSON.stringify(colors))
  }

  function emit(next: RgbaColor) {
    onChange(colorToCss(next))
  }

  function updateSaturationValue(event: React.PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const saturation = clamp((event.clientX - bounds.left) / bounds.width)
    const brightness = 1 - clamp((event.clientY - bounds.top) / bounds.height)
    emit(hsvToRgb(hsv.h, saturation, brightness, color.a))
  }

  function startSaturationValue(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    onChangeStart()
    updateSaturationValue(event)
  }

  function handleFormatInput(index: number, rawValue: string, fieldValues: string[]) {
    const nextDraft = [...fieldValues]
    nextDraft[index] = rawValue
    setDraft(nextDraft)
    if (format === 'hex') {
      const normalized = rawValue.replace(/^#?/, '#').toUpperCase()
      if (/^#[\dA-F]{6}$/i.test(normalized)) {
        onChangeStart()
        onChange(colorToCss(parseColor(normalized)))
        onChangeEnd()
        rememberColor(normalized)
      }
      return
    }
    const channels = nextDraft.map(Number)
    if (channels.some((channel) => !Number.isFinite(channel))) return
    onChangeStart()
    if (format === 'rgb') {
      emit({ r: clamp(channels[0], 0, 255), g: clamp(channels[1], 0, 255), b: clamp(channels[2], 0, 255), a: color.a })
    } else {
      emit(hslToRgb(clamp(channels[0], 0, 360), clamp(channels[1], 0, 100) / 100, clamp(channels[2], 0, 100) / 100, color.a))
    }
    onChangeEnd()
  }

  useEffect(() => {
    if (!open) return
    updatePosition()
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node) && !popoverRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const fields = format === 'hex'
    ? [{ label: 'HEX', value: colorToHex(color) }]
    : format === 'rgb'
      ? [{ label: 'R', value: String(Math.round(color.r)) }, { label: 'G', value: String(Math.round(color.g)) }, { label: 'B', value: String(Math.round(color.b)) }]
      : [{ label: 'H', value: String(Math.round(hsl.h)) }, { label: 'S', value: String(Math.round(hsl.s * 100)) }, { label: 'L', value: String(Math.round(hsl.l * 100)) }]

  return <div className={`color-picker-anchor ${compact ? 'compact' : ''}`} ref={anchorRef}>
    <div className="color-row">{!compact && <span>{label}</span>}<button type="button" className="color-picker-trigger" aria-label={`${label} color`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen((isOpen) => !isOpen); window.requestAnimationFrame(updatePosition) }}><i className="color-picker-swatch" style={{ background: colorToCss(color) }} />{!compact && <code>{colorToHex(color)}</code>}</button></div>
    {open && <div className="color-picker-popover" ref={popoverRef} role="dialog" aria-label={`${label} color picker`} style={{ left: position.left, top: position.top }}>
      <header className="color-picker-header"><span className="color-picker-current"><i style={{ background: colorToCss(color) }} />{colorToHex(color)}</span><button type="button" className="color-picker-close" aria-label="Close color picker" onClick={() => { rememberColor(value); setOpen(false) }}><X size={15} /></button></header>
      <div className="color-saturation" role="slider" aria-label="Saturation and brightness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s * 100)} tabIndex={0} style={{ '--picker-hue': `hsl(${hsv.h} 100% 50%)` } as React.CSSProperties} onPointerDown={startSaturationValue} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSaturationValue(event) }} onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId); onChangeEnd(); rememberColor(colorToCss(color)) }} onKeyDown={(event) => { const step = event.shiftKey ? 10 : 2; if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); onChangeStart(); const saturation = clamp(hsv.s + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0) / 100); const brightness = clamp(hsv.v + (event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0) / 100); emit(hsvToRgb(hsv.h, saturation, brightness, color.a)); onChangeEnd() }}><i className="color-saturation-handle" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} /></div>
      <label className="color-picker-slider hue-slider"><span>Hue</span><input aria-label="Hue" type="range" min="0" max="360" value={hsv.h} onPointerDown={onChangeStart} onChange={(event) => emit(hsvToRgb(Number(event.target.value), hsv.s, hsv.v, color.a))} onPointerUp={() => { onChangeEnd(); rememberColor(colorToCss(color)) }} /></label>
      <label className="color-picker-slider alpha-slider"><span>Opacity</span><i className="alpha-gradient" style={{ '--alpha-color': colorToHex(color) } as React.CSSProperties} /><input aria-label="Opacity" type="range" min="0" max="1" step="0.01" value={color.a} onPointerDown={onChangeStart} onChange={(event) => emit({ ...color, a: Number(event.target.value) })} onPointerUp={() => { onChangeEnd(); rememberColor(colorToCss(color)) }} /></label>
      <div className="color-picker-format" role="tablist" aria-label="Color format">{(['hex', 'rgb', 'hsl'] as ColorFormat[]).map((option) => <button type="button" key={option} role="tab" aria-selected={format === option} className={format === option ? 'active' : ''} onClick={() => { setDraft(null); setFormat(option) }}>{option.toUpperCase()}</button>)}</div>
      <div className={`color-picker-fields ${format}`}>
        {fields.map((field, index) => <label key={field.label}><span>{field.label}</span><input aria-label={field.label} value={draft?.[index] ?? field.value} inputMode={format === 'hex' ? 'text' : 'numeric'} onChange={(event) => handleFormatInput(index, event.target.value, fields.map((entry, entryIndex) => draft?.[entryIndex] ?? entry.value))} onBlur={() => { setDraft(null); rememberColor(value) }} /></label>)}
        <label className="color-picker-alpha-field"><span>A</span><input aria-label="Alpha" value={Math.round(color.a * 100)} inputMode="numeric" onChange={(event) => { const alpha = Number(event.target.value); if (Number.isFinite(alpha)) { onChangeStart(); emit({ ...color, a: clamp(alpha, 0, 100) / 100 }); onChangeEnd() } }} /><b>%</b></label>
      </div>
      {recentColors.length > 0 && <div className="color-picker-recents" aria-label="Recent colors">{recentColors.map((recent) => <button type="button" key={recent} title={recent} aria-label={`Use ${recent}`} style={{ background: recent }} onClick={() => { onChangeStart(); onChange(colorToCss(parseColor(recent))); onChangeEnd(); rememberColor(recent) }} />)}</div>}
    </div>}
  </div>
}

function NumericField({ label, value, suffix, onChange }: { label: string; value: number; suffix?: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const initialDraft = useRef<string | null>(null)
  const formattedValue = Number(value.toFixed(2)).toString()

  function parseDraft(input: string) {
    const normalized = input.trim().replace(',', '.')
    if (!normalized || normalized === '-' || normalized === '.' || normalized === '-.') return null
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  function normalizeDraft(input: string) {
    const match = input.match(/^(-?)0+(\d*)([.,]\d*)?$/)
    if (!match) return input
    const integer = match[2].replace(/^0+(?=\d)/, '') || '0'
    return `${match[1]}${integer}${match[3] ?? ''}`
  }

  function commitDraft() {
    if (draft === null) return
    if (draft !== initialDraft.current) {
      const parsed = parseDraft(draft)
      if (parsed !== null) onChange(parsed)
    }
    initialDraft.current = null
    setDraft(null)
  }

  return <label className="numeric-field">{label && <span>{label}</span>}<input type="text" inputMode="decimal" value={draft ?? formattedValue} onFocus={() => { initialDraft.current = formattedValue; setDraft(formattedValue) }} onChange={(event) => { const next = normalizeDraft(event.target.value); setDraft(next); const parsed = parseDraft(next); if (parsed !== null) onChange(parsed) }} onBlur={commitDraft} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') event.currentTarget.blur() }} /><small>{suffix}</small></label>
}

function TextControls({ fontFamily, fontSize, onFontFamily, onFontSize }: { fontFamily: string; fontSize: number; onFontFamily: (fontFamily: string) => void; onFontSize: (fontSize: number) => void }) {
  return <div className="text-controls"><label className="typography-control typography-font"><span>Font</span><select value={fontFamily} onChange={(event) => onFontFamily(event.target.value)}><option value="sans-serif">Sans serif</option><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="monospace">Monospace</option><option value="serif">Serif</option></select></label><div className="typography-control typography-size"><span>Size</span><NumericField label="" value={fontSize} suffix="px" onChange={onFontSize} /></div></div>
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  const parts = Children.toArray(children)
  return <section className="inspector-section"><div className="inspector-section-title"><span>{title}</span>{parts[0]}</div><div className="inspector-section-body">{parts.slice(1)}</div></section>
}

function ContextAction({ icon, label, shortcut, onClick, disabled, danger }: { icon: React.ReactNode; label: string; shortcut?: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  void shortcut
  return <button className={`context-action ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onClick}><span>{icon}{label}</span></button>
}

export default App
