/**
 * Saved recipes (IndexedDB store 'recipes') + JSON import/export.
 *
 * origin 'mine'  = you created it (from the editor, from scratch, from a slot)
 * origin 'saved' = you saved someone else's (a bundled one, or a JSON import)
 */

import { dbDelete, dbGet, dbGetAll, dbPut } from '../storage/db.ts'
import { deleteFile, readFile, writeFile } from '../storage/opfs.ts'
import { newId } from '../library/photos.ts'
import { DEFAULT_RECIPE, FIELDS, type Recipe } from './recipe.ts'
import { BUNDLED } from './bundled.ts'

export interface SavedRecipe {
  id: string
  name: string
  recipe: Recipe
  origin: 'mine' | 'saved'
  /** Photo whose render is used on the recipe card, if any */
  photoId?: string | null
  hasThumb?: boolean
  createdAt: number
  updatedAt: number
}

const thumbPath = (id: string) => `recipes/${id}.jpg`

const listeners = new Set<() => void>()
export function onRecipesChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const notify = () => listeners.forEach(fn => fn())

export async function listRecipes(): Promise<SavedRecipe[]> {
  return (await dbGetAll<SavedRecipe>('recipes')).sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Get a recipe by id. Ids starting with "b:" are bundled (read-only) ones. */
export async function getRecipe(id: string): Promise<SavedRecipe | undefined> {
  if (id.startsWith('b:')) {
    const b = BUNDLED.find(x => 'b:' + x.key === id)
    return b ? { id, name: b.name, recipe: b.recipe, origin: 'saved', createdAt: 0, updatedAt: 0 } : undefined
  }
  return dbGet<SavedRecipe>('recipes', id)
}

export async function createRecipe(
  name: string, recipe: Recipe, origin: 'mine' | 'saved' = 'mine', thumb?: Blob | null, photoId?: string | null,
): Promise<SavedRecipe> {
  const id = newId()
  if (thumb) await writeFile(thumbPath(id), thumb)
  const rec: SavedRecipe = {
    id, name: name.trim() || 'Recipe', recipe: { ...recipe }, origin,
    photoId: photoId ?? null, hasThumb: !!thumb, createdAt: Date.now(), updatedAt: Date.now(),
  }
  await dbPut('recipes', rec)
  notify()
  return rec
}

export async function updateRecipe(rec: SavedRecipe): Promise<void> {
  await dbPut('recipes', { ...rec, updatedAt: Date.now() })
  notify()
}

export async function duplicateRecipe(rec: SavedRecipe, name: string): Promise<SavedRecipe> {
  const thumb = rec.hasThumb ? await readFile(thumbPath(rec.id)) : null
  return createRecipe(name, rec.recipe, 'mine', thumb, rec.photoId)
}

export async function deleteRecipe(id: string): Promise<void> {
  await deleteFile(thumbPath(id))
  await dbDelete('recipes', id)
  notify()
}

const thumbUrls = new Map<string, string>()
export async function recipeThumbUrl(rec: SavedRecipe): Promise<string | null> {
  if (!rec.hasThumb) return null
  const cached = thumbUrls.get(rec.id)
  if (cached) return cached
  const f = await readFile(thumbPath(rec.id))
  if (!f) return null
  const url = URL.createObjectURL(f)
  thumbUrls.set(rec.id, url)
  return url
}

// ---------------------------------------------------------------------------
// JSON import / export
// ---------------------------------------------------------------------------

interface RecipeFile { app: 'FilmLab'; version: 1; recipes: { name: string; recipe: Recipe }[] }

export function recipesToJson(recs: { name: string; recipe: Recipe }[]): string {
  const file: RecipeFile = { app: 'FilmLab', version: 1, recipes: recs.map(r => ({ name: r.name, recipe: r.recipe })) }
  return JSON.stringify(file, null, 2)
}

/**
 * Make sure an imported object is a valid Recipe: every field must be one of
 * the values the editor offers; anything else falls back to the default.
 * (Never trust a file from the internet to be well-formed.)
 */
export function sanitizeRecipe(input: unknown): Recipe {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const out = { ...DEFAULT_RECIPE } as Record<string, unknown>
  for (const f of FIELDS) {
    const allowed = f.options().map(o => o.value)
    if (allowed.includes(src[f.key])) out[f.key] = src[f.key]
  }
  return out as unknown as Recipe
}

/** Parse a JSON text and store its recipes as 'saved'. Returns how many. */
export async function importRecipesJson(text: string): Promise<number> {
  const data = JSON.parse(text) as Partial<RecipeFile>
  const list = Array.isArray(data.recipes) ? data.recipes : []
  let n = 0
  for (const item of list) {
    if (!item || typeof item.name !== 'string') continue
    await createRecipe(item.name.slice(0, 60), sanitizeRecipe(item.recipe), 'saved')
    n++
  }
  return n
}
