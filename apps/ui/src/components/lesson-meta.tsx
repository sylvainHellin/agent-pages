/* Editing a page's metadata (PATCH api/items/<id>): status, tags, projects, topic/title/summary.
   The lesson tag of a page under a root adds or removes the lesson marker in its file; a tutor lesson keeps it. */
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { CheckIcon, ChevronDownIcon, PlusIcon, TagIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { LESSON_TAG, SETTABLE, type Item, type Status } from '@/lib/api'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ProjectChip, ProjectDot, ResponsiveDialog, STATUS_LABEL, StatusDot } from './bits'

/** Open, Done, Archived to pick; Sent shows while an agent has the page (Send to agent sets it). */
export function StatusMenu({ item, className }: { item: Item; className?: string }) {
  const patch = useStore((s) => s.patchItem)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn('gap-1.5 pr-1.5 pl-2', className)} aria-label={`Status: ${STATUS_LABEL[item.status]}`}>
          <StatusDot status={item.status} />
          <span>{STATUS_LABEL[item.status]}</span>
          <ChevronDownIcon className="size-3.5 text-faint" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {item.status === 'sent' ? (
          <>
            <DropdownMenuLabel className="flex items-center gap-2.5 font-normal text-muted-foreground">
              <StatusDot status="sent" /> Sent to an agent
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuRadioGroup value={item.status} onValueChange={(v) => patch(item.id, { status: v as Status }).catch(() => {})}>
          {SETTABLE.map((s) => (
            <DropdownMenuRadioItem key={s} value={s} className="gap-2.5">
              <StatusDot status={s} /> {STATUS_LABEL[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Open / Done / Archived as one row of buttons, for the details dialog. */
function StatusRow({ item }: { item: Item }) {
  const patch = useStore((s) => s.patchItem)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.status === 'sent' ? (
        <span className="mr-1 inline-flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground">
          <StatusDot status="sent" /> Sent
        </span>
      ) : null}
      {SETTABLE.map((s) => (
        <Button
          key={s}
          variant={item.status === s ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={item.status === s}
          className={cn('gap-2', item.status === s && 'border-foreground/20 font-semibold')}
          onClick={() => item.status !== s && patch(item.id, { status: s }).catch(() => {})}
        >
          <StatusDot status={s} /> {STATUS_LABEL[s]}
        </Button>
      ))}
    </div>
  )
}

export const normTag = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase()

/** The tags of a page: × removes one, the field adds one (Enter or comma), Backspace in an empty field takes the last.
    The lesson tag of a tutor lesson stays. */
export function TagEditor({ item, autoFocus, onKindChange }: { item: Item; autoFocus?: boolean; onKindChange?: () => void }) {
  const patch = useStore((s) => s.patchItem)
  const all = useStore((s) => s.pages)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const known = useMemo(() => [...new Set(all.flatMap((i) => i.tags))].filter((t) => !item.tags.includes(t)).sort(), [all, item.tags])
  const locked = (t: string) => t === LESSON_TAG && item.origin === 'tutor'
  const save = async (tags: string[]) => {
    if (busy) return
    setBusy(true)
    try {
      const next = await patch(item.id, { tags })
      if (!!next.slug !== !!item.slug) {
        setBusy(false)
        onKindChange?.() // the page moves to the other reader: the dialog closes first
        return
      }
    } catch {
      /* toast shown by the store */
    }
    setBusy(false)
    input.current?.focus()
  }
  const add = (raw: string) => {
    const fresh = raw.split(',').map(normTag).filter((t) => t && !item.tags.includes(t))
    setText('')
    if (fresh.length) save([...item.tags, ...new Set(fresh)])
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add(text)
    } else if (e.key === 'Backspace' && !text) {
      const last = [...item.tags].reverse().find((t) => !locked(t))
      if (last) save(item.tags.filter((t) => t !== last))
    }
  }
  const listId = `tags-${item.id}`
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {item.tags.map((t) => (
          <span key={t} className="inline-flex h-6 items-center gap-1 rounded-md border bg-card pr-1 pl-2 text-xs font-medium text-foreground/85">
            #{t}
            {locked(t) ? (
              <span className="px-0.5 text-[10.5px] font-normal text-faint" title="A tutor lesson keeps the lesson tag">
                fixed
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove tag ${t}`}
                title={t === LESSON_TAG ? 'Remove the lesson tag (and the lesson marker in the file)' : `Remove ${t}`}
                onClick={() => save(item.tags.filter((x) => x !== t))}
                className="grid size-4 place-items-center rounded-[4px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!item.tags.length ? <span className="text-xs text-faint">No tags yet.</span> : null}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          ref={input}
          value={text}
          list={listId}
          autoFocus={autoFocus}
          placeholder="Add a tag"
          aria-label="Add a tag"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={onKey}
          className="h-8 flex-1"
        />
        <Button variant="outline" size="sm" disabled={busy || !normTag(text)} onClick={() => add(text)}>
          <PlusIcon /> Add
        </Button>
        <datalist id={listId}>
          {known.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      {item.origin === 'report' && !item.tags.includes(LESSON_TAG) ? (
        <button type="button" disabled={busy} onClick={() => save([...item.tags, LESSON_TAG])} className="self-start text-xs text-muted-foreground underline decoration-border underline-offset-[3px] hover:text-primary">
          Tag as lesson (writes the lesson marker into the page file)
        </button>
      ) : null}
    </div>
  )
}

/** A button with the tag count that opens the tag editor. */
export function TagsButton({ item, className }: { item: Item; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="ghost" size="sm" className={cn('gap-1.5 px-2', className)} onClick={() => setOpen(true)} aria-label={`Tags: ${item.tags.join(', ') || 'none'}`} title={item.tags.map((t) => `#${t}`).join(' ') || 'Add tags'}>
        <TagIcon className="size-3.5" />
        <span className="tabular-nums">{item.tags.length || ''}</span>
      </Button>
      <TagsDialog item={item} open={open} onOpenChange={setOpen} />
    </>
  )
}

export function TagsDialog({ item, open, onOpenChange }: { item: Item; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Tags"
      description={<span className="line-clamp-2 break-keep">{item.title}</span>}
      footer={
        <Button onClick={() => onOpenChange(false)} className="min-w-16">
          Done
        </Button>
      }
    >
      <TagEditor item={item} onKindChange={() => onOpenChange(false)} />
    </ResponsiveDialog>
  )
}

/** Status, tags and projects of a page in one dialog: what the report page's bar opens. */
export function DetailsDialog({ item, open, onOpenChange }: { item: Item; open: boolean; onOpenChange: (o: boolean) => void }) {
  const unlink = useStore((s) => s.unlinkProject)
  const [picker, setPicker] = useState(false)
  const [edit, setEdit] = useState(false)
  const label = 'text-[12.5px] font-medium text-muted-foreground'
  return (
    <>
      <ResponsiveDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Status and tags"
        description={<span className="line-clamp-2 break-keep">{item.title}</span>}
        className="desk:sm:max-w-lg"
        footer={
          <Button onClick={() => onOpenChange(false)} className="min-w-16">
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <section className="flex flex-col gap-1.5">
            <h3 className={label}>Status</h3>
            <StatusRow item={item} />
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className={label}>Tags</h3>
            <TagEditor item={item} onKindChange={() => onOpenChange(false)} />
          </section>
          <section className="flex flex-col gap-1.5">
            <h3 className={label}>Projects</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              {item.projects.map((p) => (
                <ProjectChip key={p} id={p} warn={item.unknown_projects?.includes(p)} onRemove={() => unlink(item.id, p).catch(() => {})} />
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onOpenChange(false)
                  setPicker(true)
                }}
              >
                <PlusIcon /> Link to projects
              </Button>
            </div>
          </section>
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              setEdit(true)
            }}
            className="self-start text-xs text-muted-foreground underline decoration-border underline-offset-[3px] hover:text-primary"
          >
            Edit topic, title and summary…
          </button>
        </div>
      </ResponsiveDialog>
      <ProjectPicker id={item.id} open={picker} onOpenChange={setPicker} />
      <EditDetails item={item} open={edit} onOpenChange={setEdit} />
    </>
  )
}

/** Link or unlink vault projects: a searchable list, Enter / tap toggles. */
export function ProjectPicker({ id, open, onOpenChange }: { id: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const lesson = useStore((s) => s.pages.find((l) => l.id === id))
  const projects = useStore((s) => s.projects)
  const patch = useStore((s) => s.patchItem)
  const [busy, setBusy] = useState(false)
  // order fixed while the list is open, so a toggled row does not jump away under the pointer
  const order = useMemo(() => {
    const linked = new Set(lesson?.projects || [])
    return [...projects].sort((a, b) => {
      const la = linked.has(a.id), lb = linked.has(b.id)
      if (la !== lb) return la ? -1 : 1
      const aa = a.status === 'active', ab = b.status === 'active'
      if (aa !== ab) return aa ? -1 : 1
      return a.id.localeCompare(b.id)
    })
  }, [open, id, projects]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!lesson) return null
  const toggle = async (id: string) => {
    if (busy) return
    setBusy(true)
    const has = lesson.projects.includes(id)
    try {
      await patch(lesson.id, { projects: has ? lesson.projects.filter((p) => p !== id) : [...lesson.projects, id] })
    } catch {
      /* toast shown by the store */
    }
    setBusy(false)
  }
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Link to projects"
      description={<span className="line-clamp-2 break-keep">{lesson.title}</span>}
      className="desk:sm:max-w-lg"
      footer={
        <Button onClick={() => onOpenChange(false)} className="min-w-16">
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-2">
        <Command className="rounded-lg! border bg-card p-1" loop>
          <CommandInput placeholder="Find a project or area…" autoFocus={false} />
          <CommandList className="max-h-[min(50dvh,22rem)]">
            <CommandEmpty>No project matches.</CommandEmpty>
            <CommandGroup>
              {order.map((p) => {
                const on = lesson.projects.includes(p.id)
                return (
                  <CommandItem key={p.id} value={p.id} keywords={[p.notes || '', p.type || '']} onSelect={() => toggle(p.id)} className="gap-2.5 rounded-[5px] px-2 py-1.5">
                    <span className={cn('grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card')}>
                      {on ? <CheckIcon className="size-3" /> : null}
                    </span>
                    <ProjectDot id={p.id} className="size-[7px]" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{p.id}</span>
                    <span className="shrink-0 truncate text-[11.5px] text-faint">{[p.status, p.type].filter(Boolean).join(' · ')}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <p className="text-xs text-faint">Open projects and areas from the vault. Enter or tap toggles one.</p>
      </div>
    </ResponsiveDialog>
  )
}

export function EditDetails({ item: lesson, open, onOpenChange }: { item: Item; open: boolean; onOpenChange: (o: boolean) => void }) {
  const patch = useStore((s) => s.patchItem)
  const [f, setF] = useState({ title: '', topic: '', summary: '' })
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setF({ title: lesson.title || '', topic: lesson.topic || '', summary: lesson.summary || '' })
  } else if (!open && wasOpen) setWasOpen(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.title.trim()) return
    setBusy(true)
    try {
      await patch(lesson.id, { title: f.title.trim(), topic: f.topic.trim(), summary: f.summary.trim() })
      toast.success('Saved')
      onOpenChange(false)
    } catch {
      /* toast shown by the store */
    }
    setBusy(false)
  }
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit details"
      description="Topic, title and summary as the list shows them."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="edit-lesson" disabled={busy || !f.title.trim()}>
            Save
          </Button>
        </>
      }
    >
      <form id="edit-lesson" onSubmit={save} className="flex flex-col gap-3.5">
        <div className="grid gap-1.5">
          <Label className="text-[12.5px] text-muted-foreground" htmlFor="el-topic">Topic</Label>
          <Input id="el-topic" value={f.topic} placeholder="the subject area, e.g. LLM inference" onChange={(e) => setF({ ...f, topic: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-[12.5px] text-muted-foreground" htmlFor="el-title">Title</Label>
          <Input id="el-title" value={f.title} required onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-[12.5px] text-muted-foreground" htmlFor="el-summary">Summary</Label>
          <Textarea id="el-summary" rows={3} value={f.summary} placeholder="one line for the timeline" onChange={(e) => setF({ ...f, summary: e.target.value })} />
        </div>
      </form>
    </ResponsiveDialog>
  )
}
