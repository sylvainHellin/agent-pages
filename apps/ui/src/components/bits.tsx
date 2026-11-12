/* Small pieces shared by every view. */
import type { ReactNode } from 'react'
import { XIcon } from 'lucide-react'
import type { Status } from '@/lib/api'
import { NO_PROJECT_COLOR, projectColor } from '@/lib/format'
import { useIsDesktop } from '@/lib/hooks'
import { projectHash } from '@/lib/router'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** A small soft dot in the project's colour (grey for "no project"). */
export function ProjectDot({ id, className }: { id?: string | null; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', className)} style={{ background: id ? projectColor(id) : NO_PROJECT_COLOR }} />
}

/** Project name with its dot. Links to #/p/<id>; orange "?" when the project left the registry; optional unlink ×. */
export function ProjectChip({ id, warn, onRemove, link = true, className }: { id: string; warn?: boolean; onRemove?: () => void; link?: boolean; className?: string }) {
  const body = (
    <>
      <ProjectDot id={id} className="size-[7px]" />
      <span className="truncate">{id}</span>
      {warn && <span aria-hidden className="font-semibold text-attention">?</span>}
    </>
  )
  const inner = 'flex min-w-0 items-center gap-1.5 px-2'
  return (
    <span
      className={cn(
        'group/chip relative z-10 inline-flex h-6 max-w-full items-center rounded-md border border-border bg-card text-xs font-medium whitespace-nowrap text-foreground/85 transition-colors duration-150 hover:border-input',
        warn && 'border-attention/30 bg-attention/[0.06] text-attention',
        className,
      )}
      title={warn ? `${id}: no longer an open project in the vault` : `All lessons for ${id}`}
    >
      {link ? (
        <a href={projectHash(id)} className={cn(inner, 'h-full rounded-md hover:text-foreground', onRemove && 'pr-1')} onClick={(e) => e.stopPropagation()}>
          {body}
        </a>
      ) : (
        <span className={cn(inner, onRemove && 'pr-1')}>{body}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className="mr-1 grid size-4 place-items-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
          aria-label={`Unlink ${id}`}
          title={`Unlink ${id}`}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove()
          }}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  )
}

export const STATUS_LABEL: Record<Status, string> = { learning: 'Learning', understood: 'Understood', archived: 'Archived' }

/** Status as a shape: ring = learning (round trip open), filled = understood, grey = archived. Colour = the project's. */
export function StatusMark({ status, color, className }: { status: Status; color?: string; className?: string }) {
  const c = status === 'archived' ? NO_PROJECT_COLOR : color || 'var(--faint)'
  return (
    <span
      aria-hidden
      className={cn('inline-block size-[7px] shrink-0 rounded-full', status === 'learning' ? 'border-[1.5px]' : '', className)}
      style={status === 'learning' ? { borderColor: c } : { background: c }}
    />
  )
}

export function StatusDot({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-[7px] shrink-0 rounded-full',
        status === 'understood' && 'bg-primary',
        status === 'learning' && 'border-[1.5px] border-learning',
        status === 'archived' && 'bg-faint/60',
        className,
      )}
    />
  )
}

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground', className)}>
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-primary/20 border-t-primary', className)} />
}

/** A tooltip for an icon button: on hover (and keyboard focus) on desktop; none on a phone. Focus that comes back
    to the button after a menu or dialog closes does not open it. */
export function IconTip({ label, children, side }: { label: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  const desk = useIsDesktop()
  if (!desk) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger
        asChild
        onFocus={(e) => {
          if (!e.currentTarget.matches(':focus-visible')) e.preventDefault()
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Dialog on desktop, bottom sheet on a phone: same content, same handlers. */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const desk = useIsDesktop()
  if (desk)
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={cn('gap-5 p-5 sm:max-w-md', className)}>
          <DialogHeader className="gap-1 pr-8">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription className="text-[13px]">{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          {footer ? <DialogFooter>{footer}</DialogFooter> : null}
        </DialogContent>
      </Dialog>
    )
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn('max-h-[90dvh] gap-0 overflow-y-auto rounded-t-2xl border-0 pb-[max(var(--safe-bottom),0.75rem)] shadow-dialog', className)}
      >
        <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-foreground/15" />
        <SheetHeader className="px-4 pt-3 pb-4">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription className="text-[13px]">{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="px-4">{children}</div>
        {footer ? <SheetFooter className="flex-row justify-end gap-2 px-4 pt-4 pb-1">{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  )
}

export function PageHeader({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <header className={cn('mb-8 flex items-start gap-4', className)}>
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">{title}</h1>
        {description ? <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </header>
  )
}

/** A tiny muted label over a list. */
export function SectionLabel({ children, aside, className }: { children: ReactNode; aside?: ReactNode; className?: string }) {
  return (
    <div className={cn('mt-8 mb-2 flex items-baseline justify-between gap-3', className)}>
      <h2 className="text-xs font-medium text-muted-foreground">{children}</h2>
      {aside ? <div className="text-xs text-muted-foreground">{aside}</div> : null}
    </div>
  )
}

export function Empty({ title, children, className }: { title?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-dashed px-5 py-8 text-center text-[13px] leading-relaxed text-muted-foreground', className)}>
      {title ? <p className="mb-1 text-sm font-medium text-foreground">{title}</p> : null}
      {children}
    </div>
  )
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-border bg-card px-1 font-sans text-[10.5px] font-medium text-muted-foreground', className)}>{children}</kbd>
}
