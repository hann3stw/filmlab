/**
 * The "Recipe" — one complete set of film-simulation settings.
 *
 * It is used everywhere: the editor's current settings, the settings a photo
 * was shot with ("as shot"), saved recipes (Phase 3) and camera slots.
 *
 * Values are stored in HUMAN units (e.g. highlight = +1.5, exposure = +2/3 EV).
 * Translating to the camera's byte encodings happens only at the edges
 * (toConversionParams below, and the slot writer in Phase 3).
 */

import { FilmSim, FilmSimLabels, MONOCHROME_SIMS, WBMode } from '../camera/profile/enums.ts'
import type { ConversionParams } from '../camera/profile/d185.ts'
import type { ExifData } from '../raw/raf.ts'
import { t, type Dict } from '../i18n/index.ts'

export type Strength = 'off' | 'weak' | 'strong'
export type GrainSize = 'small' | 'large'
export type DynamicRange = 'auto' | 100 | 200 | 400
export type DRangePriority = 'off' | 'auto' | 'weak' | 'strong'

export interface Recipe {
  filmSimulation: number     // FilmSim code, e.g. 0x0B = Classic Chrome
  exposure: number           // EV, in 1/3 steps (push/pull processing)
  dynamicRange: DynamicRange
  dRangePriority: DRangePriority
  whiteBalance: number       // WBMode code, e.g. 0x0002 = Auto
  wbColorTemp: number        // Kelvin, only used when whiteBalance = Kelvin
  wbShiftR: number           // -9 … +9
  wbShiftB: number           // -9 … +9
  highlight: number          // -2 … +4, 0.5 steps
  shadow: number             // -2 … +4, 0.5 steps
  color: number              // -4 … +4 (ignored for B&W film simulations)
  sharpness: number          // -4 … +4
  noiseReduction: number     // -4 … +4
  clarity: number            // -5 … +5
  grain: Strength
  grainSize: GrainSize
  colorChrome: Strength
  colorChromeBlue: Strength
}

/** Camera factory defaults (PROVIA, everything neutral). */
export const DEFAULT_RECIPE: Readonly<Recipe> = Object.freeze({
  filmSimulation: FilmSim.Provia,
  exposure: 0,
  dynamicRange: 100,
  dRangePriority: 'off',
  whiteBalance: WBMode.Auto,
  wbColorTemp: 5500,
  wbShiftR: 0,
  wbShiftB: 0,
  highlight: 0,
  shadow: 0,
  color: 0,
  sharpness: 0,
  noiseReduction: 0,
  clarity: 0,
  grain: 'off',
  grainSize: 'small',
  colorChrome: 'off',
  colorChromeBlue: 'off',
})

export type FieldKey = keyof Recipe

// ===========================================================================
// What the X-T30 III supports
// ---------------------------------------------------------------------------
// The camera refuses GetDevicePropDesc (tested 2026-11, fw 1.10), so it cannot
// tell us its allowed values. This table is based on the X-T30 III's menus and
// on the values seen in its custom slots.
// ===========================================================================

/** Film simulations in the order the camera menu shows them. */
export const FILM_SIMS: number[] = [
  FilmSim.Provia, FilmSim.Velvia, FilmSim.Astia, FilmSim.ClassicChrome, FilmSim.RealaAce,
  FilmSim.ProNegHi, FilmSim.ProNegStd, FilmSim.ClassicNeg, FilmSim.NostalgicNeg,
  FilmSim.Eterna, FilmSim.EternaBleach,
  FilmSim.Acros, FilmSim.AcrosYe, FilmSim.AcrosR, FilmSim.AcrosG,
  FilmSim.Monochrome, FilmSim.MonochromeYe, FilmSim.MonochromeR, FilmSim.MonochromeG,
  FilmSim.Sepia,
]

/** White balance modes, with the i18n key for their name. */
export const WB_MODES: { code: number; label: keyof Dict }[] = [
  { code: 0x8020, label: 'wb.autoWhite' },
  { code: WBMode.Auto, label: 'wb.auto' },
  { code: WBMode.AmbiencePriority, label: 'wb.autoAmbience' },
  { code: WBMode.ColorTemp, label: 'wb.kelvin' },
  { code: WBMode.Daylight, label: 'wb.daylight' },
  { code: WBMode.Shade, label: 'wb.shade' },
  { code: WBMode.Fluorescent1, label: 'wb.fluo1' },
  { code: WBMode.Fluorescent2, label: 'wb.fluo2' },
  { code: WBMode.Fluorescent3, label: 'wb.fluo3' },
  { code: WBMode.Incandescent, label: 'wb.incandescent' },
  { code: WBMode.Underwater, label: 'wb.underwater' },
]

/** Generate min…max in `step` increments, rounded to avoid 0.30000000004 */
function range(min: number, max: number, step: number): number[] {
  const out: number[] = []
  for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000)
  return out
}

// ===========================================================================
// Formatting values for display
// ===========================================================================

/** +2 / -1.5 / 0 */
export function signed(n: number): string {
  if (n === 0) return '0'
  return (n > 0 ? '+' : '−') + String(Math.abs(n))
}

/** Exposure as Fuji shows it: +1 1/3, −2/3, 0 */
export function formatEV(ev: number): string {
  const thirds = Math.round(ev * 3)
  if (thirds === 0) return '0'
  const sign = thirds > 0 ? '+' : '−'
  const whole = Math.floor(Math.abs(thirds) / 3)
  const rest = Math.abs(thirds) % 3
  const frac = rest ? `${rest}/3` : ''
  return sign + (whole ? String(whole) + (frac ? ' ' : '') : '') + frac
}

export function filmSimName(code: number): string {
  return (FilmSimLabels[code] ?? `#${code}`).replace(/\s*\(.*\)/, '')
}

export function wbName(code: number): string {
  const m = WB_MODES.find(w => w.code === code)
  return m ? t(m.label) : `0x${code.toString(16)}`
}

function strengthName(s: Strength): string {
  return t(`val.${s}`)
}

// ===========================================================================
// Field definitions — the editor's grid is generated from this list
// ===========================================================================

export interface FieldOption<V = unknown> { value: V; label: string }

export interface FieldDef {
  key: FieldKey
  label: keyof Dict
  /** All selectable values (computed, because some depend on the language) */
  options: () => FieldOption[]
  /** Short text for the tile */
  format: (r: Recipe) => string
  /** true = numeric steps (shown with − / + buttons and a slider) */
  numeric?: boolean
  /** Field is shown only if this returns true */
  visible?: (r: Recipe) => boolean
  /** Field cannot be changed right now (reason as i18n key) */
  lockedBy?: (r: Recipe) => keyof Dict | null
}

const num = (values: number[], fmt = signed): FieldOption[] => values.map(v => ({ value: v, label: fmt(v) }))
const strengths = (): FieldOption[] => (['off', 'weak', 'strong'] as Strength[]).map(s => ({ value: s, label: strengthName(s) }))

/** Tone settings are decided by the camera while D-Range Priority is on. */
const lockedByDrp = (r: Recipe): keyof Dict | null => (r.dRangePriority !== 'off' ? 'hint.drpLocks' : null)

export const FIELDS: FieldDef[] = [
  {
    key: 'filmSimulation', label: 'f.filmSimulation',
    options: () => FILM_SIMS.map(c => ({ value: c, label: filmSimName(c) })),
    format: r => filmSimName(r.filmSimulation),
  },
  {
    key: 'exposure', label: 'f.exposure', numeric: true,
    options: () => num(range(-2, 3, 1 / 3).map(v => Math.round(v * 3) / 3), formatEV),
    format: r => formatEV(r.exposure) + ' EV',
  },
  {
    key: 'whiteBalance', label: 'f.whiteBalance',
    options: () => WB_MODES.map(w => ({ value: w.code, label: t(w.label) })),
    format: r => wbName(r.whiteBalance),
  },
  {
    key: 'wbColorTemp', label: 'f.colorTemp', numeric: true,
    options: () => num(range(2500, 10000, 100), v => `${v} K`),
    format: r => `${r.wbColorTemp} K`,
    visible: r => r.whiteBalance === WBMode.ColorTemp,
  },
  { key: 'wbShiftR', label: 'f.wbShiftR', numeric: true, options: () => num(range(-9, 9, 1)), format: r => signed(r.wbShiftR) },
  { key: 'wbShiftB', label: 'f.wbShiftB', numeric: true, options: () => num(range(-9, 9, 1)), format: r => signed(r.wbShiftB) },
  {
    key: 'shadow', label: 'f.shadow', numeric: true, options: () => num(range(-2, 4, 0.5)),
    format: r => signed(r.shadow), lockedBy: lockedByDrp,
  },
  {
    key: 'highlight', label: 'f.highlight', numeric: true, options: () => num(range(-2, 4, 0.5)),
    format: r => signed(r.highlight), lockedBy: lockedByDrp,
  },
  {
    key: 'color', label: 'f.color', numeric: true, options: () => num(range(-4, 4, 1)),
    format: r => (MONOCHROME_SIMS.has(r.filmSimulation) ? '—' : signed(r.color)),
    lockedBy: r => (MONOCHROME_SIMS.has(r.filmSimulation) ? 'hint.monoNoColor' : null),
  },
  { key: 'colorChrome', label: 'f.colorChrome', options: strengths, format: r => strengthName(r.colorChrome) },
  { key: 'colorChromeBlue', label: 'f.colorChromeBlue', options: strengths, format: r => strengthName(r.colorChromeBlue) },
  { key: 'grain', label: 'f.grain', options: strengths, format: r => strengthName(r.grain) },
  {
    key: 'grainSize', label: 'f.grainSize',
    options: () => [{ value: 'small', label: t('val.small') }, { value: 'large', label: t('val.large') }],
    format: r => (r.grain === 'off' ? '—' : t(`val.${r.grainSize}`)),
    lockedBy: r => (r.grain === 'off' ? 'hint.grainOff' : null),
  },
  { key: 'sharpness', label: 'f.sharpness', numeric: true, options: () => num(range(-4, 4, 1)), format: r => signed(r.sharpness) },
  { key: 'noiseReduction', label: 'f.noiseReduction', numeric: true, options: () => num(range(-4, 4, 1)), format: r => signed(r.noiseReduction) },
  { key: 'clarity', label: 'f.clarity', numeric: true, options: () => num(range(-5, 5, 1)), format: r => signed(r.clarity) },
  {
    key: 'dynamicRange', label: 'f.dynamicRange',
    options: () => [
      { value: 'auto', label: t('val.auto') },
      { value: 100, label: 'DR100' }, { value: 200, label: 'DR200' }, { value: 400, label: 'DR400' },
    ],
    format: r => (r.dynamicRange === 'auto' ? t('val.auto') : `DR${r.dynamicRange}`),
    lockedBy: lockedByDrp,
  },
  {
    key: 'dRangePriority', label: 'f.dRangePriority',
    options: () => (['off', 'auto', 'weak', 'strong'] as DRangePriority[]).map(v => ({ value: v, label: t(`val.${v}`) })),
    format: r => t(`val.${r.dRangePriority}`),
  },
]

/** Settings the camera controls itself while D-Range Priority is on. */
export const TONE_FIELDS: FieldKey[] = ['highlight', 'shadow', 'dynamicRange']

/** Compact one-line summary: "CLASSIC CHROME · H −2 S −2 COLOR +4 · WB AUTO R +5 B −6" */
export function summarize(r: Recipe): string {
  const mono = MONOCHROME_SIMS.has(r.filmSimulation)
  const tones = `H ${signed(r.highlight)} S ${signed(r.shadow)}` + (mono ? '' : ` ${t('sum.color')} ${signed(r.color)}`)
  return [
    filmSimName(r.filmSimulation).toUpperCase(),
    tones,
    `WB ${wbName(r.whiteBalance).toUpperCase()} R ${signed(r.wbShiftR)} B ${signed(r.wbShiftB)}`,
  ].join(' · ')
}

export function recipesEqual(a: Recipe, b: Recipe): boolean {
  return (Object.keys(a) as FieldKey[]).every(k => a[k] === b[k])
}

// ===========================================================================
// EXIF (how the photo was shot) → Recipe
// Tag numbers: see raf.ts / ExifTool's FujiFilm documentation.
// ===========================================================================

const EXIF_FILM_MODE: Record<number, number> = {
  0x000: FilmSim.Provia, 0x200: FilmSim.Velvia, 0x400: FilmSim.Velvia, 0x120: FilmSim.Astia,
  0x500: FilmSim.ProNegStd, 0x501: FilmSim.ProNegHi, 0x600: FilmSim.ClassicChrome,
  0x700: FilmSim.Eterna, 0x800: FilmSim.ClassicNeg, 0x900: FilmSim.EternaBleach,
  0xA00: FilmSim.NostalgicNeg, 0xB00: FilmSim.RealaAce,
}
/** B&W film simulations are stored in the Saturation tag instead. */
const EXIF_MONO: Record<number, number> = {
  0x300: FilmSim.Monochrome, 0x301: FilmSim.MonochromeR, 0x302: FilmSim.MonochromeYe, 0x303: FilmSim.MonochromeG,
  0x310: FilmSim.Sepia, 0x500: FilmSim.Acros, 0x501: FilmSim.AcrosR, 0x502: FilmSim.AcrosYe, 0x503: FilmSim.AcrosG,
}
const EXIF_COLOR: Record<number, number> = {
  0x0: 0, 0x80: 1, 0x100: 2, 0xC0: 3, 0xE0: 4, 0x180: -1, 0x200: -2, 0x400: -2, 0x4C0: -3, 0x4E0: -4,
}
const EXIF_SHARPNESS: Record<number, number> = { 0: -4, 1: -3, 2: -2, 0x82: -1, 3: 0, 0x84: 1, 4: 2, 5: 3, 6: 4 }
const EXIF_NR: Record<number, number> = {
  0x0: 0, 0x180: 1, 0x100: 2, 0x1C0: 3, 0x1E0: 4, 0x280: -1, 0x200: -2, 0x2C0: -3, 0x2E0: -4,
}
const EXIF_WB: Record<number, number> = {
  0x0: WBMode.Auto, 0x1: 0x8020, 0x2: WBMode.AmbiencePriority, 0x100: WBMode.Daylight, 0x200: WBMode.Shade,
  0x300: WBMode.Fluorescent1, 0x301: WBMode.Fluorescent2, 0x302: WBMode.Fluorescent3,
  0x400: WBMode.Incandescent, 0x600: WBMode.Underwater, 0xFF0: WBMode.ColorTemp,
}
const EXIF_STRENGTH: Record<number, Strength> = { 0: 'off', 0x20: 'weak', 0x40: 'strong' }

export function recipeFromExif(exif: ExifData): Recipe {
  const f = exif.fuji
  const n = (tag: number): number | undefined => {
    const v = f.get(tag)
    return Array.isArray(v) && v.length ? v[0] : undefined
  }
  const r: Recipe = { ...DEFAULT_RECIPE }

  const sat = n(0x1003)
  const mode = n(0x1401)
  if (sat !== undefined && EXIF_MONO[sat] !== undefined) r.filmSimulation = EXIF_MONO[sat]
  else if (mode !== undefined && EXIF_FILM_MODE[mode] !== undefined) r.filmSimulation = EXIF_FILM_MODE[mode]
  if (sat !== undefined && EXIF_COLOR[sat] !== undefined) r.color = EXIF_COLOR[sat]

  const hl = n(0x1041); if (hl !== undefined) r.highlight = -hl / 16
  const sh = n(0x1040); if (sh !== undefined) r.shadow = -sh / 16
  const sp = n(0x1001); if (sp !== undefined && EXIF_SHARPNESS[sp] !== undefined) r.sharpness = EXIF_SHARPNESS[sp]
  const nr = n(0x100E); if (nr !== undefined && EXIF_NR[nr] !== undefined) r.noiseReduction = EXIF_NR[nr]
  const cl = n(0x100F); if (cl !== undefined) r.clarity = Math.round(cl / 1000)

  const wb = n(0x1002); if (wb !== undefined && EXIF_WB[wb] !== undefined) r.whiteBalance = EXIF_WB[wb]
  const ct = n(0x1005); if (ct !== undefined && ct > 0) r.wbColorTemp = ct
  const ft = f.get(0x100A)
  if (Array.isArray(ft) && ft.length >= 2) { r.wbShiftR = Math.round(ft[0] / 20); r.wbShiftB = Math.round(ft[1] / 20) }

  const gr = n(0x1047); if (gr !== undefined) r.grain = EXIF_STRENGTH[gr] ?? 'off'
  const gs = n(0x104C); if (gs !== undefined) r.grainSize = gs === 0x20 ? 'large' : 'small'
  const cc = n(0x1048); if (cc !== undefined) r.colorChrome = EXIF_STRENGTH[cc] ?? 'off'
  const cb = n(0x104E); if (cb !== undefined) r.colorChromeBlue = EXIF_STRENGTH[cb] ?? 'off'

  // Dynamic range: 0x1402 = setting (0 = Auto), 0x1403 = value actually used.
  const drSet = n(0x1402)
  const drDev = n(0x1403)
  if (drSet === 0) r.dynamicRange = 'auto'
  else if (drDev === 100 || drDev === 200 || drDev === 400) r.dynamicRange = drDev
  else r.dynamicRange = 'auto'

  // D-Range Priority: 0x1443 present → on (0 = Auto, 1 = Fixed + strength in 0x1445)
  const drp = n(0x1443)
  if (drp === 0) r.dRangePriority = 'auto'
  else if (drp === 1) r.dRangePriority = n(0x1445) === 2 ? 'strong' : 'weak'

  return r
}

// ===========================================================================
// Recipe → D185 conversion parameters
// ===========================================================================

const STRENGTH_IDX: Record<Strength, number> = { off: 0, weak: 1, strong: 2 }
const DRP_CODE: Record<DRangePriority, number> = { off: 0, auto: 1, weak: 2, strong: 3 }

/**
 * Build the parameters for patchProfile().
 *
 * If `asShot` is given, only settings that DIFFER from it are included. All
 * other fields of the camera's profile stay untouched ("as shot"), so an
 * unchanged recipe renders exactly like the camera's own JPEG.
 */
export function toConversionParams(r: Recipe, asShot?: Recipe): ConversionParams {
  const changed = (...keys: FieldKey[]) => !asShot || keys.some(k => r[k] !== asShot[k])
  const p: ConversionParams = {}
  const mono = MONOCHROME_SIMS.has(r.filmSimulation)

  if (changed('filmSimulation')) p.filmSimulation = r.filmSimulation
  if (changed('exposure')) p.exposureBias = Math.round(r.exposure * 1000) // millistops, 2/3 → 667
  if (changed('dRangePriority')) p.wideDRange = DRP_CODE[r.dRangePriority]

  if (r.dRangePriority === 'off') {
    if (changed('dynamicRange', 'dRangePriority') && r.dynamicRange !== 'auto') {
      p.dynamicRange = r.dynamicRange === 100 ? 1 : r.dynamicRange === 200 ? 2 : 3
    }
    if (changed('highlight', 'dRangePriority')) p.highlightTone = r.highlight
    if (changed('shadow', 'dRangePriority')) p.shadowTone = r.shadow
    // Tone values are IGNORED by the camera while D-Range Priority is active —
    // and the EXIF doesn't always tell us that it was on. So whenever we send
    // tone values, we also send "D-Range Priority: off" explicitly.
    if (p.highlightTone !== undefined || p.shadowTone !== undefined || p.dynamicRange !== undefined) {
      p.wideDRange = 0
    }
  }

  if (changed('whiteBalance', 'wbColorTemp')) {
    p.whiteBalance = r.whiteBalance
    if (r.whiteBalance === WBMode.ColorTemp) p.wbColorTemp = r.wbColorTemp
  }
  if (changed('wbShiftR', 'wbShiftB', 'whiteBalance')) { p.wbShiftR = r.wbShiftR; p.wbShiftB = r.wbShiftB }

  if (!mono && changed('color', 'filmSimulation')) p.color = r.color
  if (changed('sharpness')) p.sharpness = r.sharpness
  if (changed('noiseReduction')) p.noiseReduction = r.noiseReduction
  if (changed('clarity')) p.clarity = r.clarity

  if (changed('grain', 'grainSize')) {
    // Combined encoding: low byte = strength (0/2/3), high byte = size (0 small / 1 large)
    p.grainEffect = r.grain === 'off' ? 0 : (r.grain === 'weak' ? 2 : 3) | (r.grainSize === 'large' ? 0x100 : 0)
  }
  if (changed('colorChrome')) p.colorChromeEffect = STRENGTH_IDX[r.colorChrome]
  if (changed('colorChromeBlue')) p.colorChromeFxBlue = STRENGTH_IDX[r.colorChromeBlue]
  return p
}
