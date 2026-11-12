/* The light / dark switch of the app chrome: an icon button (headers) and a menu row (the reader's ⋯ menu).
   The state is shared with the pages (src/lib/theme.ts). */
import { MoonIcon, SunIcon } from 'lucide-react'
import { toggleMode, useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { IconTip } from './bits'

export function ThemeButton({ className, iconClassName, size = 'icon' }: { className?: string; iconClassName?: string; size?: 'icon' | 'icon-sm' }) {
  const dark = useTheme((s) => s.mode) === 'dark'
  const label = dark ? 'Light mode' : 'Dark mode'
  return (
    <IconTip label={label} side="bottom">
      <Button variant="ghost" size={size} className={cn('shrink-0', className)} onClick={toggleMode} aria-label={label} aria-pressed={dark}>
        {dark ? <SunIcon className={iconClassName} /> : <MoonIcon className={iconClassName} />}
      </Button>
    </IconTip>
  )
}

export function ThemeMenuItem() {
  const dark = useTheme((s) => s.mode) === 'dark'
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault()
        toggleMode()
      }}
      role="menuitemcheckbox"
      aria-checked={dark}
    >
      <MoonIcon /> <span className="flex-1">Dark mode</span>
      <Switch size="sm" checked={dark} tabIndex={-1} aria-hidden className="pointer-events-none" />
    </DropdownMenuItem>
  )
}
