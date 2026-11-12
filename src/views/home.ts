/**
 * HOME — camera status, import, latest photos.
 * ("Popular Recipes" arrive in Phase 3.)
 */

import { h } from '../ui/dom.ts'
import { t, getLang } from '../i18n/index.ts'
import { BUNDLED } from '../recipes/bundled.ts'
import { filmSimName } from '../recipes/recipe.ts'
import { cameraPill, header, importButton, langSwitch, themeSwitch, thumb } from '../app/components.ts'
import { listPhotos, onPhotosChanged } from '../library/photos.ts'
import { navigate, type View } from '../app/shell.ts'
import { installSection } from '../app/install.ts'

export const homeView: View = root => {
  const pill = cameraPill(() => navigate('camera'))
  const recentGrid = h('div', { class: 'grid cols-3' })
  const recentSection = h('section', { class: 'section' },
    h('div', { class: 'section-head' },
      h('h2', null, t('home.recent')),
      h('a', { class: 'link label', href: '#/library' }, t('home.all')),
    ),
    recentGrid,
  )

  root.append(
    header('FilmLab', t('home.kicker'), langSwitch()),
    h('section', { class: 'hero' },
      h('p', { class: 'hero-text' }, t('home.intro')),
      h('div', { class: 'row wrap' }, importButton(), pill),
    ),
    recentSection,
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, t('home.popular')),
        h('a', { class: 'link label', href: '#/recipes' }, t('home.allRecipes'))),
      h('div', { class: 'pop-row' }, ...BUNDLED.map(b => h('a', { class: 'pop-card', href: `#/recipe/b:${b.key}` },
        h('div', { class: 'label' }, filmSimName(b.recipe.filmSimulation)),
        h('div', { class: 'pop-name' }, b.name),
        h('div', { class: 'pop-note' }, b.note[getLang()]),
      ))),
    ),
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, t('home.appearance'))),
      themeSwitch(),
    ),
  )
  const install = installSection()
  if (install) root.append(install)

  async function refresh() {
    const photos = (await listPhotos()).slice(0, 9)
    recentGrid.replaceChildren(...photos.map(p => thumb(p, () => navigate(`edit/${p.id}`))))
    recentSection.hidden = photos.length === 0
  }
  void refresh()
  const off = onPhotosChanged(refresh)
  return () => { off(); pill.dispose(); install?.dispose() }
}
