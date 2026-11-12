/**
 * RECIPES — list of your recipes (tabs All / Mine / Saved), plus create,
 * JSON import and JSON export.
 */

import { h, toast, openSheet } from '../ui/dom.ts'
import { icons } from '../ui/icons.ts'
import { t, getLang, type Dict } from '../i18n/index.ts'
import { header } from '../app/components.ts'
import { navigate, type View } from '../app/shell.ts'
import { summarize, filmSimName } from '../recipes/recipe.ts'
import { listRecipes, onRecipesChanged, recipeThumbUrl, importRecipesJson, recipesToJson, type SavedRecipe } from '../recipes/store.ts'
import { BUNDLED } from '../recipes/bundled.ts'
import { shareOrSave } from '../library/export.ts'
import { log } from '../ui/debug-log.ts'

type Tab = 'all' | 'mine' | 'saved'
const TABS: { key: Tab; label: keyof Dict }[] = [
  { key: 'all', label: 'rec.tab.all' }, { key: 'mine', label: 'rec.tab.mine' }, { key: 'saved', label: 'rec.tab.saved' },
]

/** One list row: thumbnail (or a film-simulation plate) + name + summary. */
export function recipeRow(rec: { id: string; name: string; recipe: SavedRecipe['recipe'] }, saved?: SavedRecipe, sub?: string): HTMLElement {
  const plate = h('div', { class: 'rec-thumb' }, h('span', null, filmSimName(rec.recipe.filmSimulation).slice(0, 2).toUpperCase()))
  if (saved) void recipeThumbUrl(saved).then(url => { if (url) plate.replaceChildren(h('img', { src: url, alt: '' })) })
  return h('button', { class: 'rec-row', onclick: () => navigate(`recipe/${rec.id}`) },
    plate,
    h('div', { class: 'rec-text' },
      h('div', { class: 'rec-name' }, rec.name),
      h('div', { class: 'label' }, summarize(rec.recipe)),
      sub ? h('div', { class: 'rec-sub' }, sub) : null,
    ),
  )
}

export const recipesView: View = root => {
  let tab: Tab = 'all'
  let all: SavedRecipe[] = []
  const seg = h('div', { class: 'seg wide' })
  const list = h('div', { class: 'rec-list' })
  const empty = h('div', { class: 'empty', hidden: true })
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true }) as HTMLInputElement

  const menuBtn = h('button', { class: 'icon-btn outlined', 'aria-label': t('rec.more'), html: icons.more, onclick: menu })
  const newBtn = h('button', { class: 'icon-btn outlined', 'aria-label': t('rec.new'), html: icons.plus, onclick: () => navigate('recipe/new') })
  root.append(header(t('nav.recipes'), undefined, menuBtn, newBtn), seg, empty, list, fileInput,
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, t('home.popular'))),
      h('div', { class: 'rec-list' }, ...BUNDLED.map(b => recipeRow({ id: 'b:' + b.key, name: b.name, recipe: b.recipe }, undefined, b.note[getLang()]))),
    ),
  )

  function draw() {
    seg.replaceChildren(...TABS.map(x => h('button', { class: tab === x.key ? 'on' : '', onclick: () => { tab = x.key; draw() } }, t(x.label))))
    const shown = all.filter(r => tab === 'all' || r.origin === tab)
    list.replaceChildren(...shown.map(r => recipeRow(r, r)))
    empty.hidden = shown.length > 0
    empty.replaceChildren(
      h('p', null, t(tab === 'saved' ? 'rec.emptySaved' : 'rec.empty')),
      h('button', { class: 'btn', onclick: () => navigate('recipe/new') }, h('span', { html: icons.plus }), t('rec.new')),
    )
  }

  function menu() {
    const sheet = openSheet(t('nav.recipes'))
    sheet.body.append(h('div', { class: 'opt-list' },
      h('button', { class: 'opt', onclick: () => { sheet.close(); fileInput.click() } }, t('rec.importJson')),
      h('button', { class: 'opt', disabled: !all.length, onclick: async () => {
        sheet.close()
        const file = new File([recipesToJson(all)], 'filmlab-recipes.json', { type: 'application/json' })
        await shareOrSave(file)
      } }, t('rec.exportAll', { n: all.length })),
    ))
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0]
    fileInput.value = ''
    if (!file) return
    try {
      const n = await importRecipesJson(await file.text())
      toast(n ? t('rec.imported', { n }) : t('rec.importNone'), n ? 'info' : 'error')
      if (n) { tab = 'saved'; draw() }
    } catch (err) {
      log(`Recipe import failed: ${err}`, 'warn')
      toast(t('rec.importBad'), 'error')
    }
  })

  const refresh = async () => { all = await listRecipes(); draw() }
  void refresh()
  return onRecipesChanged(() => void refresh())
}
