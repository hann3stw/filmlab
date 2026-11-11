/**
 * PHASE 0 — Connection check page.
 *
 * A deliberately simple test page that proves the whole chain works on the
 * phone before we build the real app:
 *
 *   1. Connect the camera via WebUSB, show model + firmware
 *   2. Read all custom slots (C1…Cn) — READ-ONLY
 *   3. Pick a .RAF file, let the CAMERA convert it with the as-shot settings,
 *      show the JPEG and measure how long each step takes
 *
 * Everything that happens is written to the on-screen debug log.
 */

import { FujiCamera, CancelledError, type PresetData, type PropDesc, type ConvertStage } from '../camera/ptp/session.ts'
import { FujiPropNames, formatPresetValue } from '../camera/ptp/constants.ts'
import { FilmSimLabels, WBModeLabels } from '../camera/profile/enums.ts'
import { translatePresetToUI, cameraProfileToUIValues, type PresetUIValues } from '../camera/profile/preset-translate.ts'
import { patchProfile } from '../camera/profile/d185.ts'
import { log, createDebugPanel } from '../ui/debug-log.ts'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Shortcut for document.querySelector with a type, throws if missing. */
function $<T extends HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel)
  if (!el) throw new Error(`Element not found: ${sel}`)
  return el
}

/** Escape text before putting it into innerHTML (prevents broken markup). */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function fmtMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function fmtSec(ms: number): string {
  return (ms / 1000).toFixed(2) + ' s'
}

function hex4(n: number): string {
  return '0x' + n.toString(16).toUpperCase().padStart(4, '0')
}

/** Every RAF file starts with these ASCII bytes — a quick sanity check. */
const RAF_MAGIC = 'FUJIFILMCCD-RAW'

function isRaf(buf: ArrayBuffer): boolean {
  const head = new Uint8Array(buf, 0, Math.min(RAF_MAGIC.length, buf.byteLength))
  return String.fromCharCode(...head) === RAF_MAGIC
}

/**
 * Compact one-line summary of a recipe, e.g.
 * "CLASSIC CHROME · H -2 S -2 COLOR +4 · WB AUTO R +5 B -6"
 * (Phase 3 will reuse this idea for the recipe list.)
 */
function summarize(v: PresetUIValues): string {
  const sign = (n: number) => (n > 0 ? '+' : '') + n
  const sim = (FilmSimLabels[v.filmSimulation] ?? `SIM ${v.filmSimulation}`).replace(/\s*\(.*\)/, '')
  const wb = WBModeLabels[v.whiteBalance] ?? hex4(v.whiteBalance)
  return [
    sim.toUpperCase(),
    `H ${sign(v.highlightTone)} S ${sign(v.shadowTone)} COLOR ${sign(v.color)}`,
    `WB ${wb.toUpperCase()} R ${sign(v.wbShiftR)} B ${sign(v.wbShiftB)}`,
  ].join(' · ')
}

/** Turn a PropDesc's allowed values into readable text. */
function describeForm(d: PropDesc): string {
  const label = (v: number | string): string => {
    if (typeof v === 'string') return `"${v}"`
    if (d.id === 0xD192) return FilmSimLabels[v] ?? String(v)
    if (d.id === 0xD199) return WBModeLabels[v & 0xFFFF] ?? hex4(v & 0xFFFF)
    const f = formatPresetValue(d.id, v)
    return f ?? String(v)
  }
  switch (d.form.type) {
    case 'range': return `range ${label(d.form.min)} … ${label(d.form.max)} (step ${d.form.step})`
    case 'enum': return `${d.form.values.length} values: ${d.form.values.map(label).join(', ')}`
    default: return 'no list given'
  }
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

export function mountCheckPage(root: HTMLElement): void {
  root.innerHTML = `
    <header class="topbar">
      <img src="./icons/logo.svg" alt="" width="40" height="40" />
      <div>
        <h1>FilmLab</h1>
        <div class="label">Phase 0 · connection check · v${__APP_VERSION__}</div>
      </div>
    </header>

    <main class="stack">
      <!-- 1. CAMERA ------------------------------------------------------ -->
      <section class="card" id="cam-card">
        <div class="card-head">
          <h2>Camera</h2>
          <span class="status" id="cam-status"><i></i><span>Not connected</span></span>
        </div>
        <p class="hint" id="cam-hint">
          On the camera: <b>MENU → Network/USB Setting → Connection Mode →
          USB RAW CONV./BACKUP RESTORE</b>. Turn the camera on and connect it to the
          phone with a USB-C data cable, then tap <b>Connect</b>.
          If Android asks which app should open the camera, dismiss the dialog.
        </p>
        <dl class="specs" id="cam-specs" hidden>
          <dt class="label">Model</dt><dd id="spec-model">–</dd>
          <dt class="label">Firmware</dt><dd id="spec-fw">–</dd>
          <dt class="label">USB ID</dt><dd id="spec-usb">–</dd>
          <dt class="label">Custom slots</dt><dd id="spec-slots">–</dd>
        </dl>
        <div class="row wrap">
          <button class="btn" id="btn-connect">Connect</button>
          <button class="btn ghost" id="btn-disconnect" hidden>Disconnect</button>
        </div>
      </section>

      <!-- 2. RAW CONVERSION --------------------------------------------- -->
      <section class="card">
        <div class="card-head">
          <h2>RAW conversion</h2>
          <span class="label">in-camera · as-shot settings</span>
        </div>
        <div class="row wrap">
          <label class="btn ghost" for="raf-input">Choose .RAF</label>
          <!-- no "accept" filter: Android often hides .RAF files when one is set -->
          <input type="file" id="raf-input" hidden />
          <span class="file-name" id="raf-name">No file selected</span>
        </div>
        <div class="row wrap">
          <button class="btn" id="btn-convert" disabled>Convert in camera</button>
          <button class="btn ghost" id="btn-reconvert" disabled title="Same RAF, no upload — like an editor re-render">Convert again</button>
        </div>
        <div class="row wrap">
          <label class="label" for="poll-select">Result poll interval</label>
          <select id="poll-select" class="select">
            <option value="1000" selected>1000 ms (FilmKit default)</option>
            <option value="500">500 ms</option>
            <option value="250">250 ms</option>
          </select>
        </div>

        <div class="progress" id="progress" hidden><div class="bar"></div><span class="label" id="progress-text"></span></div>

        <table class="timings" id="timings" hidden>
          <tbody></tbody>
        </table>

        <figure class="result" id="result" hidden>
          <img id="result-img" alt="Converted JPEG" />
          <figcaption class="label" id="result-cap"></figcaption>
        </figure>
      </section>

      <!-- 3. CUSTOM SLOTS ----------------------------------------------- -->
      <section class="card">
        <div class="card-head">
          <h2>Custom slots</h2>
          <span class="label">read-only</span>
        </div>
        <p class="hint">Read automatically after connecting. Nothing is written to the camera's slots.</p>
        <div class="row wrap">
          <button class="btn ghost" id="btn-slots" disabled>Read slots again</button>
          <button class="btn ghost" id="btn-descs" disabled>Read allowed values</button>
          <button class="btn ghost" id="btn-devinfo" disabled>DeviceInfo → log</button>
        </div>
        <div id="slots"></div>
        <div id="descs"></div>
      </section>

      <div id="debug-slot"></div>
    </main>

    <div class="fullscreen" id="fullscreen" hidden><img alt="Converted JPEG, full screen" /></div>
  `

  $(root, '#debug-slot').replaceWith(createDebugPanel())

  // ---- element references ----
  const btnConnect = $<HTMLButtonElement>(root, '#btn-connect')
  const btnDisconnect = $<HTMLButtonElement>(root, '#btn-disconnect')
  const btnConvert = $<HTMLButtonElement>(root, '#btn-convert')
  const btnReconvert = $<HTMLButtonElement>(root, '#btn-reconvert')
  const btnSlots = $<HTMLButtonElement>(root, '#btn-slots')
  const btnDescs = $<HTMLButtonElement>(root, '#btn-descs')
  const btnDevInfo = $<HTMLButtonElement>(root, '#btn-devinfo')
  const rafInput = $<HTMLInputElement>(root, '#raf-input')
  const pollSelect = $<HTMLSelectElement>(root, '#poll-select')
  const statusEl = $(root, '#cam-status')
  const progressEl = $(root, '#progress')
  const progressBar = $(progressEl, '.bar')
  const progressText = $(root, '#progress-text')
  const timingsEl = $<HTMLTableElement>(root, '#timings')
  const resultEl = $(root, '#result')
  const resultImg = $<HTMLImageElement>(root, '#result-img')
  const resultCap = $(root, '#result-cap')
  const fullscreen = $(root, '#fullscreen')

  // ---- state ----
  let camera: FujiCamera | null = null
  let rafBuffer: ArrayBuffer | null = null
  let rafName = ''
  let busy = false
  let resultUrl: string | null = null

  /** Show the status pill next to "Camera". */
  function setStatus(text: string, kind: 'off' | 'wait' | 'on' | 'err') {
    statusEl.dataset.kind = kind
    $(statusEl, 'span').textContent = text
  }

  /** Enable/disable buttons depending on the current state. */
  function updateButtons() {
    const connected = !!camera?.connected
    btnConnect.hidden = connected
    btnDisconnect.hidden = !connected
    btnConvert.disabled = !connected || !rafBuffer || busy
    btnReconvert.disabled = !connected || !camera?.rafLoaded || busy
    btnSlots.disabled = !connected || busy
    btnDescs.disabled = !connected || busy
    btnDevInfo.disabled = !connected || busy
    btnConnect.disabled = busy
  }

  // =========================================================================
  // 1. Connect / disconnect
  // =========================================================================

  btnConnect.addEventListener('click', async () => {
    if (!('usb' in navigator)) {
      log('WebUSB is not available. Use Chrome on Android (not Firefox / Samsung Internet), served over HTTPS.', 'error')
      setStatus('WebUSB unavailable', 'err')
      return
    }
    busy = true; updateButtons()
    setStatus('Waiting for camera…', 'wait')
    log('--- Connecting ---')

    const cam = new FujiCamera(msg => log(msg))
    cam.pollIntervalMs = Number(pollSelect.value)
    const res = await cam.connect()
    if (!res.ok) {
      setStatus('Not connected', 'off')
      if (res.error === 'interface-busy') {
        log('The USB interface is busy. Unplug the cable, close other camera apps, and try again.', 'warn')
      } else if (res.error !== 'cancelled') {
        log('Connection failed. Check: camera ON, Connection Mode = USB RAW CONV./BACKUP RESTORE, data-capable USB-C cable.', 'warn')
      }
      busy = false; updateButtons()
      return
    }
    camera = cam

    // Show what the camera told us about itself (PTP GetDeviceInfo).
    $(root, '#cam-specs').hidden = false
    $(root, '#spec-model').textContent = cam.modelName || cam.deviceName
    $(root, '#spec-fw').textContent = cam.firmwareVersion || '–'
    const pid = cam.usbProductId
    $(root, '#spec-usb').textContent = pid !== null ? `04CB:${pid.toString(16).toUpperCase().padStart(4, '0')}` : '–'
    $(root, '#cam-hint').hidden = true
    setStatus('Connected', 'on')
    log(`Connected: ${cam.modelName} · firmware ${cam.firmwareVersion}`, 'ok')

    busy = false; updateButtons()
    await readSlots()
  })

  btnDisconnect.addEventListener('click', async () => {
    if (!camera) return
    log('--- Disconnecting ---')
    await camera.disconnect()
    resetConnection('Not connected')
  })

  /** Forget the camera and reset the UI (manual disconnect OR cable pulled). */
  function resetConnection(statusText: string) {
    camera = null
    busy = false
    setStatus(statusText, 'off')
    $(root, '#cam-specs').hidden = true
    $(root, '#cam-hint').hidden = false
    progressEl.hidden = true
    updateButtons()
  }

  // The browser fires "disconnect" when the cable is unplugged / camera off.
  navigator.usb?.addEventListener('disconnect', e => {
    if (camera && camera.isDevice(e.device)) {
      log('--- Camera disconnected (cable unplugged or camera turned off) ---', 'warn')
      camera.disconnect().catch(() => {})
      resetConnection('Disconnected')
    }
  })

  // Close the PTP session when the page is closed, so the next connect is clean.
  window.addEventListener('beforeunload', () => camera?.emergencyClose())

  pollSelect.addEventListener('change', () => {
    if (camera) camera.pollIntervalMs = Number(pollSelect.value)
    log(`Result poll interval: ${pollSelect.value} ms`)
  })

  // =========================================================================
  // 2. RAF → camera → JPEG
  // =========================================================================

  rafInput.addEventListener('change', async () => {
    const file = rafInput.files?.[0]
    if (!file) return
    log(`Reading file "${file.name}" (${fmtMB(file.size)})…`)
    const t0 = performance.now()
    const buf = await file.arrayBuffer()
    log(`File read into memory in ${fmtSec(performance.now() - t0)}`)
    if (!isRaf(buf)) {
      log(`"${file.name}" is not a Fujifilm RAF file (missing "${RAF_MAGIC}" header)`, 'error')
      rafBuffer = null
      $(root, '#raf-name').textContent = 'Not a RAF file'
      updateButtons()
      return
    }
    rafBuffer = buf
    rafName = file.name
    $(root, '#raf-name').textContent = `${file.name} · ${fmtMB(file.size)}`
    if (camera) camera.rafLoaded = false // a new file must be uploaded first
    updateButtons()
  })

  /** Human-readable names for the stages reported by FujiCamera. */
  const STAGE_LABEL: Record<Exclude<ConvertStage, 'done'>, string> = {
    upload: 'Upload RAF → camera',
    profile: 'Read/send settings (D185)',
    convert: 'Camera processing',
    download: 'Download JPEG',
  }

  /**
   * Run a conversion and measure each stage.
   * We record performance.now() whenever a new stage starts; the difference
   * between two timestamps is that stage's duration.
   */
  async function runConversion(kind: 'first' | 'again') {
    if (!camera || busy) return
    busy = true; updateButtons()

    const marks: { stage: ConvertStage; t: number }[] = []
    const t0 = performance.now()
    const onStage = (stage: ConvertStage) => {
      marks.push({ stage, t: performance.now() })
      if (stage !== 'done') {
        progressText.textContent = STAGE_LABEL[stage] + '…'
        if (stage !== 'upload') progressBar.style.width = '100%'
      }
    }
    const onUploadProgress = (done: number, total: number) => {
      const pct = Math.round((done / total) * 100)
      progressBar.style.width = pct + '%'
      progressText.textContent = `Uploading ${pct} % (${fmtMB(done)} / ${fmtMB(total)})`
    }

    progressEl.hidden = false
    progressBar.style.width = '0%'
    log(kind === 'first' ? `--- Converting ${rafName} (upload + convert) ---` : '--- Converting again (no upload) ---')

    try {
      let jpeg: Uint8Array
      if (kind === 'first') {
        jpeg = await camera.loadRaf(rafBuffer!, { onStage, onUploadProgress })
        if (camera.baseProfile) {
          const v = cameraProfileToUIValues(camera.baseProfile)
          log(`As-shot settings in RAF: ${summarize(v)}`)
        }
      } else {
        // Same profile again, patched with "no changes" — exactly what the
        // editor will do on every slider change (minus the actual change).
        jpeg = await camera.reconvert(base => patchProfile(base, {}), { onStage })
      }
      const total = performance.now() - t0

      // ---- timing table ----
      const rows: string[] = []
      for (let i = 0; i < marks.length - 1; i++) {
        const st = marks[i].stage as Exclude<ConvertStage, 'done'>
        const dur = marks[i + 1].t - marks[i].t
        rows.push(`<tr><td class="label">${STAGE_LABEL[st]}</td><td>${fmtSec(dur)}</td></tr>`)
        log(`  ${STAGE_LABEL[st].padEnd(28)} ${fmtSec(dur)}`)
      }
      rows.push(`<tr class="total"><td class="label">Total</td><td>${fmtSec(total)}</td></tr>`)
      log(`Total: ${fmtSec(total)} (poll interval ${camera.pollIntervalMs} ms)`, 'ok')
      if (kind === 'first' && rafBuffer) {
        const up = marks.find(m => m.stage === 'upload')
        const next = marks.find(m => m.stage === 'profile')
        if (up && next) {
          const mbps = (rafBuffer.byteLength / 1024 / 1024) / ((next.t - up.t) / 1000)
          rows.push(`<tr><td class="label">USB upload speed</td><td>${mbps.toFixed(1)} MB/s</td></tr>`)
          log(`USB upload speed: ${mbps.toFixed(1)} MB/s`)
        }
      }
      timingsEl.tBodies[0].innerHTML = rows.join('')
      timingsEl.hidden = false

      // ---- show the JPEG ----
      if (resultUrl) URL.revokeObjectURL(resultUrl)
      resultUrl = URL.createObjectURL(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }))
      resultImg.src = resultUrl
      await resultImg.decode().catch(() => {})
      resultEl.hidden = false
      resultCap.textContent = `${resultImg.naturalWidth} × ${resultImg.naturalHeight} px · ${fmtMB(jpeg.length)} · tap for full screen`
      log(`JPEG: ${resultImg.naturalWidth}×${resultImg.naturalHeight}, ${fmtMB(jpeg.length)}`, 'ok')
    } catch (err) {
      if (!(err instanceof CancelledError)) {
        log(`Conversion failed: ${err}`, 'error')
        log('Tip: if this keeps failing, unplug the camera, turn it off/on, reconnect.', 'warn')
      }
    } finally {
      progressEl.hidden = true
      busy = false; updateButtons()
    }
  }

  btnConvert.addEventListener('click', () => runConversion('first'))
  btnReconvert.addEventListener('click', () => runConversion('again'))

  // Tap the image → full screen; tap again → back.
  resultImg.addEventListener('click', () => {
    $<HTMLImageElement>(fullscreen, 'img').src = resultImg.src
    fullscreen.hidden = false
  })
  fullscreen.addEventListener('click', () => { fullscreen.hidden = true })

  // =========================================================================
  // 3. Custom slots (READ-ONLY)
  // =========================================================================

  async function readSlots() {
    if (!camera) return
    busy = true; updateButtons()
    const slotsEl = $(root, '#slots')
    slotsEl.innerHTML = '<p class="hint">Reading slots…</p>'
    log('--- Reading custom slots (read-only) ---')
    try {
      const presets = await camera.scanPresets()
      $(root, '#spec-slots').textContent = presets.length ? `C1–C${presets.length}` : 'none read'
      if (presets.length === 0) {
        slotsEl.innerHTML = `<p class="hint warn">No slots could be read. Is the camera in
          <b>USB RAW CONV./BACKUP RESTORE</b> mode? Disconnect, change the mode, reconnect.</p>`
        log('No slots read — camera may be in the wrong USB mode', 'warn')
      } else {
        slotsEl.innerHTML = presets.map(renderSlot).join('')
        for (const p of presets) logSlot(p)
      }
    } catch (err) {
      slotsEl.innerHTML = `<p class="hint warn">Reading slots failed: ${esc(String(err))}</p>`
      log(`Slot read failed: ${err}`, 'error')
    } finally {
      busy = false; updateButtons()
    }
  }

  function renderSlot(p: PresetData): string {
    const v = translatePresetToUI(p.settings)
    const rows = p.settings.map(s => {
      const nice = formatPresetValue(s.id, s.value) ?? String(s.value)
      const raw = Array.from(s.bytes).map(b => b.toString(16).padStart(2, '0')).join(' ')
      return `<tr><td class="label">${hex4(s.id)}</td><td>${esc(FujiPropNames[s.id] ?? '')}</td><td>${esc(nice)}</td><td class="raw">${raw}</td></tr>`
    }).join('')
    return `
      <details class="slot">
        <summary>
          <span class="slot-id">C${p.slot}</span>
          <span class="slot-name">${esc(p.name || '(no name)')}</span>
          <span class="slot-sum label">${esc(summarize(v))}</span>
        </summary>
        <table class="props"><tbody>${rows}</tbody></table>
      </details>`
  }

  function logSlot(p: PresetData) {
    const v = translatePresetToUI(p.settings)
    log(`C${p.slot} "${p.name}": ${summarize(v)}`)
    for (const s of p.settings) {
      const raw = Array.from(s.bytes).map(b => b.toString(16).padStart(2, '0')).join(' ')
      log(`    ${hex4(s.id)} ${(FujiPropNames[s.id] ?? '').padEnd(22)} = ${formatPresetValue(s.id, s.value) ?? s.value}  [${raw}]`)
    }
  }

  btnSlots.addEventListener('click', () => readSlots())

  // "Which values does THIS camera accept?" — needed for Phase 1's selectors.
  btnDescs.addEventListener('click', async () => {
    if (!camera) return
    busy = true; updateButtons()
    log('--- Reading property descriptions (GetDevicePropDesc, read-only) ---')
    try {
      const descs = await camera.scanPresetPropDescs()
      const rows = descs.map(d => {
        const text = describeForm(d)
        log(`  ${hex4(d.id)} ${(FujiPropNames[d.id] ?? '').padEnd(22)} ${d.writable ? 'rw' : 'ro'} type=${hex4(d.dataType)} ${text}`)
        return `<tr><td class="label">${hex4(d.id)}</td><td>${esc(FujiPropNames[d.id] ?? '')}</td><td>${d.writable ? 'rw' : 'ro'}</td><td>${esc(text)}</td></tr>`
      }).join('')
      $(root, '#descs').innerHTML = `
        <details class="slot" open>
          <summary><span class="slot-name">Allowed values (from camera)</span></summary>
          <table class="props"><tbody>${rows}</tbody></table>
        </details>`
      log(`Read ${descs.length} property descriptions`, 'ok')
    } catch (err) {
      log(`Reading descriptions failed: ${err}`, 'error')
    } finally {
      busy = false; updateButtons()
    }
  })

  btnDevInfo.addEventListener('click', () => {
    const info = camera?.deviceInfo
    if (!info) { log('No DeviceInfo available', 'warn'); return }
    log(`--- DeviceInfo: ${info.manufacturer} ${info.model} fw ${info.deviceVersion} ---`)
    log(`Operations (${info.operations.length}): ${info.operations.map(hex4).join(' ')}`)
    log(`Properties (${info.properties.length}): ${info.properties.map(hex4).join(' ')}`)
  })

  // ---- initial state ----
  updateButtons()
  log(`FilmLab ${__APP_VERSION__} ready. WebUSB ${'usb' in navigator ? 'available' : 'NOT available'}.`,
    'usb' in navigator ? 'ok' : 'error')
  if (!window.isSecureContext) log('Page is not served over HTTPS — WebUSB will be blocked.', 'error')
}
