/**
 * "Recipe card": a shareable picture with a photo and all settings of a
 * recipe, drawn on a <canvas> (1080 × 1350 px — the portrait format social
 * apps like best).
 */

import { FIELDS, filmSimName, type Recipe } from './recipe.ts'
import { t } from '../i18n/index.ts'

const W = 1080, H = 1350
const PAPER = '#EFE7D6', INK = '#2A2A22', SOFT = '#6A6555', OLIVE = '#3B4527', LINE = 'rgba(42,42,34,0.18)'

export async function renderRecipeCard(name: string, recipe: Recipe, photo: Blob | null): Promise<Blob> {
  // Make sure our fonts are ready, otherwise canvas falls back to defaults
  await Promise.all([
    document.fonts.load('500 64px Fraunces'), document.fonts.load('400 22px "IBM Plex Mono"'),
  ]).catch(() => {})

  const canvas = new OffscreenCanvas(W, H)
  const c = canvas.getContext('2d')!
  c.fillStyle = PAPER
  c.fillRect(0, 0, W, H)

  // ---- photo (top), cropped to fill ("cover") ----
  const M = 56 // margin
  let y = M
  if (photo) {
    const bmp = await createImageBitmap(photo, { imageOrientation: 'from-image' })
    const boxW = W - 2 * M, boxH = 620
    const scale = Math.max(boxW / bmp.width, boxH / bmp.height)
    const sw = boxW / scale, sh = boxH / scale
    c.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, M, y, boxW, boxH)
    bmp.close()
    y += boxH + 56
  } else {
    y += 40
  }

  // ---- title ----
  c.fillStyle = SOFT
  c.font = '400 22px "IBM Plex Mono"'
  c.fillText(spaced(filmSimName(recipe.filmSimulation).toUpperCase()), M, y)
  y += 70
  c.fillStyle = INK
  c.font = '500 68px Fraunces'
  c.fillText(fit(c, name, W - 2 * M), M, y)
  y += 36
  c.fillStyle = LINE
  c.fillRect(M, y, W - 2 * M, 2)
  y += 20

  // ---- settings in two columns ----
  const rows = FIELDS.filter(f => f.key !== 'filmSimulation' && (!f.visible || f.visible(recipe)))
  const perCol = Math.ceil(rows.length / 2)
  const colW = (W - 2 * M - 48) / 2
  const rowH = Math.min(photo ? 52 : 92, (H - y - 110) / perCol) // more air when there is no photo
  rows.forEach((f, i) => {
    const x = M + (i >= perCol ? colW + 48 : 0)
    const ry = y + (i % perCol) * rowH + rowH * 0.68
    c.fillStyle = SOFT
    c.font = '400 19px "IBM Plex Mono"'
    c.textAlign = 'left'
    c.fillText(spaced(t(f.label).toUpperCase()), x, ry)
    c.fillStyle = INK
    c.font = '500 28px Fraunces'
    c.textAlign = 'right'
    c.fillText(f.format(recipe), x + colW, ry)
    c.fillStyle = LINE
    c.fillRect(x, y + ((i % perCol) + 1) * rowH, colW, 1)
  })

  // ---- footer ----
  c.textAlign = 'left'
  c.fillStyle = OLIVE
  c.font = '500 30px Fraunces'
  c.fillText('FilmLab', M, H - 48)
  c.fillStyle = SOFT
  c.font = '400 18px "IBM Plex Mono"'
  c.textAlign = 'right'
  c.fillText(spaced('FUJIFILM RECIPE'), W - M, H - 50)

  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
}

/** Letter-spacing for the monospace labels (canvas has no CSS letter-spacing everywhere) */
function spaced(s: string): string {
  return s.split('').join(' ')
}

/** Shorten text with "…" until it fits the width. */
function fit(c: OffscreenCanvasRenderingContext2D, text: string, max: number): string {
  if (c.measureText(text).width <= max) return text
  let s = text
  while (s.length > 1 && c.measureText(s + '…').width > max) s = s.slice(0, -1)
  return s + '…'
}
