/**
 * Reading information out of a Fujifilm .RAF file — WITHOUT developing it.
 *
 * A RAF file contains three things:
 *   1. a small header (camera name, where the other parts are)
 *   2. an embedded, ready-made JPEG preview (the one the camera shows on its
 *      screen) — including EXIF metadata such as the date and the film
 *      simulation used
 *   3. the actual raw sensor data (which only the camera develops for us)
 *
 * We use (2) for thumbnails and to know which settings the photo was shot with.
 *
 * RAF header layout (all numbers big-endian):
 *   0   "FUJIFILMCCD-RAW " (16 bytes)
 *   28  camera model name (32 bytes, zero padded)
 *   84  u32 offset of the embedded JPEG
 *   88  u32 length of the embedded JPEG
 */

export interface RafInfo {
  cameraName: string
  /** The embedded JPEG preview (a view into the original buffer, no copy) */
  previewJpeg: Uint8Array
  exif: ExifData
}

export interface ExifData {
  make?: string
  model?: string
  /** "2026:11:11 14:03:22" (EXIF format) */
  dateTimeOriginal?: string
  /** Raw Fujifilm MakerNote tags: tag number → numeric value(s) or text */
  fuji: Map<number, number[] | string>
}

const RAF_MAGIC = 'FUJIFILMCCD-RAW'

export function isRaf(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 100) return false
  const head = new Uint8Array(buf, 0, RAF_MAGIC.length)
  return String.fromCharCode(...head) === RAF_MAGIC
}

/** Parse the RAF header and the EXIF of the embedded JPEG. Throws on bad files. */
export function parseRaf(buf: ArrayBuffer): RafInfo {
  if (!isRaf(buf)) throw new Error('Not a RAF file')
  const dv = new DataView(buf)
  const nameBytes = new Uint8Array(buf, 28, 32)
  const cameraName = String.fromCharCode(...nameBytes).replace(/\0.*$/s, '').trim()

  const jpegOffset = dv.getUint32(84, false)
  const jpegLength = dv.getUint32(88, false)
  if (jpegOffset + jpegLength > buf.byteLength) throw new Error('RAF: embedded JPEG out of range')
  const previewJpeg = new Uint8Array(buf, jpegOffset, jpegLength)

  return { cameraName, previewJpeg, exif: parseJpegExif(previewJpeg) }
}

// ---------------------------------------------------------------------------
// JPEG → EXIF (TIFF structure) → Fujifilm MakerNote
// ---------------------------------------------------------------------------

/** Find the APP1 "Exif" segment in a JPEG and parse it. */
export function parseJpegExif(jpeg: Uint8Array): ExifData {
  const out: ExifData = { fuji: new Map() }
  const dv = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength)
  if (dv.getUint16(0) !== 0xFFD8) return out // not a JPEG (no "Start Of Image")

  // A JPEG is a list of segments: FF xx, then a 2-byte big-endian length.
  let p = 2
  while (p + 4 <= jpeg.length) {
    if (jpeg[p] !== 0xFF) break
    const marker = jpeg[p + 1]
    const len = dv.getUint16(p + 2)
    if (marker === 0xE1 && String.fromCharCode(...jpeg.subarray(p + 4, p + 8)) === 'Exif') {
      const tiffStart = p + 10 // after "Exif\0\0"
      parseTiff(jpeg.subarray(tiffStart, p + 2 + len), out)
      break
    }
    if (marker === 0xDA) break // image data starts — no EXIF found
    p += 2 + len
  }
  return out
}

/** Size in bytes of one value of each TIFF data type. */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 }

interface IfdEntry { tag: number; type: number; count: number; valueOffset: number }

/** Read the entries of one IFD ("image file directory" = a list of tags). */
function readIfd(dv: DataView, offset: number, le: boolean): IfdEntry[] {
  if (offset + 2 > dv.byteLength) return []
  const n = dv.getUint16(offset, le)
  const entries: IfdEntry[] = []
  for (let i = 0; i < n; i++) {
    const e = offset + 2 + i * 12
    if (e + 12 > dv.byteLength) break
    const tag = dv.getUint16(e, le)
    const type = dv.getUint16(e + 2, le)
    const count = dv.getUint32(e + 4, le)
    const size = (TYPE_SIZE[type] ?? 1) * count
    // Values of 4 bytes or less are stored directly in the entry.
    const valueOffset = size <= 4 ? e + 8 : dv.getUint32(e + 8, le)
    entries.push({ tag, type, count, valueOffset })
  }
  return entries
}

/**
 * Read an entry's value(s) as numbers or as text.
 * Offsets are relative to the start of `dv` (the TIFF block, or the MakerNote).
 */
function readValue(dv: DataView, e: IfdEntry, le: boolean): number[] | string {
  const off = e.valueOffset
  const size = (TYPE_SIZE[e.type] ?? 1) * e.count
  if (off + Math.min(size, 64 * 8) > dv.byteLength) return []
  if (e.type === 2) {
    let s = ''
    for (let i = 0; i < e.count && off + i < dv.byteLength; i++) {
      const c = dv.getUint8(off + i)
      if (c === 0) break
      s += String.fromCharCode(c)
    }
    return s.trim()
  }
  const vals: number[] = []
  const n = Math.min(e.count, 64)
  for (let i = 0; i < n; i++) {
    switch (e.type) {
      case 1: case 7: vals.push(dv.getUint8(off + i)); break
      case 6: vals.push(dv.getInt8(off + i)); break
      case 3: vals.push(dv.getUint16(off + i * 2, le)); break
      case 8: vals.push(dv.getInt16(off + i * 2, le)); break
      case 4: vals.push(dv.getUint32(off + i * 4, le)); break
      case 9: vals.push(dv.getInt32(off + i * 4, le)); break
      case 5: vals.push(dv.getUint32(off + i * 8, le) / (dv.getUint32(off + i * 8 + 4, le) || 1)); break
      case 10: vals.push(dv.getInt32(off + i * 8, le) / (dv.getInt32(off + i * 8 + 4, le) || 1)); break
    }
  }
  return vals
}

function parseTiff(tiff: Uint8Array, out: ExifData): void {
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const le = dv.getUint16(0) === 0x4949 // "II" = little-endian, "MM" = big-endian
  const ifd0 = readIfd(dv, dv.getUint32(4, le), le)

  for (const e of ifd0) {
    if (e.tag === 0x010F) out.make = readValue(dv, e, le) as string
    if (e.tag === 0x0110) out.model = readValue(dv, e, le) as string
  }
  const exifPtr = ifd0.find(e => e.tag === 0x8769)
  if (!exifPtr) return
  const exifIfd = readIfd(dv, (readValue(dv, exifPtr, le) as number[])[0], le)

  for (const e of exifIfd) {
    if (e.tag === 0x9003) out.dateTimeOriginal = readValue(dv, e, le) as string
    if (e.tag === 0x927C) {
      // Fujifilm MakerNote: "FUJIFILM" + u32 offset of its IFD. Always
      // little-endian, and all offsets inside are relative to its own start.
      const mnStart = e.valueOffset
      const mn = new DataView(tiff.buffer, tiff.byteOffset + mnStart, Math.min(e.count, tiff.byteLength - mnStart))
      const sig = String.fromCharCode(...tiff.subarray(mnStart, mnStart + 8))
      if (sig !== 'FUJIFILM') continue
      const ifdOff = mn.getUint32(8, true)
      for (const fe of readIfd(mn, ifdOff, true)) {
        out.fuji.set(fe.tag, readValue(mn, fe, true))
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Human-readable decoding of the most important Fujifilm MakerNote tags.
// Tag numbers and values follow ExifTool's FujiFilm tag documentation.
// ---------------------------------------------------------------------------

const FILM_MODE: Record<number, string> = {
  0x000: 'Provia', 0x100: 'Studio Portrait', 0x110: 'Studio Portrait Enh. Sat.', 0x120: 'Astia',
  0x130: 'Studio Portrait Inc. Sharp.', 0x200: 'Velvia (F2)', 0x300: 'Studio Portrait Ex', 0x400: 'Velvia',
  0x500: 'Pro Neg. Std', 0x501: 'Pro Neg. Hi', 0x600: 'Classic Chrome', 0x700: 'Eterna',
  0x800: 'Classic Neg.', 0x900: 'Eterna Bleach Bypass', 0xA00: 'Nostalgic Neg.', 0xB00: 'Reala Ace',
}
/** Saturation tag also tells B&W film simulations apart. */
const SATURATION: Record<number, string> = {
  0x0: '0', 0x80: '+1', 0x100: '+2', 0xC0: '+3', 0xE0: '+4', 0x180: '-1', 0x200: 'Low', 0x400: '-2', 0x4C0: '-3', 0x4E0: '-4',
  0x300: 'B&W', 0x301: 'B&W Red', 0x302: 'B&W Yellow', 0x303: 'B&W Green', 0x310: 'Sepia',
  0x500: 'Acros', 0x501: 'Acros Red', 0x502: 'Acros Yellow', 0x503: 'Acros Green', 0x8000: 'Film Simulation',
}
const SHARPNESS: Record<number, string> = {
  0: '-4', 1: '-3', 2: '-2', 0x82: '-1', 3: '0', 0x84: '+1', 4: '+2', 5: '+3', 6: '+4', 0x8000: 'Film Simulation',
}
const WHITE_BALANCE: Record<number, string> = {
  0x0: 'Auto', 0x1: 'Auto (white priority)', 0x2: 'Auto (ambience priority)', 0x100: 'Daylight', 0x200: 'Cloudy/Shade',
  0x300: 'Daylight Fluorescent', 0x301: 'Day White Fluorescent', 0x302: 'White Fluorescent', 0x400: 'Incandescent',
  0x600: 'Underwater', 0xF00: 'Custom', 0xF01: 'Custom 2', 0xF02: 'Custom 3', 0xFF0: 'Kelvin',
}
const NOISE_REDUCTION: Record<number, string> = {
  0x0: '0', 0x180: '+1', 0x100: '+2', 0x1C0: '+3', 0x1E0: '+4', 0x280: '-1', 0x200: '-2', 0x2C0: '-3', 0x2E0: '-4',
}
const OFF_WEAK_STRONG: Record<number, string> = { 0: 'Off', 0x20: 'Weak', 0x40: 'Strong' }
const GRAIN_SIZE: Record<number, string> = { 0: 'Off', 0x10: 'Small', 0x20: 'Large' }
const DR_SETTING: Record<number, string> = {
  0: 'Auto', 1: 'Manual', 0x100: 'Standard (100%)', 0x200: 'Wide 1 (200%)', 0x201: 'Wide 2 (400%)', 0x8000: 'Film Simulation',
}

/** Format a tone value stored as -16 × tone (e.g. -32 → "+2"). */
function tone(v: number): string {
  const t = -v / 16
  return (t > 0 ? '+' : '') + t
}

/** Decoded list of the recipe-relevant MakerNote tags: [label, value, raw]. */
export function describeFujiExif(exif: ExifData): [string, string, string][] {
  const f = exif.fuji
  const rows: [string, string, string][] = []
  const num = (tag: number): number | undefined => {
    const v = f.get(tag)
    return Array.isArray(v) && v.length ? v[0] : undefined
  }
  const add = (label: string, tag: number, decode: (v: number) => string) => {
    const v = num(tag)
    if (v !== undefined) rows.push([label, decode(v), `0x${tag.toString(16)}=0x${(v >>> 0).toString(16)}`])
  }
  add('Film mode', 0x1401, v => FILM_MODE[v] ?? '?')
  add('Saturation/Color', 0x1003, v => SATURATION[v] ?? '?')
  add('Highlight', 0x1041, tone)
  add('Shadow', 0x1040, tone)
  add('Sharpness', 0x1001, v => SHARPNESS[v] ?? '?')
  add('Clarity', 0x100F, v => String(v / 1000))
  add('High ISO NR', 0x100E, v => NOISE_REDUCTION[v] ?? `raw ${v}`)
  add('White balance', 0x1002, v => WHITE_BALANCE[v] ?? '?')
  add('Color temp', 0x1005, v => `${v} K`)
  const ft = f.get(0x100A)
  if (Array.isArray(ft) && ft.length >= 2) {
    rows.push(['WB fine tune', `R ${ft[0] / 20} B ${ft[1] / 20}`, `0x100a=[${ft.join(', ')}]`])
  }
  add('Grain roughness', 0x1047, v => OFF_WEAK_STRONG[v] ?? '?')
  add('Grain size', 0x104C, v => GRAIN_SIZE[v] ?? '?')
  add('Color Chrome', 0x1048, v => OFF_WEAK_STRONG[v] ?? '?')
  add('CC FX Blue', 0x104E, v => OFF_WEAK_STRONG[v] ?? '?')
  add('DR setting', 0x1402, v => DR_SETTING[v] ?? '?')
  add('Development DR', 0x1403, v => `${v}%`)
  add('D-Range Priority', 0x1443, v => (v === 0 ? 'Auto' : v === 1 ? 'Fixed' : '?'))
  add('DRP strength (auto)', 0x1444, v => (v === 1 ? 'Weak' : v === 2 ? 'Strong' : '?'))
  add('DRP strength (fixed)', 0x1445, v => (v === 1 ? 'Weak' : v === 2 ? 'Strong' : '?'))
  add('Mono warm/cool', 0x1049, v => String(v))
  add('Mono magenta/green', 0x104B, v => String(v))
  return rows
}
