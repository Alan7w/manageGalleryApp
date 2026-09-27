import type { Bucket } from '@shared/types'
import clsx from 'clsx'
import { motion } from 'motion/react'
import { ArrowRight, Copy, Film, Focus, Ghost, Layers, Trash2, type LucideIcon } from 'lucide-react'
import { Button, Loading } from '@/components/ui'
import { useOverview } from '@/lib/api'
import { bytes, count, eta, plural } from '@/lib/format'
import { useStore, type View } from '@/lib/store'

interface CardSpec {
  view: View
  icon: LucideIcon
  title: string
  text: string
  color: string
  bucket: (b: NonNullable<ReturnType<typeof useOverview>['data']>) => Bucket
  unit: (b: Bucket) => string
}

const CARDS: CardSpec[] = [
  {
    view: 'similar',
    icon: Layers,
    title: 'Similar & Bursts',
    text: 'Shots of the same moment. Keep the best, lose the rest.',
    color: '#8f80ff',
    bucket: (o) => o.cleanup.similar,
    unit: (b) => `${plural(b.groups ?? 0, 'group')} · ${plural(b.items, 'extra shot')}`
  },
  {
    view: 'duplicates',
    icon: Copy,
    title: 'Duplicates',
    text: 'Identical files saved more than once — across folders and drives.',
    color: '#4fb3ff',
    bucket: (o) => o.cleanup.duplicates,
    unit: (b) => `${plural(b.groups ?? 0, 'set')} · ${plural(b.items, 'extra copy', 'extra copies')}`
  },
  {
    view: 'blurry',
    icon: Focus,
    title: 'Blurry',
    text: 'Out of focus or shaken. Sorted blurriest first.',
    color: '#ffad4d',
    bucket: (o) => o.cleanup.blurry,
    unit: (b) => plural(b.items, 'photo')
  },
  {
    view: 'junk',
    icon: Ghost,
    title: 'Junk',
    text: 'Screenshots, pocket shots, receipts and tiny images.',
    color: '#ff7ab8',
    bucket: (o) => o.cleanup.junk,
    unit: (b) => plural(b.items, 'item')
  },
  {
    view: 'videos',
    icon: Film,
    title: 'Large Videos',
    text: 'The biggest files eating your storage.',
    color: '#3ed99a',
    bucket: (o) => o.cleanup.largeVideos,
    unit: (b) => plural(b.items, 'video')
  }
]

export function Overview() {
  const { data: o } = useOverview()
  const go = useStore((s) => s.go)
  const progress = useStore((s) => s.progress)
  if (!o) return <Loading />

  const cards = CARDS.map((c) => ({ ...c, b: c.bucket(o) }))
  const potential = cards.reduce((s, c) => s + c.b.bytes, 0)
  const analyzing = progress.phase !== 'idle'

  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-8 py-8">
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-panel-2 to-panel p-8"
        >
          <div className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-accent/20 blur-3xl" />
          <div className="relative flex flex-wrap items-end gap-8">
            <div className="mr-auto">
              <div className="text-xs font-semibold tracking-wide text-dim uppercase">You could free up</div>
              <div className="mt-1 text-5xl font-bold tracking-tight tabular">{bytes(potential)}</div>
              <div className="mt-2 text-muted">
                across {plural(o.totals.images, 'photo')} and {plural(o.totals.videos, 'video')} ({bytes(o.totals.bytes)}) in{' '}
                {plural(o.sources, 'source')}
              </div>
            </div>
            {o.reviewBin.items > 0 && (
              <div className="rounded-2xl border border-remove/30 bg-remove/10 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Trash2 size={15} className="text-remove" /> {plural(o.reviewBin.items, 'item')} in Review Bin
                </div>
                <div className="mt-0.5 text-xs text-muted">{bytes(o.reviewBin.bytes)} ready to move to the Trash</div>
                <Button size="sm" variant="danger" className="mt-3" onClick={() => go('bin')}>
                  Review & remove
                </Button>
              </div>
            )}
          </div>

          {potential > 0 && (
            <div className="relative mt-7 flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
              {cards
                .filter((c) => c.b.bytes > 0)
                .map((c) => (
                  <div key={c.view} title={`${c.title}: ${bytes(c.b.bytes)}`} style={{ width: `${(c.b.bytes / potential) * 100}%`, background: c.color }} />
                ))}
            </div>
          )}
          {analyzing && (
            <div className="relative mt-5 text-xs text-muted">
              {progress.phase === 'analyzing'
                ? `Still analyzing — ${count(progress.done)} of ${count(progress.total)} done, ${eta(progress.etaSec)}. Numbers will keep growing.`
                : progress.phase === 'scanning'
                  ? `Scanning your folders — ${count(progress.found)} files found so far…`
                  : 'Checking for identical copies…'}
            </div>
          )}
        </motion.section>

        <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {cards.map(({ view, icon: Icon, title, text, color, b, unit }, i) => (
            <motion.button
              key={view}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * (i + 1) }}
              onClick={() => go(view)}
              className={clsx(
                'group flex flex-col rounded-2xl border border-line bg-panel p-5 text-left transition-colors hover:border-line-strong hover:bg-panel-2',
                b.items === 0 && 'opacity-60'
              )}
            >
              <div className="flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-xl" style={{ background: `${color}22`, color }}>
                  <Icon size={18} />
                </div>
                <div className="font-semibold">{title}</div>
                <ArrowRight size={15} className="ml-auto text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
              </div>
              <div className="mt-4 text-2xl font-bold tabular">{bytes(b.bytes)}</div>
              <div className="mt-0.5 text-xs text-muted tabular">{b.items ? unit(b) : 'All clear'}</div>
              <div className="mt-3 text-xs leading-relaxed text-dim">{text}</div>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  )
}
