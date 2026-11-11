/**
 * LIBRARY — Phase 1 version: a simple grid of all imported photos.
 * Phase 2 replaces this with the full library (filters, albums, virtual
 * scrolling, viewer, multi-select …).
 */

import { h } from '../ui/dom.ts'
import { t } from '../i18n/index.ts'
import { header, importButton, thumb } from '../app/components.ts'
import { listPhotos, onPhotosChanged } from '../library/photos.ts'
import { navigate, type View } from '../app/shell.ts'

export const libraryView: View = root => {
  const grid = h('div', { class: 'grid cols-3' })
  const empty = h('div', { class: 'empty' },
    h('p', null, t('lib.empty')),
    importButton(),
  )
  const count = h('span', { class: 'label' })
  root.append(header(t('nav.library'), undefined, count, importButton('ghost')), empty, grid)

  async function refresh() {
    const photos = await listPhotos()
    count.textContent = t('lib.count', { n: photos.length })
    empty.hidden = photos.length > 0
    grid.replaceChildren(...photos.map(p => thumb(p, () => navigate(`edit/${p.id}`))))
  }
  void refresh()
  return onPhotosChanged(refresh)
}
