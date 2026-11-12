import { useSyncExternalStore } from 'react'

const DESK = '(min-width: 900px)'

function subscribeMedia(q: string) {
  return (cb: () => void) => {
    const m = matchMedia(q)
    m.addEventListener('change', cb)
    return () => m.removeEventListener('change', cb)
  }
}

const subDesk = subscribeMedia(DESK)

/** >= 900 px: sidebar layout, dialogs and popovers; below: tab bar and bottom sheets. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subDesk, () => matchMedia(DESK).matches)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  document.body.append(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  return ok
}
