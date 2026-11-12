/**
 * CAMERA — connection screen.
 *
 * Step-by-step instructions, a live status ("Waiting for camera…"), and the
 * Connect / Disconnect buttons. Also hosts the on-screen debug log and a link
 * to the diagnostics page (the Phase 0 test page).
 */

import { h } from '../ui/dom.ts'
import { icons } from '../ui/icons.ts'
import { t, type Dict } from '../i18n/index.ts'
import { cameraService } from '../camera/camera-service.ts'
import { cameraPill, header } from '../app/components.ts'
import { createDebugPanel } from '../ui/debug-log.ts'
import type { View } from '../app/shell.ts'
import { slotsCard } from './slots.ts'

const STEPS: { title: keyof Dict; text: keyof Dict }[] = [
  { title: 'cam.step1.title', text: 'cam.step1.text' },
  { title: 'cam.step2.title', text: 'cam.step2.text' },
  { title: 'cam.step3.title', text: 'cam.step3.text' },
  { title: 'cam.step4.title', text: 'cam.step4.text' },
]

export const cameraView: View = root => {
  const pill = cameraPill()
  const specs = h('dl', { class: 'specs' })
  const notice = h('p', { class: 'notice' })
  const connectBtn = h('button', { class: 'btn', onclick: () => cameraService.connectInteractive() },
    h('span', { html: icons.usb }), t('cam.connect'))
  const disconnectBtn = h('button', { class: 'btn ghost', onclick: () => cameraService.disconnect() }, t('cam.disconnect'))
  const slots = slotsCard()
  const steps = h('ol', { class: 'steps' },
    ...STEPS.map((s, i) => h('li', null,
      h('span', { class: 'step-no' }, String(i + 1)),
      h('div', null, h('h3', null, t(s.title)), h('p', null, t(s.text))),
    )),
  )

  root.append(
    header(t('nav.camera'), 'Fujifilm · WebUSB'),
    h('section', { class: 'card' },
      h('div', { class: 'row between' }, pill),
      notice,
      specs,
      h('div', { class: 'row wrap' }, connectBtn, disconnectBtn),
    ),
    h('section', { class: 'section' }, h('h2', null, t('cam.howto')), steps),
    h('section', { class: 'section' }, slots),
    h('section', { class: 'section' },
      h('details', { class: 'fold' },
        h('summary', null, h('span', { class: 'label' }, t('cam.debug'))),
        createDebugPanel(),
        h('p', null, h('a', { class: 'link', href: './diagnostics.html' }, t('cam.diagnostics'))),
      ),
    ),
  )

  function update() {
    const s = cameraService.status
    const connected = !!cameraService.camera
    connectBtn.hidden = connected || s === 'unsupported' || s === 'connecting'
    disconnectBtn.hidden = !connected
    steps.closest('section')!.hidden = s === 'connected'

    const notes: Partial<Record<typeof s, keyof Dict>> = {
      unsupported: 'cam.note.unsupported',
      idle: 'cam.note.idle',
      waiting: 'cam.note.waiting',
      'wrong-mode': 'cam.note.wrongMode',
      error: cameraService.errorText === 'busy' ? 'cam.note.busy' : 'cam.note.error',
    }
    const note = notes[s]
    notice.hidden = !note
    notice.dataset.kind = s === 'wrong-mode' || s === 'error' ? 'warn' : ''
    if (note) notice.textContent = t(note)

    specs.hidden = !connected
    specs.replaceChildren(
      h('dt', { class: 'label' }, t('cam.model')), h('dd', null, cameraService.model),
      h('dt', { class: 'label' }, t('cam.firmware')), h('dd', null, cameraService.firmware),
    )
  }
  update()
  const off = cameraService.subscribe(update)
  return () => { off(); pill.dispose(); slots.dispose() }
}
