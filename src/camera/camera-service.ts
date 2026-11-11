/**
 * CameraService — the ONE place in the app that owns the camera connection.
 *
 * Screens never talk to the camera directly; they call this service and
 * subscribe to its status. Benefits:
 *  - only one USB connection, shared by editor, camera tab, etc.
 *  - automatic reconnect: once you have allowed the camera, plugging it in
 *    (or switching it on) connects it without any dialog
 *  - the service remembers which RAF is currently inside the camera, so the
 *    50 MB upload only happens when you switch to another photo
 */

import { FujiCamera, CancelledError, type ConvertHooks } from './ptp/session.ts'
import { FUJI_VENDOR_ID } from './ptp/constants.ts'
import { patchProfile } from './profile/d185.ts'
import { toConversionParams, type Recipe } from '../recipes/recipe.ts'
import { log } from '../ui/debug-log.ts'

export type CameraStatus =
  | 'unsupported'   // browser has no WebUSB (not Chrome, or not HTTPS)
  | 'idle'          // never paired: user must tap "Connect" once
  | 'waiting'       // paired before, waiting for the camera to be plugged in
  | 'connecting'
  | 'connected'
  | 'wrong-mode'    // connected, but not in USB RAW CONV./BACKUP RESTORE mode
  | 'error'

const PAIRED_KEY = 'filmlab.cameraPaired'

export class CameraService {
  status: CameraStatus = 'idle'
  /** Last error text (for the UI), if status = 'error' */
  errorText = ''
  camera: FujiCamera | null = null
  /** Which photo's RAF is loaded in the camera right now */
  private loadedPhotoId: string | null = null
  private listeners = new Set<() => void>()
  private autoConnecting = false
  private upload: { photoId: string; promise: Promise<void> } | null = null

  get model(): string { return this.camera?.modelName ?? '' }
  get firmware(): string { return this.camera?.firmwareVersion ?? '' }
  get isReady(): boolean { return this.status === 'connected' }

  /** Subscribe to status changes. Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private setStatus(s: CameraStatus, errorText = '') {
    this.status = s
    this.errorText = errorText
    this.listeners.forEach(fn => fn())
  }

  private get pairedBefore(): boolean {
    try { return localStorage.getItem(PAIRED_KEY) === '1' } catch { return false }
  }

  /** Call once at app start. */
  async init(): Promise<void> {
    if (!('usb' in navigator) || !window.isSecureContext) {
      this.setStatus('unsupported')
      return
    }
    this.setStatus(this.pairedBefore ? 'waiting' : 'idle')

    // Fired when an already-allowed device is plugged in / switched on.
    navigator.usb.addEventListener('connect', e => {
      if (e.device.vendorId === FUJI_VENDOR_ID && !this.camera) {
        log('USB: camera plugged in — connecting automatically')
        void this.connectKnown(e.device)
      }
    })
    navigator.usb.addEventListener('disconnect', e => {
      if (this.camera?.isDevice(e.device)) {
        log('--- Camera disconnected (cable or power) ---', 'warn')
        void this.camera.disconnect().catch(() => {})
        this.camera = null
        this.loadedPhotoId = null
        this.setStatus('waiting')
      }
    })
    window.addEventListener('beforeunload', () => this.camera?.emergencyClose())

    // Already plugged in and allowed? Connect right away.
    const devices = await navigator.usb.getDevices()
    const fuji = devices.find(d => d.vendorId === FUJI_VENDOR_ID)
    if (fuji) await this.connectKnown(fuji)
  }

  /** "Connect" button: shows Chrome's device picker (needs a user tap). */
  async connectInteractive(): Promise<void> {
    if (this.camera) return
    await this.doConnect()
  }

  private async connectKnown(device: USBDevice): Promise<void> {
    if (this.autoConnecting || this.camera) return
    this.autoConnecting = true
    try { await this.doConnect(device) } finally { this.autoConnecting = false }
  }

  private async doConnect(device?: USBDevice): Promise<void> {
    const prev = this.status
    this.setStatus('connecting')
    const cam = new FujiCamera(msg => log(msg))
    const res = await cam.connect(device)
    if (!res.ok) {
      if (res.error === 'cancelled') { this.setStatus(prev === 'connecting' ? 'idle' : prev); return }
      const text = res.error === 'interface-busy' ? 'busy' : 'failed'
      log(`Camera connection failed (${res.error})`, 'warn')
      this.setStatus('error', text)
      return
    }
    try { localStorage.setItem(PAIRED_KEY, '1') } catch { /* ignore */ }
    this.camera = cam
    this.loadedPhotoId = null
    if (!cam.supportsRawConversion) {
      log('Camera does not offer RAW conversion — wrong USB mode?', 'warn')
      this.setStatus('wrong-mode')
      return
    }
    log(`Connected: ${cam.modelName} · firmware ${cam.firmwareVersion}`, 'ok')
    this.setStatus('connected')
  }

  async disconnect(): Promise<void> {
    if (!this.camera) return
    await this.camera.disconnect()
    this.camera = null
    this.loadedPhotoId = null
    this.setStatus(this.pairedBefore ? 'waiting' : 'idle')
  }

  /**
   * Render a photo with a recipe IN THE CAMERA and return the JPEG.
   *
   * Uploads the RAF first if a different photo is in the camera. If a newer
   * render is requested while this one waits, this one is cancelled
   * (throws CancelledError) — only the latest settings matter.
   */
  async render(
    photoId: string,
    getRaf: () => Promise<ArrayBuffer | null>,
    recipe: Recipe,
    asShot: Recipe,
    hooks: ConvertHooks = {},
  ): Promise<Uint8Array> {
    const cam = this.camera
    if (!cam || this.status !== 'connected') throw new Error('Camera not connected')

    if (this.loadedPhotoId !== photoId || !cam.rafLoaded) {
      // If an upload of this same photo is already running, wait for it
      // instead of uploading 50 MB a second time.
      if (!this.upload || this.upload.photoId !== photoId) {
        const promise = (async () => {
          const raf = await getRaf()
          if (!raf) throw new Error('RAF file missing from storage')
          this.loadedPhotoId = null
          await cam.uploadRaf(raf, hooks)
          this.loadedPhotoId = photoId
        })()
        this.upload = { photoId, promise }
        promise.catch(() => {}).finally(() => { if (this.upload?.promise === promise) this.upload = null })
      }
      await this.upload.promise
    }
    const params = toConversionParams(recipe, asShot)
    log(`Render: ${JSON.stringify(params)}`)
    return cam.reconvert(base => patchProfile(base, params), hooks)
  }
}

export { CancelledError }

/** The single shared instance used by the whole app. */
export const cameraService = new CameraService()
