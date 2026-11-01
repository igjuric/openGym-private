// A picture out of the app: the workout card, a milestone card.
// The phone app goes through the OS share sheet the way a backup does; a browser that can share
// files (most phones) opens its own; anything else saves the picture as a download.
import { MOBILE, shareExportBlob } from '../lib/mobile.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'

export async function shareImage(blob, name, title) {
  if (MOBILE) { try { await shareExportBlob(blob, name) } catch (e) { /* share sheet dismissed */ } return }
  const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null
  if (file && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title }) } catch (e) { /* dismissed */ }
    return
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
  useUI.getState().toast(t('Image saved'))
}
