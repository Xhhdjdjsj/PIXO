export interface SvgAsset {
  id: string
  name: string
  category: string
  width: number
  height: number
  viewBox: string
  markup: string
  source: string
  sourceFileId?: string
  imported?: boolean
}

export interface CanvasObject extends SvgAsset {
  objectId: string
  x: number
  y: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  flipX?: boolean
  flipY?: boolean
  proportionsLocked?: boolean
  frameId?: string
  isFrame?: boolean
  isGroup?: boolean
  textContent?: string
  fontSize?: number
  fontFamily?: string
  contentBoundsFitted?: boolean
  contentBoundsVersion?: number
  freehandPoints?: Array<{ x: number; y: number }>
  erasures?: Array<{ id: string; d: string; strokeWidth: number }>
}

export interface DragState {
  id: string
  mode: 'move' | 'resize'
  handle?: string
  startX: number
  startY: number
  x: number
  y: number
  width: number
  height: number
  objectIds?: string[]
  snapshots?: Array<Pick<CanvasObject, 'objectId' | 'x' | 'y' | 'width' | 'height'>>
  bounds?: { x: number; y: number; width: number; height: number }
  moved?: boolean
  selectOnClick?: string
}
