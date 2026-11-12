/**
 * RECIPE — one recipe: name, all settings (editable for your own recipes),
 * and what you can do with it: apply to photos, load onto the camera,
 * export a recipe card, export as JSON, duplicate, delete.
 */

import { h, toast, openSheet, confirmSheet, promptSheet, debounce } from '../ui/dom.ts'
import { icons } from '../ui/icons.ts'
import { t, getLang } from '../i18n/index.ts'
import { navigate, type View } from '../app/shell.ts'
import { DEFAULT_RECIPE, summarize, recipesEqual, type Recipe } from '../recipes/recipe.ts'
import {
  getRecipe, createRecipe, updateRecipe, duplicateRecipe, deleteRecipe, recipeThumbUrl, recipesToJson, listRecipes, type SavedRecipe,
} from '../recipes/store.ts'
import { BUNDLED } from '../recipes/bundled.ts'
import { drawRecipeForm } from '../app/recipe-form.ts'
import { runBatch } from '../app/batch-ui.ts'
import { loadRecipeOntoCamera } from './slots.ts'
import { renderRecipeCard } from '../recipes/card.ts'
import { listPhotos, resultFile, thumbUrl, type Photo } from '../library/photos.ts'
import { shareOrSave } from '../library/export.ts'

export const recipeView: View = (root, [id]) => {
  let disposed = false
  const page = h('div', { class: 'recipe-page' })
  root.append(page)

  void (async () => {
    // "new" → create an empty recipe and continue on its own page
    if (id === 'new') {
      const rec = await createRecipe(t('rec.newName'), DEFAULT_RECIPE, 'mine')
      navigate(`recipe/${rec.id}`, true)
      return
    }
    const rec = await getRecipe(id)
    if (disposed) return
    if (!rec) { toast(t('rec.notFound'), 'error'); navigate('recipes', true); return }
    draw(rec)
  })()

  function draw(rec: SavedRecipe) {
    const bundled = rec.id.startsWith('b:')
    const note = bundled ? BUNDLED.find(b => 'b:' + b.key === rec.id)?.note[getLang()] : null
    const summary = h('div', { class: 'label rec-summary' }, summarize(rec.recipe))
    const form = h('div')
    const save = debounce((r: SavedRecipe) => void updateRecipe(r), 400)

    const nameInput = h('input', { class: 'name-input', value: rec.name, maxlength: 60, readonly: bundled, 'aria-label': t('rec.name') }) as HTMLInputElement
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim()
      if (!v) { nameInput.value = rec.name; return }
      rec = { ...rec, name: v }
      void updateRecipe(rec)
    })

    const thumb = h('div', { class: 'rec-hero', hidden: true })
    if (!bundled) void recipeThumbUrl(rec).then(url => { if (url) { thumb.hidden = false; thumb.append(h('img', { src: url, alt: '' })) } })

    drawRecipeForm(form, rec.recipe, bundled ? undefined : (next: Recipe) => {
      rec = { ...rec, recipe: next }
      summary.textContent = summarize(next)
      save(rec)
    })

    const action = (icon: string, label: string, fn: () => void, danger = false) =>
      h('button', { class: `opt${danger ? ' danger' : ''}`, onclick: fn }, h('span', { class: 'row' }, h('span', { html: icon }), label))

    page.replaceChildren(
      h('div', { class: 'ed-top' },
        h('button', { class: 'icon-btn', 'aria-label': t('ed.back'), html: icons.back, onclick: () => { if (history.length > 1) history.back(); else navigate('recipes', true) } }),
        h('div', { class: 'ed-title' }, h('div', { class: 'label' }, bundled ? t('home.popular') : t(rec.origin === 'mine' ? 'rec.tab.mine' : 'rec.tab.saved'))),
        h('span', { style: { width: '48px' } }),
      ),
      h('div', { class: 'recipe-body' },
        thumb,
        nameInput,
        note ? h('p', { class: 'muted' }, note) : '',
        summary,
        bundled ? h('button', { class: 'btn', onclick: async () => {
          const copy = await createRecipe(rec.name, rec.recipe, 'saved')
          toast(t('rec.savedToMine'))
          navigate(`recipe/${copy.id}`, true)
        } }, h('span', { html: icons.plus }), t('rec.saveToMine')) : '',
        form,
        h('div', { class: 'opt-list actions' },
          action(icons.wand, t('rec.apply'), () => void applyToPhotos(rec)),
          action(icons.camera, t('rec.toCamera'), () => void loadRecipeOntoCamera(rec.name, rec.recipe)),
          action(icons.share, t('rec.card'), () => void exportCard(rec)),
          action(icons.download, t('rec.exportJson'), async () => {
            const file = new File([recipesToJson([rec])], `${rec.name.replace(/[^\w-]+/g, '_')}.json`, { type: 'application/json' })
            await shareOrSave(file)
          }),
          bundled ? '' : action(icons.recipes, t('rec.duplicate'), async () => {
            const name = await promptSheet(t('rec.duplicate'), t('rec.name'), t('common.create'), t('common.cancel'), `${rec.name} 2`)
            if (name) { const copy = await duplicateRecipe(rec, name); navigate(`recipe/${copy.id}`, true) }
          }),
          bundled ? '' : action(icons.trash, t('rec.delete'), async () => {
            if (await confirmSheet(t('rec.delete'), t('rec.deleteText', { name: rec.name }), t('view.delete'), t('common.cancel'), true)) {
              await deleteRecipe(rec.id)
              navigate('recipes', true)
            }
          }, true),
        ),
      ),
    )
  }

  return () => { disposed = true }
}

/** Sheet with a photo grid: choose photos, then the camera develops them. */
async function applyToPhotos(rec: SavedRecipe) {
  const photos = (await listPhotos()).filter(p => !p.rafDeleted)
  if (!photos.length) { toast(t('lib.empty')); return }
  const chosen = new Set<string>()
  const go = h('button', { class: 'btn', disabled: true })
  const sheet = openSheet(t('rec.choosePhotos'))
  const grid = h('div', { class: 'pick-grid' }, ...photos.map(p => pickCell(p, chosen, update)))
  function update() { go.disabled = chosen.size === 0; go.textContent = t('rec.applyN', { n: chosen.size }) }
  update()
  go.addEventListener('click', async () => {
    sheet.close()
    await runBatch([...chosen], () => rec.recipe)
  })
  sheet.body.append(grid, h('div', { class: 'row end sticky-foot' }, go))
}

function pickCell(p: Photo, chosen: Set<string>, changed: () => void): HTMLElement {
  const img = h('img', { alt: p.fileName, loading: 'lazy' })
  void thumbUrl(p).then(u => { if (u) img.src = u })
  const el = h('button', { class: 'cell', style: { height: 'auto', aspectRatio: '1' } }, img, h('span', { class: 'cell-check' }))
  el.addEventListener('click', () => {
    if (chosen.has(p.id)) chosen.delete(p.id); else chosen.add(p.id)
    el.classList.toggle('selected', chosen.has(p.id))
    el.querySelector('.cell-check')!.innerHTML = chosen.has(p.id) ? icons.check : ''
    changed()
  })
  return el
}

/** Draw the recipe card and share / save it. */
async function exportCard(rec: SavedRecipe) {
  toast(t('rec.cardMaking'))
  // Photo for the card: the linked photo's render, else any photo rendered with exactly this recipe
  let photo: Blob | null = null
  const photos = await listPhotos()
  const linked = photos.find(p => p.id === rec.photoId && p.resultSize && p.recipe && recipesEqual(p.recipe, rec.recipe))
    ?? photos.find(p => p.resultSize && p.recipe && recipesEqual(p.recipe, rec.recipe))
    ?? photos.find(p => p.id === rec.photoId && p.resultSize)
  if (linked) photo = await resultFile(linked.id)
  const blob = await renderRecipeCard(rec.name, rec.recipe, photo)
  const file = new File([blob], `${rec.name.replace(/[^\w-]+/g, '_')}_recipe.jpg`, { type: 'image/jpeg' })
  await shareOrSave(file)
}

/** Used by main.ts: saved + bundled recipes as sources for the recipe picker. */
export async function recipeSources(): Promise<{ name: string; recipe: Recipe }[]> {
  return [...(await listRecipes()).map(r => ({ name: r.name, recipe: r.recipe })), ...BUNDLED.map(b => ({ name: b.name, recipe: b.recipe }))]
}
