/**
 * Recipe picker sheet: "which recipe do you want to apply?"
 *
 * Phase 2 sources: "as shot" and the recipes of already edited photos.
 * Phase 3 adds saved recipes to the same list.
 */

import { h, openSheet } from '../ui/dom.ts'
import { t } from '../i18n/index.ts'
import { listPhotos } from '../library/photos.ts'
import { summarize, type Recipe } from '../recipes/recipe.ts'

export type RecipeChoice = { kind: 'asShot' } | { kind: 'recipe'; recipe: Recipe; name: string }

/** Extra recipe sources can register here (used by Phase 3's saved recipes). */
export type RecipeSource = () => Promise<{ name: string; recipe: Recipe }[]>
const extraSources: RecipeSource[] = []
export function addRecipeSource(src: RecipeSource): void { extraSources.push(src) }

export function pickRecipe(): Promise<RecipeChoice | null> {
  return new Promise(resolve => {
    let result: RecipeChoice | null = null
    const s = openSheet(t('pick.title'), () => resolve(result))
    const choose = (c: RecipeChoice) => { result = c; s.close() }
    const list = h('div', { class: 'opt-list' },
      h('button', { class: 'opt', onclick: () => choose({ kind: 'asShot' }) },
        h('span', null, t('ed.asShot')), h('span', { class: 'label' }, t('pick.reset'))),
    )
    s.body.append(list)

    void (async () => {
      const items: { name: string; recipe: Recipe }[] = []
      for (const src of extraSources) items.push(...await src())
      // Recipes of edited photos, each distinct look only once
      const seen = new Set(items.map(i => summarizeKey(i.recipe)))
      for (const p of await listPhotos()) {
        if (!p.recipe) continue
        const key = summarizeKey(p.recipe)
        if (seen.has(key)) continue
        seen.add(key)
        items.push({ name: t('pick.fromPhoto', { name: p.fileName }), recipe: p.recipe })
      }
      for (const it of items) {
        list.append(h('button', { class: 'opt two-line', onclick: () => choose({ kind: 'recipe', recipe: it.recipe, name: it.name }) },
          h('span', null, it.name), h('span', { class: 'label' }, summarize(it.recipe))))
      }
      if (!items.length) s.body.append(h('p', { class: 'sheet-note' }, t('pick.empty')))
    })()
  })
}

const summarizeKey = (r: Recipe) => JSON.stringify(r)
