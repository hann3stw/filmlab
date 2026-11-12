/**
 * Getting JPEGs out of the app: "save" (download → Download folder, which
 * Android's gallery shows) and "share" (Android share sheet).
 */

import { h, toast } from '../ui/dom.ts'
import { t } from '../i18n/index.ts'
import { log } from '../ui/debug-log.ts'

/** Download files one after another (Chrome may ask once to allow multiple downloads). */
export async function saveFiles(files: File[]): Promise<void> {
  for (const file of files) {
    const url = URL.createObjectURL(file)
    const a = h('a', { href: url, download: file.name })
    document.body.append(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
    // Small pause: browsers drop downloads that start in the same instant
    if (files.length > 1) await new Promise(r => setTimeout(r, 350))
  }
  toast(files.length === 1 ? t('ed.downloaded') : t('export.savedMany', { n: files.length }))
}

/** Open the share sheet. Returns true if the user shared (not cancelled). */
export async function shareFiles(files: File[]): Promise<boolean> {
  if (!navigator.canShare?.({ files })) {
    toast(t('ed.shareUnavailable'))
    return false
  }
  try {
    await navigator.share({ files })
    return true
  } catch (err) {
    if ((err as DOMException).name !== 'AbortError') {
      log(`Share failed: ${err}`, 'warn')
      toast(t('export.shareFailed'), 'error')
    }
    return false
  }
}

/** Share if the phone can share this file type; otherwise download it. */
export async function shareOrSave(file: File): Promise<void> {
  if (navigator.canShare?.({ files: [file] })) await shareFiles([file])
  else await saveFiles([file])
}
