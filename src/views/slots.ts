/**
 * Camera custom slots UI:
 *  - slotsCard(): list of C1…C7 on the Camera tab, import a slot as a recipe,
 *    backups + restore
 *  - loadRecipeOntoCamera(): recipe → choose slot → preview → confirm → write → verify
 *
 * Safety rules implemented here:
 *  1. Nothing is written without a preview and an explicit confirmation.
 *  2. Before the FIRST write ever, all slots are backed up automatically.
 *  3. After writing, the slot is read back and compared.
 *  4. If the camera disappears mid-write, we say so clearly and point to Restore.
 */

import { h, openSheet, confirmSheet, toast, replaceChildren as setKids } from '../ui/dom.ts'
import { t } from '../i18n/index.ts'
import { cameraService } from '../camera/camera-service.ts'
import type { PresetData } from '../camera/ptp/session.ts'
import { FIELDS, summarize, type Recipe } from '../recipes/recipe.ts'
import {
  readSlots, slotToRecipe, slotDiff, slotName, writeRecipeToSlot, ensureFirstBackup,
  listBackups, saveBackup, restoreBackup, SLOT_NAME_MAX, type SlotBackup,
} from '../recipes/slots.ts'
import { createRecipe } from '../recipes/store.ts'
import { pickRecipe } from '../app/recipe-picker.ts'
import { log } from '../ui/debug-log.ts'

/** Explain why the camera can't be used right now (or return null if it can). */
function cameraProblem(): string | null {
  switch (cameraService.status) {
    case 'connected': return null
    case 'wrong-mode': return t('cam.note.wrongMode')
    case 'unsupported': return t('cam.note.unsupported')
    default: return t('slots.needCamera')
  }
}

/** Sheet with a spinner while slots are being read. Returns null on failure. */
async function readSlotsWithUI(): Promise<PresetData[] | null> {
  const problem = cameraProblem()
  if (problem) { toast(problem, 'error', 6000); return null }
  const sheet = openSheet(t('slots.reading'))
  sheet.body.append(h('div', { class: 'center' }, h('div', { class: 'spinner' })))
  try {
    return await readSlots(cameraService.camera!)
  } catch (err) {
    log(`Reading slots failed: ${err}`, 'error')
    toast(String(err).includes('no-slots') ? t('cam.note.wrongMode') : t('slots.readFailed'), 'error', 6000)
    return null
  } finally {
    sheet.close()
  }
}

/** The full flow for putting a recipe onto the camera. */
export async function loadRecipeOntoCamera(name: string, recipe: Recipe, fixedSlot?: number): Promise<void> {
  const slots = await readSlotsWithUI()
  if (!slots) return

  // ---- 1. choose the slot ----
  const target = fixedSlot
    ? slots.find(s => s.slot === fixedSlot) ?? null
    : await new Promise<PresetData | null>(resolve => {
      let chosen: PresetData | null = null
      const sheet = openSheet(t('slots.choose'), () => resolve(chosen))
      sheet.body.append(
        h('p', { class: 'sheet-note' }, t('slots.chooseNote')),
        h('div', { class: 'opt-list' }, ...slots.map(s =>
          h('button', { class: 'opt slot-opt', onclick: () => { chosen = s; sheet.close() } },
            h('span', { class: 'slot-id' }, `C${s.slot}`),
            h('span', { class: 'slot-text' }, h('span', null, s.name || '—'), h('span', { class: 'label' }, summarize(slotToRecipe(s)))),
          ))),
      )
    })
  if (!target) return

  // ---- 2. preview what will change ----
  const before = slotToRecipe(target)
  const changes = slotDiff(before, recipe)
  const newName = slotName(name) || `C${target.slot}`
  const confirmed = await new Promise<boolean>(resolve => {
    let ok = false
    const sheet = openSheet(t('slots.previewTitle', { slot: target.slot }), () => resolve(ok))
    sheet.body.append(
      h('div', { class: 'diff-names' },
        h('div', null, h('div', { class: 'label' }, t('slots.now')), h('div', { class: 'diff-name old' }, target.name || '—')),
        h('div', { class: 'diff-arrow' }, '→'),
        h('div', null, h('div', { class: 'label' }, t('slots.new')), h('div', { class: 'diff-name' }, newName)),
      ),
      newName !== name.trim() ? h('p', { class: 'sheet-note' }, t('slots.nameNote', { max: SLOT_NAME_MAX })) : '',
      changes.length
        ? h('table', { class: 'diff' }, ...changes.map(k => {
          const f = FIELDS.find(x => x.key === k)!
          return h('tr', null, h('td', { class: 'label' }, t(f.label)), h('td', { class: 'old' }, f.format(before)), h('td', null, '→'), h('td', null, f.format(recipe)))
        }))
        : h('p', { class: 'sheet-note' }, t('slots.noChanges')),
      h('p', { class: 'sheet-note' }, t('slots.notStored')),
      h('p', { class: 'notice', 'data-kind': 'warn' }, t('slots.overwriteWarn', { slot: target.slot, name: target.name || '—' })),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => sheet.close() }, t('common.cancel')),
        h('button', { class: 'btn', onclick: () => { ok = true; sheet.close() } }, t('slots.write')),
      ),
    )
  })
  if (!confirmed) return

  // ---- 3. backup (first time), write, verify ----
  const problem = cameraProblem()
  if (problem) { toast(problem, 'error', 6000); return }
  const cam = cameraService.camera!
  const busy = openSheet(t('slots.writing', { slot: target.slot }))
  busy.body.append(h('div', { class: 'center' }, h('div', { class: 'spinner' })), h('p', { class: 'sheet-note' }, t('slots.dontUnplug')))
  try {
    if (await ensureFirstBackup(cam.modelName, slots)) toast(t('slots.backedUp'))
    const res = await writeRecipeToSlot(cam, target, name, recipe)
    busy.close()
    if (res.ok && res.verified) toast(t('slots.done', { slot: target.slot, name: newName }), 'info', 5000)
    else if (res.ok) {
      const fields = res.mismatches.map(k => t(FIELDS.find(f => f.key === k)!.label)).join(', ')
      await confirmSheet(t('slots.partialTitle'), t('slots.partialText', { slot: target.slot, fields: fields || '—' }), 'OK', t('common.cancel'))
    } else {
      await confirmSheet(t('slots.failedTitle'), t('slots.failedText'), 'OK', t('common.cancel'))
    }
  } catch (err) {
    // Typically: cable pulled / camera switched off during the write
    busy.close()
    log(`Slot write interrupted: ${err}`, 'error')
    await confirmSheet(t('slots.interruptedTitle'), t('slots.interruptedText', { slot: target.slot }), 'OK', t('common.cancel'))
  }
}

/** Card for the Camera tab: slot list + backups. */
export function slotsCard(): HTMLElement & { dispose: () => void } {
  const list = h('div', { class: 'slot-list' })
  const backups = h('div', { class: 'backup-list' })
  const readBtn = h('button', { class: 'btn ghost small' }, t('slots.read'))
  const backupBtn = h('button', { class: 'btn ghost small' }, t('slots.backupNow'))
  const card = h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, t('slots.title')), h('span', { class: 'label' }, 'C1 – C7')),
    h('p', { class: 'hint' }, t('slots.intro')),
    h('div', { class: 'row wrap' }, readBtn, backupBtn),
    list,
    h('div', { class: 'label' }, t('slots.backups')),
    backups,
  ) as unknown as HTMLElement & { dispose: () => void }

  let slots: PresetData[] = []

  function drawSlots() {
    setKids(list, ...slots.map(s => h('button', { class: 'opt slot-opt', onclick: () => slotMenu(s) },
      h('span', { class: 'slot-id' }, `C${s.slot}`),
      h('span', { class: 'slot-text' }, h('span', null, s.name || '—'), h('span', { class: 'label' }, summarize(slotToRecipe(s)))),
    )))
  }

  function slotMenu(s: PresetData) {
    const sheet = openSheet(`C${s.slot} · ${s.name || '—'}`)
    sheet.body.append(h('div', { class: 'opt-list' },
      h('button', { class: 'opt', onclick: async () => {
        sheet.close()
        await createRecipe(s.name || `C${s.slot}`, slotToRecipe(s), 'mine')
        toast(t('slots.imported', { name: s.name || `C${s.slot}` }))
      } }, t('slots.importAsRecipe')),
      h('button', { class: 'opt', onclick: async () => {
        sheet.close()
        const choice = await pickRecipe({ allowAsShot: false })
        if (choice?.kind === 'recipe') { await loadRecipeOntoCamera(choice.name, choice.recipe, s.slot); void read(true) }
      } }, t('slots.loadHere')),
    ))
  }

  async function read(quiet = false) {
    const res = quiet && cameraService.isReady ? await readSlots(cameraService.camera!).catch(() => null) : await readSlotsWithUI()
    if (res) { slots = res; drawSlots() }
  }

  async function drawBackups() {
    const all = await listBackups()
    setKids(backups, ...(all.length ? all.map(b => h('div', { class: 'backup-row' },
      h('div', null,
        h('div', null, new Date(b.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })),
        h('div', { class: 'label' }, `${b.model} · ${b.slots.length} Slots${b.auto ? ' · ' + t('slots.autoBackup') : ''}`)),
      h('button', { class: 'btn ghost small', onclick: () => void restore(b) }, t('slots.restore')),
    )) : [h('p', { class: 'hint' }, t('slots.noBackups'))]))
  }

  async function restore(b: SlotBackup) {
    const problem = cameraProblem()
    if (problem) { toast(problem, 'error', 6000); return }
    const names = b.slots.map(s => `C${s.slot} ${s.name}`).join(', ')
    if (!await confirmSheet(t('slots.restoreTitle'), t('slots.restoreText', { names }), t('slots.restore'), t('common.cancel'), true)) return
    const busy = openSheet(t('slots.restoring'))
    const fill = h('i')
    busy.body.append(h('div', { class: 'progress-bar' }, fill), h('p', { class: 'sheet-note' }, t('slots.dontUnplug')))
    try {
      const failed = await restoreBackup(cameraService.camera!, b, (d, n) => { fill.style.width = `${(d / n) * 100}%` })
      busy.close()
      toast(failed.length ? t('slots.restoreFailed', { slots: failed.map(n => 'C' + n).join(', ') }) : t('slots.restored'), failed.length ? 'error' : 'info', 6000)
      void read(true)
    } catch (err) {
      busy.close()
      log(`Restore interrupted: ${err}`, 'error')
      await confirmSheet(t('slots.interruptedTitle'), t('slots.restoreInterrupted'), 'OK', t('common.cancel'))
    }
  }

  readBtn.addEventListener('click', () => void read())
  backupBtn.addEventListener('click', async () => {
    const s = await readSlotsWithUI()
    if (!s) return
    slots = s; drawSlots()
    await saveBackup(cameraService.model, s, false)
    toast(t('slots.backedUp'))
    void drawBackups()
  })

  const update = () => {
    const ready = cameraService.isReady
    readBtn.disabled = !ready
    backupBtn.disabled = !ready
    if (!cameraService.camera) { slots = []; drawSlots() }
  }
  update()
  void drawBackups()
  card.dispose = cameraService.subscribe(update)
  return card
}
