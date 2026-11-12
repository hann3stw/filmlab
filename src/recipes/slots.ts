/**
 * Camera custom slots (C1…C7): reading, writing, backup and restore.
 *
 * A slot stores a name + 24 properties (see docs/how-it-works.md). This file
 * translates between our Recipe and the slot's raw property bytes, using
 * FilmKit's translation tables, and adds the safety net around writing:
 *
 *   backup (before the very first write) → write → read back → compare
 *
 * NOT stored in a slot (camera limitation of this property set): exposure
 * compensation and D-Range Priority. They are simply left out.
 */

import type { FujiCamera, PresetData, RawProp } from '../camera/ptp/session.ts'
import { translatePresetToUI, translateUIToPresetProps, PRESET_DEFAULTS, type PresetUIValues } from '../camera/profile/preset-translate.ts'
import { MONOCHROME_SIMS, WBMode } from '../camera/profile/enums.ts'
import { packU16 } from '../camera/util/binary.ts'
import { dbGet, dbPut } from '../storage/db.ts'
import { DEFAULT_RECIPE, FIELDS, type FieldKey, type Recipe, type Strength } from './recipe.ts'
import { log } from '../ui/debug-log.ts'

/** Longest slot name the camera's menu accepts. */
export const SLOT_NAME_MAX = 25

/** Recipe fields that a slot can hold (everything except these two). */
export const SLOT_FIELDS: FieldKey[] = FIELDS.map(f => f.key).filter(k => k !== 'exposure' && k !== 'dRangePriority')

const STRENGTHS: Strength[] = ['off', 'weak', 'strong']

/**
 * Make a recipe name safe for the camera: plain ASCII only (the camera's
 * keyboard has no umlauts/emoji), at most SLOT_NAME_MAX characters.
 */
export function slotName(name: string): string {
  const map: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', '’': "'", '–': '-', '—': '-' }
  return name
    .replace(/[äöüÄÖÜß’–—]/g, c => map[c])
    .normalize('NFKD').replace(/[^\x20-\x7E]/g, '') // drop everything that isn't printable ASCII
    .replace(/\s+/g, ' ').trim()
    .slice(0, SLOT_NAME_MAX).trim()
}

/** Raw slot properties → Recipe */
export function slotToRecipe(p: PresetData): Recipe {
  const v = translatePresetToUI(p.settings)
  const dr = p.settings.find(s => s.id === 0xD190)?.value
  return {
    ...DEFAULT_RECIPE,
    filmSimulation: v.filmSimulation || DEFAULT_RECIPE.filmSimulation,
    dynamicRange: dr === 100 || dr === 200 || dr === 400 ? dr : 'auto', // 0xFFFF = Auto
    whiteBalance: v.whiteBalance || WBMode.Auto,
    wbColorTemp: v.wbColorTemp,
    wbShiftR: v.wbShiftR, wbShiftB: v.wbShiftB,
    highlight: v.highlightTone, shadow: v.shadowTone, color: v.color,
    sharpness: v.sharpness, noiseReduction: v.noiseReduction, clarity: v.clarity,
    grain: v.grainEffect === 0 ? 'off' : (v.grainEffect & 0xFF) === 2 ? 'weak' : 'strong',
    grainSize: v.grainEffect & 0x100 ? 'large' : 'small',
    colorChrome: STRENGTHS[v.colorChrome] ?? 'off',
    colorChromeBlue: STRENGTHS[v.colorChromeFxBlue] ?? 'off',
  }
}

/**
 * Recipe → raw slot properties, in the order they must be written.
 * `base` = the slot's current properties: values we don't control (image
 * size, quality, smooth skin, color space …) are copied from there.
 */
export function recipeToSlotProps(r: Recipe, base: RawProp[]): RawProp[] {
  const baseUI = translatePresetToUI(base)
  const ui: PresetUIValues = {
    ...PRESET_DEFAULTS,
    filmSimulation: r.filmSimulation,
    dynamicRange: r.dynamicRange === 100 ? 1 : r.dynamicRange === 200 ? 2 : r.dynamicRange === 400 ? 3 : 0,
    grainEffect: r.grain === 'off' ? 0 : (r.grain === 'weak' ? 2 : 3) | (r.grainSize === 'large' ? 0x100 : 0),
    smoothSkin: baseUI.smoothSkin,
    colorChrome: STRENGTHS.indexOf(r.colorChrome),
    colorChromeFxBlue: STRENGTHS.indexOf(r.colorChromeBlue),
    whiteBalance: r.whiteBalance,
    wbShiftR: r.wbShiftR, wbShiftB: r.wbShiftB, wbColorTemp: r.wbColorTemp,
    highlightTone: r.highlight, shadowTone: r.shadow, color: r.color,
    sharpness: r.sharpness, noiseReduction: r.noiseReduction, clarity: r.clarity,
    monoWC: baseUI.monoWC, monoMG: baseUI.monoMG,
  }
  const props = translateUIToPresetProps(ui, base)
  // FilmKit has no "DR Auto": the camera stores it as 0xFFFF (seen in slot C2).
  if (r.dynamicRange === 'auto') {
    const dr = props.find(p => p.id === 0xD190)
    if (dr) dr.bytes = packU16(0xFFFF)
  }
  return props
}

/** Which slot-relevant fields differ between two recipes? */
export function slotDiff(a: Recipe, b: Recipe): FieldKey[] {
  return SLOT_FIELDS.filter(k => {
    if (k === 'wbColorTemp') return b.whiteBalance === WBMode.ColorTemp && a[k] !== b[k]
    if (k === 'color') return !MONOCHROME_SIMS.has(b.filmSimulation) && a[k] !== b[k]
    if (k === 'grainSize') return b.grain !== 'off' && a[k] !== b[k]
    return a[k] !== b[k]
  })
}

// ---------------------------------------------------------------------------
// Reading / writing on the camera
// ---------------------------------------------------------------------------

export async function readSlots(cam: FujiCamera): Promise<PresetData[]> {
  const slots = await cam.scanPresets()
  if (!slots.length) throw new Error('no-slots')
  return slots
}

export interface WriteResult { ok: boolean; verified: boolean; warnings: string[]; mismatches: FieldKey[] }

/**
 * Write a recipe into slot `slot` and verify it by reading the slot back.
 * `current` = the slot as it is now (from readSlots).
 */
export async function writeRecipeToSlot(cam: FujiCamera, current: PresetData, name: string, recipe: Recipe): Promise<WriteResult> {
  const props = recipeToSlotProps(recipe, current.settings)
  const safeName = slotName(name) || `C${current.slot}`
  log(`Writing slot C${current.slot}: "${safeName}" (${props.length} properties)`)
  const res = await cam.writePreset(current.slot, safeName, props)
  for (const w of res.warnings) log(`  slot write: ${w}`, 'warn')
  if (!res.ok) return { ok: false, verified: false, warnings: res.warnings, mismatches: [] }

  // Read everything back and compare in "human" values
  const after = (await cam.scanPresets()).find(s => s.slot === current.slot)
  if (!after) return { ok: true, verified: false, warnings: res.warnings, mismatches: [] }
  const mismatches = slotDiff(slotToRecipe(after), recipe)
  const nameOk = after.name === safeName
  if (!nameOk) log(`  slot name read back as "${after.name}"`, 'warn')
  log(mismatches.length ? `  verify: differs in ${mismatches.join(', ')}` : '  verify: slot matches recipe', mismatches.length ? 'warn' : 'ok')
  return { ok: true, verified: nameOk && mismatches.length === 0, warnings: res.warnings, mismatches }
}

// ---------------------------------------------------------------------------
// Backup / restore
// ---------------------------------------------------------------------------

export interface SlotBackup {
  id: string
  createdAt: number
  model: string
  /** true = made automatically before the first write */
  auto: boolean
  slots: { slot: number; name: string; settings: { id: number; bytes: number[] }[] }[]
}

const BACKUP_KEY = 'slotBackups'

export async function listBackups(): Promise<SlotBackup[]> {
  return (await dbGet<SlotBackup[]>('kv', BACKUP_KEY)) ?? []
}

/** Store a snapshot of all slots. Keeps the first automatic backup forever, plus the 4 newest. */
export async function saveBackup(model: string, slots: PresetData[], auto: boolean): Promise<SlotBackup> {
  const backup: SlotBackup = {
    id: Date.now().toString(36), createdAt: Date.now(), model, auto,
    slots: slots.map(s => ({ slot: s.slot, name: s.name, settings: s.settings.map(p => ({ id: p.id, bytes: Array.from(p.bytes) })) })),
  }
  const all = await listBackups()
  const first = all.find(b => b.auto)
  const rest = [backup, ...all.filter(b => b !== first)].slice(0, 4)
  await dbPut('kv', first ? [...rest, first] : rest, BACKUP_KEY)
  log(`Slot backup saved (${slots.length} slots${auto ? ', automatic' : ''})`, 'ok')
  return backup
}

/** Make the automatic backup if there is none yet. Call before ANY write. */
export async function ensureFirstBackup(model: string, slots: PresetData[]): Promise<boolean> {
  if ((await listBackups()).some(b => b.auto)) return false
  await saveBackup(model, slots, true)
  return true
}

/**
 * Bring raw backup properties into a writable order:
 *  - color temperature (D19C) must directly follow the WB mode (D199) and is
 *    only accepted in Kelvin mode
 *  - mono warm/cool + magenta/green (D193/D194) are rejected when 0
 *  - color (D19F) is rejected for black & white film simulations
 */
function orderForWrite(settings: { id: number; bytes: number[] }[]): RawProp[] {
  const u16 = (id: number) => { const s = settings.find(x => x.id === id); return s ? s.bytes[0] | (s.bytes[1] << 8) : 0 }
  const kelvin = u16(0xD199) === WBMode.ColorTemp
  const mono = MONOCHROME_SIMS.has(u16(0xD192))
  const out: RawProp[] = []
  for (const s of settings) {
    if (s.id === 0xD19C) continue
    if ((s.id === 0xD193 || s.id === 0xD194) && u16(s.id) === 0) continue
    if (s.id === 0xD19F && mono) continue
    out.push({ id: s.id, name: '', bytes: new Uint8Array(s.bytes), value: 0 })
    if (s.id === 0xD199 && kelvin) {
      const ct = settings.find(x => x.id === 0xD19C)
      if (ct) out.push({ id: 0xD19C, name: '', bytes: new Uint8Array(ct.bytes), value: 0 })
    }
  }
  return out
}

/** Write a backup back to the camera. Returns the slots that failed. */
export async function restoreBackup(cam: FujiCamera, backup: SlotBackup, onProgress?: (done: number, total: number) => void): Promise<number[]> {
  const failed: number[] = []
  for (let i = 0; i < backup.slots.length; i++) {
    const s = backup.slots[i]
    onProgress?.(i, backup.slots.length)
    log(`Restoring slot C${s.slot}: "${s.name}"`)
    const res = await cam.writePreset(s.slot, s.name, orderForWrite(s.settings))
    for (const w of res.warnings) log(`  restore C${s.slot}: ${w}`, 'warn')
    if (!res.ok) failed.push(s.slot)
  }
  onProgress?.(backup.slots.length, backup.slots.length)
  return failed
}
