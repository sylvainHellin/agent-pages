/* The offline badge (bottom of the screen while the app has no connection) and the mark on a list row whose page
   this device can show offline (src/lib/offline.ts). */
import { CloudCheckIcon, WifiOffIcon } from 'lucide-react'
import { rootUrl } from '@/lib/api'
import { useOffline, useSavedPages } from '@/lib/offline'
import { cn } from '@/lib/utils'

export function OfflineBadge() {
  const offline = useOffline()
  if (!offline) return null
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-[calc(var(--safe-bottom)+4.25rem)] left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur desk:bottom-4"
    >
      <WifiOffIcon className="size-3.5" />
      Offline: saved copies
    </div>
  )
}

/** A small cloud with a tick when the page at `url` (a server path) is saved on this device. */
export function SavedMark({ url, className }: { url: string; className?: string }) {
  const saved = useSavedPages()
  if (!saved.has(new URL(rootUrl(url.replace(/^\//, ''))).pathname)) return null
  return (
    <span title="Saved for offline reading" aria-label="Saved for offline reading" className={cn('inline-flex shrink-0 self-center text-faint', className)}>
      <CloudCheckIcon className="size-3.5" />
    </span>
  )
}
