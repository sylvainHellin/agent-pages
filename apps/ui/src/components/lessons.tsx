/* Empty and not-found states of the lesson lists. (The lists themselves are the month board, board.tsx.) */
import { FileQuestionIcon } from 'lucide-react'

export function LessonsEmptyHowto() {
  return (
    <div className="mx-auto max-w-lg py-16 text-center text-[13px] leading-relaxed text-muted-foreground">
      <p className="mb-2 text-[15px] font-semibold tracking-[-0.01em] text-foreground">No lessons yet</p>
      <p>
        Start one under{' '}
        <a className="font-medium text-primary underline-offset-4 hover:underline" href="#/new">
          New lesson
        </a>
        , or ask any agent: <code className="rounded-[4px] bg-foreground/[0.05] px-1.5 py-0.5 font-mono text-xs">tutor me on …</code>. The tutor skill files the lesson here.
      </p>
      <p className="mt-2">Started inside a repo that a vault project note names, the lesson is linked to that project. Link more later from the lesson's bar.</p>
    </div>
  )
}

export function NotFound({ what }: { what: string }) {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <FileQuestionIcon className="mx-auto mb-3 size-6 text-faint" />
      <p className="text-[15px] font-semibold tracking-[-0.01em]">Not found</p>
      <p className="mt-1 text-[13px] text-muted-foreground">{what}</p>
      <a href="#/" className="mt-4 inline-block text-[13px] font-medium text-primary hover:underline">
        ← All lessons
      </a>
    </div>
  )
}
