import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { useDraft } from '@/lib/draft'
import { useIsDesktop } from '@/lib/hooks'
import { navigate, parse, useHash } from '@/lib/router'
import { useStore } from '@/lib/store'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/shell'
import { JobsView } from '@/views/JobsView'
import { BoardView } from '@/views/LibraryView'
import { NewLessonView } from '@/views/NewLessonView'
import { PageView } from '@/views/PageView'
import { ReaderView } from '@/views/ReaderView'
import { ReportsView } from '@/views/ReportsView'

export default function App() {
  const hash = useHash()
  const route = parse(hash)
  const desk = useIsDesktop()
  const back = useRef('#/') // the list a lesson or report page was opened from

  // first load, and fresh lists whenever the app comes back to the front
  useEffect(() => {
    const { loadLessons, loadInbox, loadPages } = useStore.getState()
    loadLessons().catch((e) => toast.error(`Could not load the lessons: ${(e as Error).message}`))
    loadInbox().catch(() => {})
    loadPages().catch(() => {})
    let last = Date.now()
    const again = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 5000) return
      last = Date.now()
      useStore.getState().refreshAll().catch(() => {})
    }
    document.addEventListener('visibilitychange', again)
    window.addEventListener('focus', again)
    return () => {
      document.removeEventListener('visibilitychange', again)
      window.removeEventListener('focus', again)
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
            : route.name === 'reports'
              ? 'Reports · Agent Pages'
              : 'Agent Pages'
    window.scrollTo(0, 0)
  }, [hash]) // eslint-disable-line react-hooks/exhaustive-deps

  let view: React.ReactNode
  switch (route.name) {
    case 'lesson':
      view = <ReaderView slug={route.slug} backHash={back.current} />
      break
    case 'project':
      view = <BoardView filter={{ kind: 'project', id: route.id }} />
      break
    case 'unlinked':
      view = <BoardView filter={{ kind: 'unlinked' }} />
      break
    case 'new':
    case 'add':
      view = <NewLessonView />
      break
    case 'jobs':
      view = <JobsView />
      break
    case 'reports':
      view = <ReportsView area={route.area} />
      break
    case 'page':
      view = <PageView url={route.url} backHash={back.current.startsWith('#/reports') ? back.current : '#/reports'} />
      break
    default:
      view = <BoardView filter={{ kind: 'all' }} />
  }

  return (
    <TooltipProvider delayDuration={400} skipDelayDuration={200}>
      <AppShell route={route}>{view}</AppShell>
      <Toaster
        position={desk ? 'bottom-right' : 'top-center'}
        offset={desk ? { right: 20, bottom: 64 } : undefined}
        mobileOffset={{ top: 'calc(var(--safe-top) + 3.75rem)', left: '0.75rem', right: '0.75rem' }}
        closeButton={desk}
      />
    </TooltipProvider>
  )
}
