/**
 * RECIPES — placeholder until Phase 3.
 */

import { h } from '../ui/dom.ts'
import { t } from '../i18n/index.ts'
import { header } from '../app/components.ts'
import type { View } from '../app/shell.ts'

export const recipesView: View = root => {
  root.append(
    header(t('nav.recipes')),
    h('div', { class: 'empty' }, h('p', null, t('recipes.soon'))),
  )
}
