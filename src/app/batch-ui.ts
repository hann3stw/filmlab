/**
 * Batch render with a progress sheet: "apply this recipe to these photos".
 * Used by the library (multi-select) and by the Recipes tab.
 */

import { h, openSheet, toast } from '../ui/dom.ts'
import { t } from '../i18n/index.ts'
import { cameraService } from '../camera/camera-service.ts'
import { applyRecipeBatch } from '../library/batch.ts'
import { getPhoto, type Photo } from '../library/photos.ts'
import type { Recipe } from '../recipes/recipe.ts'

/**
 * @param recipeFor which recipe to use for a photo ("as shot" differs per photo)
 * @returns number of photos developed, or null if the camera wasn't ready
 */
export async function runBatch(ids: string[], recipeFor: (p: Photo) => Recipe): Promise<number | null> {
  if (!cameraService.isReady) { toast(t('lib.needCamera'), 'error'); return null }
  let cancelled = false
  const text = h('p', { class: 'sheet-text' })
  const fill = h('i')
  const sheet = openSheet(t('lib.batchTitle'), () => { cancelled = true })
  sheet.body.append(text, h('div', { class: 'progress-bar' }, fill),
    h('div', { class: 'row end' }, h('button', { class: 'btn ghost', onclick: () => sheet.close() }, t('common.cancel'))))

  let ok = 0, notDone = 0
  for (let i = 0; i < ids.length && !cancelled; i++) {
    const p = await getPhoto(ids[i])
    if (!p) continue
    text.textContent = t('lib.batchProgress', { done: i + 1, total: ids.length, name: p.fileName })
    fill.style.width = `${(i / ids.length) * 100}%`
    const r = await applyRecipeBatch([p.id], recipeFor(p), () => {}, () => cancelled)
    ok += r.ok
    notDone += r.failed + r.skipped
  }
  if (!cancelled) sheet.close()
  toast(t('lib.batchDone', { ok, failed: notDone }), notDone ? 'error' : 'info')
  return ok
}
