/* The offline badge (bottom of the screen while the app has no connection, or while the Open pages are being saved),
   the mark on a list row whose page this device can show offline, and the switch for saving every Open page
   (src/lib/offline.ts). */
import { CloudCheckIcon, CloudDownloadIcon, WifiOffIcon } from 'lucide-react'
import { rootUrl } from '@/lib/api'
import { setAutoSave, useAutoSave, useOffline, useSavedPages, useSaving } from '@/lib/offline'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'

export function OfflineBadge() {
  const offline = useOffline()
  const saving = useSaving()
  if (!offline && !saving) return null
  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-[calc(var(--safe-bottom)+4.25rem)] left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur desk:bottom-4"
    >
      {offline ? (
        <>
          <WifiOffIcon className="size-3.5" />
          Offline: saved copies
        </>
      ) : (
        <>
          <CloudDownloadIcon className="size-3.5" />
          <span className="tabular-nums">
            Saving {Math.min(saving!.done + 1, saving!.total)} of {saving!.total}
          </span>
        </>
      )}
    </div>
  )
}

const AUTO_LABEL = 'Save Open pages offline'
const AUTO_HINT = 'Downloads every Open page (up to 150 MB) when the list loads; turn off on a cellular-heavy day'

function toggleAuto(on: boolean) {
  const s = useStore.getState()
  setAutoSave(on, s.pagesLoaded && !s.loadError ? s.pages : null)
}

/** Desktop sidebar: the switch as a row. */
export function AutoSaveRow({ className }: { className?: string }) {
  const on = useAutoSave()
  return (
    <label title={AUTO_HINT} className={cn('flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-[12.5px] text-muted-foreground hover:text-foreground', className)}>
      <span className="flex-1">{AUTO_LABEL}</span>
      <Switch size="sm" checked={on} onCheckedChange={toggleAuto} aria-label={AUTO_LABEL} />
    </label>
  )
}

/** Phone header menu: the switch as a menu row. */
export function AutoSaveMenuItem() {
  const on = useAutoSave()
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault()
        toggleAuto(!on)
      }}
      role="menuitemcheckbox"
      aria-checked={on}
      className="gap-2.5"
    >
      <CloudDownloadIcon className="text-muted-foreground" />
      <span className="flex-1">{AUTO_LABEL}</span>
      <Switch size="sm" checked={on} tabIndex={-1} aria-hidden className="pointer-events-none" />
    </DropdownMenuItem>
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
