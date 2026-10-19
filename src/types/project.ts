import type { CanvasObject } from './svg'

export interface Project {
  id: string
  name: string
  width: number
  height: number
  backgroundColor?: string
  objects: CanvasObject[]
  createdAt: number
  updatedAt: number
}
