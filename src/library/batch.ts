/**
 * Batch processing: apply one recipe to many photos.
 *
 * The camera can only develop one photo at a time, so we go through the list
 * one by one: upload RAF → render with the recipe → store the JPEG.
 * (~1 s per photo on the X-T30 III, upload included.)
 */

import { cameraService } from '../camera/camera-service.ts'
import { getPhoto, rafBytes, saveResult } from './photos.ts'
import type { Recipe } from '../recipes/recipe.ts'
import { log } from '../ui/debug-log.ts'

export interface BatchProgress { done: number; total: number; current: string }
export interface BatchResult { ok: number; failed: number; skipped: number; cancelled: boolean }

export async function applyRecipeBatch(
  ids: string[],
  recipe: Recipe,
  onProgress: (p: BatchProgress) => void,
  isCancelled: () => boolean,
): Promise<BatchResult> {
  const res: BatchResult = { ok: 0, failed: 0, skipped: 0, cancelled: false }
  for (let i = 0; i < ids.length; i++) {
    if (isCancelled()) { res.cancelled = true; break }
    const p = await getPhoto(ids[i])
    if (!p) { res.skipped++; continue }
    onProgress({ done: i, total: ids.length, current: p.fileName })
    if (p.rafDeleted) { res.skipped++; continue } // no RAW left to develop
    if (!cameraService.isReady) { res.failed += ids.length - i; break }
    try {
      const jpeg = await cameraService.render(p.id, () => rafBytes(p), recipe, p.asShot)
      await saveResult({ ...p, maxDR: cameraService.shotDynamicRange ?? p.maxDR }, jpeg, recipe, true)
      res.ok++
      log(`Batch: ${p.fileName} done`, 'ok')
    } catch (err) {
      res.failed++
      log(`Batch: ${p.fileName} failed: ${err}`, 'error')
    }
  }
  onProgress({ done: ids.length, total: ids.length, current: '' })
  return res
}
