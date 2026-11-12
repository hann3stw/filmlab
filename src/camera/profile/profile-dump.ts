/**
 * FilmLab diagnostic: take the D185 conversion profile apart, so we can check
 * which field means what on THIS camera.
 *
 * Layout:  u16 numParams | PTP string "IOP code" (processor id) | padding |
 *          numParams × int32 parameters at the very end.
 *
 * Two references disagree about the parameter order:
 *   - FilmKit (tested on X100VI):  FilmSimulation at index 8, Highlight at 16, …
 *   - rawji   (tested on X-T30):   FilmSimulation at index 7, Highlight at 15, …
 * The X-T30 III answer decides which table the editor uses.
 */

import { parsePTPStringRaw } from '../util/binary.ts'

/** FilmKit's NativeIdx (see d185.ts), index → name */
const FILMKIT_NAMES: Record<number, string> = {
  // FilmLab: corrected for the X-T30 III (tests 2026-11): 3/4/5/11 below
  3: 'ImageSize', 4: 'ImageQuality', 5: 'ExposureBias', 11: 'WBShootCond(1=as shot)', 6: 'DynamicRange%', 7: 'WideDRange', 8: 'FilmSimulation', 9: 'Grain',
  10: 'ColorChrome', 12: 'WhiteBalance', 13: 'WBShiftR', 14: 'WBShiftB',
  15: 'WBColorTemp', 16: 'Highlight×10', 17: 'Shadow×10', 18: 'Color×10', 19: 'Sharpness×10',
  20: 'NoiseReduction', 25: 'CCFxBlue', 27: 'Clarity×10',
}

/** rawji's PARAM_INDEX (fuji_profile.py), index → name */
const RAWJI_NAMES: Record<number, string> = {
  0: 'ShootingCondition', 1: 'FileType', 2: 'ImageSize', 3: 'ImageQuality', 4: 'ExposureBias',
  5: 'DynamicRange', 6: 'WideDRange', 7: 'FilmSimulation', 8: 'GrainEffect', 9: 'ColorChrome',
  10: 'WBShootCond', 11: 'WhiteBalance', 12: 'WBShiftR', 13: 'WBShiftB', 14: 'WBColorTemp',
  15: 'Highlight×10', 16: 'Shadow×10', 17: 'Color×10', 18: 'Sharpness×10', 19: 'NoiseReduction',
  20: 'Reserved20', 21: 'ColorSpace', 22: 'BlackImageTone', 23: 'SmoothSkin', 24: 'CCFxBlue',
  25: 'MonoColorRG', 26: 'Clarity×10', 27: 'Reserved27', 28: 'Reserved28',
}

export interface ProfileDump {
  totalBytes: number
  numParams: number
  iopCode: string
  paramsOffset: number
  params: { index: number; value: number; filmkit: string; rawji: string }[]
}

export function dumpProfile(profile: Uint8Array): ProfileDump {
  const dv = new DataView(profile.buffer, profile.byteOffset, profile.byteLength)
  const numParams = dv.getUint16(0, true)
  const iopCode = parsePTPStringRaw(profile.subarray(2))
  const paramsOffset = profile.length - numParams * 4
  const params = []
  for (let i = 0; i < numParams; i++) {
    params.push({
      index: i,
      value: dv.getInt32(paramsOffset + i * 4, true),
      filmkit: FILMKIT_NAMES[i] ?? '',
      rawji: RAWJI_NAMES[i] ?? '',
    })
  }
  return { totalBytes: profile.length, numParams, iopCode, paramsOffset, params }
}

/**
 * Write raw int32 values into specific parameter indices (diagnostic tests only).
 * Returns a patched COPY; the original stays untouched.
 */
export function patchIndices(base: Uint8Array, changes: Record<number, number>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(base.length) as Uint8Array<ArrayBuffer>
  out.set(base)
  const dv = new DataView(out.buffer)
  const numParams = dv.getUint16(0, true)
  const off = out.length - numParams * 4
  for (const [idx, val] of Object.entries(changes)) {
    dv.setInt32(off + Number(idx) * 4, val, true)
  }
  return out
}
