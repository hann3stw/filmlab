/**
 * Recipe form: the grid of setting tiles + the picker sheet, for editing a
 * recipe WITHOUT a photo (Recipes tab). The photo editor has its own copy of
 * this logic because it also has to deal with rendering and "as shot".
 */

import { h, openSheet } from '../ui/dom.ts'
import { icons } from '../ui/icons.ts'
import { t } from '../i18n/index.ts'
import { FIELDS, TONE_FIELDS, type FieldDef, type Recipe } from '../recipes/recipe.ts'

/**
 * Draw the tiles into `container`. With `onChange` the tiles are tappable;
 * without it the form is read-only (bundled recipes).
 */
export function drawRecipeForm(container: HTMLElement, recipe: Recipe, onChange?: (next: Recipe) => void): void {
  container.classList.add('tiles')
  container.replaceChildren(...FIELDS.filter(f => !f.visible || f.visible(recipe)).map(f => {
    const locked = f.lockedBy?.(recipe)
    return h('button', {
      class: `tile${locked ? ' locked' : ''}`, disabled: !onChange,
      onclick: () => onChange && openPicker(f, recipe, next => { onChange(next); drawRecipeForm(container, next, onChange) }),
    },
      h('span', { class: 'tile-label label' }, t(f.label)),
      h('span', { class: 'tile-value' }, f.format(recipe)),
    )
  }))
}

function openPicker(f: FieldDef, start: Recipe, commit: (r: Recipe) => void): void {
  let recipe = start
  const sheet = openSheet(t(f.label))
  const set = (value: unknown) => {
    const next = { ...recipe, [f.key]: value } as Recipe
    if (TONE_FIELDS.includes(f.key) && next.dRangePriority !== 'off') next.dRangePriority = 'off'
    if (f.key === 'grainSize' && next.grain === 'off') next.grain = 'weak'
    recipe = next
    commit(next)
  }
  const draw = () => {
    const opts = f.options()
    const reason = f.lockedBy?.(recipe)
    const note = reason ? [h('p', { class: 'sheet-note' }, t(reason))] : []
    if (!f.numeric) {
      sheet.body.replaceChildren(...note, h('div', { class: 'opt-list' }, ...opts.map(o =>
        h('button', { class: `opt${o.value === recipe[f.key] ? ' on' : ''}`, onclick: () => { set(o.value); sheet.close() } }, o.label))))
      return
    }
    const idx = Math.max(0, opts.findIndex(o => o.value === recipe[f.key]))
    const slider = h('input', { type: 'range', min: 0, max: opts.length - 1, step: 1, value: idx, class: 'slider', 'aria-label': t(f.label) }) as HTMLInputElement
    slider.addEventListener('input', () => { set(opts[Number(slider.value)].value); draw() })
    sheet.body.replaceChildren(...note,
      h('div', { class: 'stepper' },
        h('button', { class: 'icon-btn big', 'aria-label': '−', html: icons.minus, disabled: idx === 0, onclick: () => { set(opts[idx - 1].value); draw() } }),
        h('div', { class: 'stepper-value' }, opts[idx]?.label ?? '?'),
        h('button', { class: 'icon-btn big', 'aria-label': '+', html: icons.plus, disabled: idx === opts.length - 1, onclick: () => { set(opts[idx + 1].value); draw() } }),
      ),
      slider,
      h('div', { class: 'row end' }, h('button', { class: 'btn small', onclick: () => sheet.close() }, t('ed.done'))),
    )
  }
  draw()
}
