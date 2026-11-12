/* #/new: a lesson from a topic, from collected links, or both.
   Everything typed here lives in the draft store (localStorage); the inbox and jobs refresh around it
   without re-mounting the fields, so polling never clears or blurs them. */
import { useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRightIcon, ChevronDownIcon, ClipboardPasteIcon, ExternalLinkIcon, PlusIcon, SmartphoneIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { findLinks, type InboxItem } from '@/lib/api'
import { useDraft } from '@/lib/draft'
import { useIsDesktop } from '@/lib/hooks'
import { ago, host, plural } from '@/lib/format'
import { lessonHash } from '@/lib/router'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Empty, Kbd, PageHeader, ProjectDot, Spinner } from '@/components/bits'
import { JobList, recentJobs } from '@/components/jobs'

const NONE = '__none'

function TopicSection({ focusRef }: { focusRef: React.RefObject<HTMLTextAreaElement | null> }) {
  const focus = useDraft((s) => s.focus)
  const project = useDraft((s) => s.project)
  const search = useDraft((s) => s.search)
  const nSel = useDraft((s) => s.sel.length)
  const set = useDraft((s) => s.set)
  const projects = useStore((s) => s.projects)
  const sorted = [...projects]
    .filter((p) => p.status !== 'archived' || p.id === project)
    .sort((a, b) => {
      const aa = a.status === 'active', ab = b.status === 'active'
      if (aa !== ab) return aa ? -1 : 1
      return a.id.localeCompare(b.id)
    })
  return (
    <section className="flex flex-col">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor="nl-focus" className="text-[13px] font-medium">
          {nSel ? 'What do you want to get out of it?' : 'What do you want to learn?'}
        </label>
        <span className="text-xs text-faint">{nSel ? 'optional with links' : 'any language'}</span>
      </div>
      <Textarea
        id="nl-focus"
        ref={focusRef}
        rows={4}
        value={focus}
        onChange={(e) => set({ focus: e.target.value })}
        placeholder={nSel ? 'e.g. the core idea in 10 minutes, and whether it helps render2bim' : 'e.g. How Gaussian splatting renders a view, and what I would need to use it for render2bim'}
        className="min-h-28 resize-y px-3 py-2.5 leading-relaxed desk:text-sm"
        aria-label="What do you want to learn?"
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-2.5 max-desk:w-full">
          <Label htmlFor="nl-project" className="shrink-0 text-[13px] font-normal text-muted-foreground">
            Project
          </Label>
          <Select value={project || NONE} onValueChange={(v) => set({ project: v === NONE ? '' : v })}>
            <SelectTrigger id="nl-project" className="w-56 max-desk:flex-1">
              <SelectValue placeholder="No project" />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-80">
              <SelectItem value={NONE}>
                <span className="text-muted-foreground">No project</span>
              </SelectItem>
              {sorted.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <ProjectDot id={p.id} className="size-[7px]" />
                  {p.id}
                  {p.status && p.status !== 'active' ? <span className="text-muted-foreground"> ({p.status})</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex min-h-8 cursor-pointer items-center gap-2.5 text-[13px] select-none" title="Let the agent look for more sources on the web (Exa search)">
          <Switch id="nl-search" checked={search} onCheckedChange={(v) => set({ search: v === true })} />
          <span>
            Search the web for more sources <span className="text-faint">· Exa</span>
          </span>
        </label>
      </div>
    </section>
  )
}

function LinkRow({ item: i, onDelete }: { item: InboxItem; onDelete: () => void }) {
  const on = useDraft((s) => s.sel.includes(i.id))
  const toggle = useDraft((s) => s.toggle)
  let path = ''
  try {
    const u = new URL(i.url)
    path = (u.pathname + u.search).replace(/\/$/, '')
  } catch {
    /* not a URL */
  }
  return (
    <li className="group flex items-start gap-3 py-2.5 pr-1 pl-0.5">
      <Checkbox id={`ln-${i.id}`} checked={on} onCheckedChange={() => toggle(i.id)} className="mt-[3px]" aria-label={`Use ${i.title || i.url}`} />
      <label htmlFor={`ln-${i.id}`} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[13.5px] leading-snug break-keep [overflow-wrap:anywhere]">{i.title || i.url}</span>
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <a href={i.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()} className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-foreground">
            <span className="truncate">
              {host(i.url)}
              {path.length > 1 ? <span className="text-faint">{path.slice(0, 48)}</span> : null}
            </span>
            <ExternalLinkIcon className="size-3 shrink-0" />
          </a>
          <span className="shrink-0 text-faint">· {ago(i.added)}</span>
          {(i.lessons || []).map((s) => (
            <a key={s} href={lessonHash(s)} onClick={(e) => e.stopPropagation()} className="inline-flex shrink-0 items-center gap-0.5 font-medium text-primary hover:underline">
              · lesson ✓
            </a>
          ))}
        </span>
        {i.note ? <span className="mt-1 block text-[12.5px] text-muted-foreground break-keep">{i.note}</span> : null}
      </label>
      <Button variant="ghost" size="icon-sm" className="shrink-0 hover:text-destructive desk:opacity-0 desk:group-hover:opacity-100 desk:focus-visible:opacity-100" onClick={onDelete} aria-label="Remove link" title="Remove">
        <Trash2Icon className="size-3.5" />
      </Button>
    </li>
  )
}

function SourcesSection() {
  const links = useDraft((s) => s.links)
  const note = useDraft((s) => s.note)
  const nSel = useDraft((s) => s.sel.length)
  const set = useDraft((s) => s.set)
  const select = useDraft((s) => s.select)
  const clearSel = useDraft((s) => s.clearSel)
  const items = useStore((s) => s.items)
  const loaded = useStore((s) => s.inboxLoaded)
  const addLinks = useStore((s) => s.addLinks)
  const removeLink = useStore((s) => s.removeLink)
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<InboxItem | null>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const desk = useIsDesktop()
  const found = findLinks(links)

  const add = async () => {
    const text = links.trim()
    if (!text) return ta.current?.focus()
    setBusy(true)
    try {
      const added = await addLinks(text, note.trim())
      select(added.map((i) => i.id))
      set({ links: '', note: '' })
      toast.success(added.length ? `${plural(added.length, 'link')} added and selected` : 'Already collected')
    } catch (e) {
      toast.error((e as Error).message)
    }
    setBusy(false)
  }
  const paste = async () => {
    try {
      const s = (await navigator.clipboard.readText()).trim()
      if (!s) return toast('The clipboard is empty')
      const cur = useDraft.getState().links.trim()
      set({ links: cur ? `${cur}\n${s}` : s })
    } catch {
      toast('Tap the field and paste')
      ta.current?.focus()
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      add()
    }
  }
  return (
    <section className="mt-10">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-medium">
          Sources <span className="font-normal text-muted-foreground">· optional</span>
        </h2>
        <span className="text-xs text-faint">shared with your other devices</span>
      </div>
      <div className="rounded-md border border-input bg-card shadow-[0_1px_1px_rgb(0_0_0/0.03)] transition-[border-color,box-shadow] duration-150 focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/15">
        <Textarea
          ref={ta}
          rows={3}
          value={links}
          onChange={(e) => set({ links: e.target.value })}
          onKeyDown={onKey}
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Paste links, one per line (any text with links in it works)"
          className="min-h-20 resize-y rounded-b-none border-0 bg-transparent px-3 py-2.5 shadow-none focus-visible:ring-0 desk:text-sm"
          aria-label="Links to add"
        />
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-1.5 py-1.5">
          <input
            data-slot="input"
            value={note}
            onChange={(e) => set({ note: e.target.value })}
            placeholder={desk ? 'Note for these links (optional)' : 'Note (optional)'}
            className="h-8 min-w-40 flex-1 bg-transparent px-1.5 text-base outline-none placeholder:text-faint desk:text-[13px]"
            aria-label="Note"
          />
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={paste}>
              <ClipboardPasteIcon /> Paste
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={add} disabled={busy || !links.trim()}>
              {busy ? <Spinner /> : <PlusIcon />} {found.length > 1 ? `Add ${found.length} links` : 'Add link'}
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-faint">
        {links.trim() && !found.length ? <span className="text-muted-foreground">No http(s) link in the text yet.</span> : null}
        <span className="hidden items-center gap-1 desk:inline-flex">
          <Kbd>Ctrl</Kbd>
          <Kbd>Enter</Kbd> adds them.
        </span>
        <span>New links are selected for this lesson.</span>
      </p>

      <div className="mt-6 flex h-7 items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          Collected links <span className="text-faint tabular-nums">· {items.length}</span>
        </h3>
        {nSel ? (
          <button type="button" onClick={clearSel} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            Clear selection
          </button>
        ) : null}
      </div>
      {!loaded ? (
        <div className="flex flex-col gap-2 pt-1">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : items.length ? (
        <ul className="divide-y border-y">
          {items.map((i) => (
            <LinkRow key={i.id} item={i} onDelete={() => setDel(i)} />
          ))}
        </ul>
      ) : (
        <p className="border-y py-5 text-center text-[13px] text-muted-foreground">No links yet. Links added here, on another device or from the Share Sheet show up in both places.</p>
      )}

      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this link?</AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] break-keep [overflow-wrap:anywhere]">{del?.title || del?.url}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const it = del
                setDel(null)
                if (it) removeLink(it.id).then(() => toast('Link removed'), (e) => toast.error((e as Error).message))
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function ShortcutHelp() {
  const shortcut = location.origin + location.pathname + '#/add?u='
  return (
    <Collapsible className="mt-10 border-t pt-4 text-[13px] text-muted-foreground">
      <CollapsibleTrigger className="group flex min-h-8 w-full items-center gap-2 text-left transition-colors hover:text-foreground">
        <SmartphoneIcon className="size-3.5" /> Add to Home Screen and share links from Safari
        <ChevronDownIcon className="size-3.5 transition-transform duration-150 group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 ml-5 list-decimal space-y-1.5 leading-relaxed">
          <li>
            In Safari: Share → <b className="font-medium text-foreground">Add to Home Screen</b>. Agent Pages then opens like an app.
          </li>
          <li>
            Shortcuts app → new shortcut → ⓘ → turn on <b className="font-medium text-foreground">Show in Share Sheet</b>, input: URLs and Safari web pages.
          </li>
          <li>
            Add <b className="font-medium text-foreground">URL Encode</b> on the Shortcut Input, then <b className="font-medium text-foreground">Open URLs</b> with{' '}
            <code className="rounded-[4px] bg-foreground/[0.05] px-1 font-mono text-xs break-all">{shortcut}</code> followed by the encoded text.
          </li>
          <li>Name it “Send to Tutor”. In Safari: Share → Send to Tutor adds the page to the collected links.</li>
        </ol>
      </CollapsibleContent>
    </Collapsible>
  )
}

function InProgress() {
  const jobs = useStore((s) => s.jobs)
  const loaded = useStore((s) => s.inboxLoaded)
  const recent = recentJobs(jobs, 3, 6)
  return (
    <section className="mt-12">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-medium text-muted-foreground">Recent jobs</h2>
        <a href="#/jobs" className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          All jobs <ArrowRightIcon className="size-3" />
        </a>
      </div>
      {!loaded ? (
        <Skeleton className="h-14 w-full rounded-[10px]" />
      ) : recent.length ? (
        <JobList jobs={recent} />
      ) : (
        <Empty className="py-6">Nothing in progress. A lesson you start shows up here; you can start another while one is being written.</Empty>
      )}
    </section>
  )
}

export function NewLessonView() {
  const focusRef = useRef<HTMLTextAreaElement>(null)
  const createJob = useStore((s) => s.createJob)
  const nSel = useDraft((s) => s.sel.length)
  const hasTopic = useDraft((s) => !!s.focus.trim())
  const [sending, setSending] = useState(false)

  const make = async () => {
    const d = useDraft.getState()
    const focus = d.focus.trim()
    if (!d.sel.length && !focus) {
      toast.error('Write a topic or select a link')
      focusRef.current?.focus()
      return
    }
    setSending(true)
    try {
      await createJob({ items: d.sel, focus, project: d.project, search: d.search })
      useDraft.getState().set({ focus: '', sel: [] })
      toast.success('Sent to the tutor', { description: 'The lesson appears in the library when it is ready.' })
    } catch (e) {
      toast.error((e as Error).message)
    }
    setSending(false)
  }

  const summary = nSel ? `${plural(nSel, 'link')} selected${hasTopic ? ' + your topic' : ''}` : hasTopic ? 'Topic only, no links' : 'Write a topic or pick links'

  return (
    <div className="w-full">
      <div className="mx-auto w-full max-w-[42rem] px-4 pt-4 desk:px-8 desk:pt-12">
        <PageHeader
          className="max-desk:mb-5 max-desk:[&_h1]:hidden"
          title="New lesson"
          description="A topic, links to learn from, or both. The tutor agent runs on the home server and files the lesson in the library."
        />
        <TopicSection focusRef={focusRef} />
        <SourcesSection />
      </div>
      {/* the action bar: one hairline strip that stays at the bottom while the form is longer than the screen */}
      <div className="sticky bottom-[calc(var(--tabbar-h)+var(--safe-bottom))] z-20 mt-8 border-y border-foreground/[0.06] bg-background/85 backdrop-blur-xl backdrop-saturate-150 desk:bottom-0 desk:border-b-0">
        <div className="mx-auto flex h-12 w-full max-w-[42rem] items-center gap-3 px-4 desk:h-[52px] desk:px-8">
          <span className={cn('min-w-0 flex-1 truncate text-[13px]', nSel || hasTopic ? 'text-foreground/80' : 'text-muted-foreground')}>{summary}</span>
          <Button onClick={make} disabled={sending} className="shrink-0 px-3.5 max-desk:h-9">
            {sending ? <Spinner className="border-primary-foreground/30 border-t-primary-foreground" /> : <SparklesIcon className="size-3.5" />} Make a lesson
          </Button>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[42rem] px-4 pb-10 desk:px-8">
        <InProgress />
        <ShortcutHelp />
      </div>
    </div>
  )
}
