import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useDraft } from '@/lib/draft'
import { autoSave } from '@/lib/offline'
import { useIsDesktop } from '@/lib/hooks'
import { navigate, parse, useHash } from '@/lib/router'
import { useStore } from '@/lib/store'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/shell'
import { OfflineBadge } from '@/components/offline'
import { JobsView } from '@/views/JobsView'
import { ListView } from '@/views/LibraryView'
import { NewLessonView } from '@/views/NewLessonView'
import { PageView } from '@/views/PageView'
import { ReaderView } from '@/views/ReaderView'

export default function App() {
  const hash = useHash()
  const route = parse(hash)
  const desk = useIsDesktop()
  const back = useRef('#/') // the list a page was opened from

  // first load, and fresh lists whenever the app comes back to the front or back online; each list loaded from the
  // server has the offline worker save its Open pages (lib/offline.ts autoSave: on load, then at most every 30 min)
  useEffect(() => {
    const { loadInbox, loadPages } = useStore.getState()
    const save = (reason: 'load' | 'visible' | 'online') => autoSave(useStore.getState().pages, reason)
    loadPages().then(
      () => save('load'),
      (e) => toast.error(`Could not load the pages: ${(e as Error).message}`),
    )
    loadInbox().catch(() => {})
    let last = Date.now()
    const again = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 5000) return
      last = Date.now()
      const s = useStore.getState()
      s.loadPages().then(() => save('visible'), () => {})
      s.loadInbox().catch(() => {})
    }
    const online = () => {
      useStore.getState().loadPages().then(() => save('online'), () => {})
    }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    window.addEventListener('online', online)
    return () => {
      document.removeEventListener('visibilitychange', again)
      window.removeEventListener('focus', again)
      window.removeEventListener('online', online)
    }
  }, [])

  // #/add?u=<url>&n=<note>: the iOS Share-Sheet shortcut
  const adding = useRef('')
  useEffect(() => {
    if (route.name !== 'add') return
    if (adding.current === hash) return
    adding.current = hash
    const { url, note } = route
    navigate('#/new', { replace: true })
    if (!url) return
    useStore
      .getState()
      .addLinks(url, note)
      .then((added) => {
        useDraft.getState().select(added.map((i) => i.id))
        toast.success(added.length ? `Added ${added.length} link${added.length > 1 ? 's' : ''}` : 'Already in the list')
      })
      .catch((e) => toast.error((e as Error).message))
  }, [hash]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (route.name !== 'lesson' && route.name !== 'page' && route.name !== 'add') back.current = hash || '#/'
    if (route.name === 'lesson' || route.name === 'page') return // the reader sets the page title
    document.title =
      route.name === 'project'
        ? `${route.id} · Agent Pages`
        : route.name === 'new'
          ? 'New lesson · Agent Pages'
          : route.name === 'jobs'
            ? 'Jobs · Agent Pages'
            : route.name === 'area'
              ? `${route.area} · Agent Pages`
              : 'Agent Pages'
    window.scrollTo(0, 0)
  }, [hash]) // eslint-disable-line react-hooks/exhaustive-deps

  let view: React.ReactNode
  switch (route.name) {
    case 'lesson':
      view = <ReaderView slug={route.slug} backHash={back.current} />
      break
    case 'project':
      view = <ListView scope={{ kind: 'project', id: route.id }} />
      break
    case 'unlinked':
      view = <ListView scope={{ kind: 'unlinked' }} />
      break
    case 'area':
      view = <ListView scope={{ kind: 'area', area: route.area }} />
      break
    case 'new':
    case 'add':
      view = <NewLessonView />
      break
    case 'jobs':
      view = <JobsView />
      break
    case 'page':
      view = <PageView url={route.url} backHash={back.current} />
      break
    default:
      view = <ListView scope={{ kind: 'all' }} />
  }

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <AppShell route={route}>{view}</AppShell>
      <OfflineBadge />
      <Toaster
        position={desk ? 'bottom-right' : 'top-center'}
        offset={desk ? { right: 20, bottom: 64 } : undefined}
        mobileOffset={{ top: 'calc(var(--safe-top) + 3.75rem)', left: '0.75rem', right: '0.75rem' }}
        closeButton={desk}
      />
    </TooltipProvider>
  )
}
