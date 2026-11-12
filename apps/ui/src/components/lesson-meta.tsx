/* Editing a lesson's metadata (PATCH api/lessons/<slug>): status, projects, topic/title/summary/tags. */
import { useMemo, useState, type FormEvent } from 'react'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { Lesson, Status } from '@/lib/api'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ProjectDot, ResponsiveDialog, STATUS_LABEL, StatusDot } from './bits'

export function StatusMenu({ lesson, className }: { lesson: Lesson; className?: string }) {
  const patch = useStore((s) => s.patchLesson)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn('gap-1.5 pr-1.5 pl-2', className)} aria-label={`Status: ${STATUS_LABEL[lesson.status]}`}>
          <StatusDot status={lesson.status} />
          <span>{STATUS_LABEL[lesson.status]}</span>
          <ChevronDownIcon className="size-3.5 text-faint" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuRadioGroup value={lesson.status} onValueChange={(v) => patch(lesson.slug, { status: v as Status }).catch(() => {})}>
          {(['learning', 'understood', 'archived'] as Status[]).map((s) => (
            <DropdownMenuRadioItem key={s} value={s} className="gap-2.5">
              <StatusDot status={s} /> {STATUS_LABEL[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Link or unlink vault projects: a searchable list, Enter / tap toggles. */
export function ProjectPicker({ slug, open, onOpenChange }: { slug: string | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const lesson = useStore((s) => s.lessons.find((l) => l.slug === slug))
  const projects = useStore((s) => s.projects)
  const patch = useStore((s) => s.patchLesson)
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
  }, [open, slug, projects])
  if (!lesson) return null
  const toggle = async (id: string) => {
    if (busy) return
    setBusy(true)
    const has = lesson.projects.includes(id)
    try {
      await patch(lesson.slug, { projects: has ? lesson.projects.filter((p) => p !== id) : [...lesson.projects, id] })
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

export function EditLesson({ lesson, open, onOpenChange }: { lesson: Lesson; open: boolean; onOpenChange: (o: boolean) => void }) {
  const patch = useStore((s) => s.patchLesson)
  const [f, setF] = useState({ title: '', topic: '', summary: '', tags: '' })
  const [busy, setBusy] = useState(false)
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setF({ title: lesson.title || '', topic: lesson.topic || '', summary: lesson.summary || '', tags: (lesson.tags || []).join(', ') })
  } else if (!open && wasOpen) setWasOpen(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.title.trim()) return
    setBusy(true)
    try {
      await patch(lesson.slug, {
        title: f.title.trim(),
        topic: f.topic.trim(),
        summary: f.summary.trim(),
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      })
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
      title="Edit lesson"
      description="Topic, title, summary and tags as the library shows them."
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
        <div className="grid gap-1.5">
          <Label className="text-[12.5px] text-muted-foreground" htmlFor="el-tags">Tags</Label>
          <Input id="el-tags" value={f.tags} placeholder="comma separated" onChange={(e) => setF({ ...f, tags: e.target.value })} />
        </div>
      </form>
    </ResponsiveDialog>
  )
}
