import type { Source } from '@shared/types'
import clsx from 'clsx'
import {
  Copy,
  Film,
  Focus,
  FolderPlus,
  Ghost,
  HardDrive,
  Folder,
  Images,
  Layers,
  LayoutGrid,
  MoreHorizontal,
  Settings,
  Star,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { useState } from 'react'
import { addFolders } from '@/lib/actions'
import { sift, useOverview, useSources } from '@/lib/api'
import { bytes, count } from '@/lib/format'
import { useStore, type View } from '@/lib/store'
import { Confirm } from './ui'

function NavItem({ view, icon: Icon, label, badge, tone }: { view: View; icon: LucideIcon; label: string; badge?: number; tone?: 'red' }) {
  const active = useStore((s) => s.view === view)
  const go = useStore((s) => s.go)
  return (
    <button
      onClick={() => go(view)}
      className={clsx(
        'no-drag flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
        active ? 'bg-white/[0.11] text-fg' : 'text-fg/80 hover:bg-white/[0.05]'
      )}
    >
      <Icon size={16} className={active ? 'text-accent' : 'text-muted'} strokeWidth={1.8} />
      <span className="flex-1 truncate text-left">{label}</span>
      {!!badge && (
        <span
          className={clsx(
            'min-w-5 rounded-full px-1.5 text-center text-[11px] leading-[18px] font-medium tabular',
            tone === 'red' ? 'bg-remove text-white' : 'text-dim'
          )}
        >
          {count(badge)}
        </span>
      )}
    </button>
  )
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-1 flex items-center justify-between px-2.5 text-[11px] font-semibold tracking-wide text-dim uppercase">
        {title}
        {action}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}

function SourceRow({ source }: { source: Source }) {
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const isDrive = source.path.startsWith('/Volumes/')
  const Icon = isDrive ? HardDrive : Folder
  return (
    <div className="group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 hover:bg-white/[0.05]" title={source.path}>
      <Icon size={15} className="shrink-0 text-muted" strokeWidth={1.8} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 truncate text-[13px] text-fg/85">
          {source.name}
          {source.isPrimary && <Star size={10} className="shrink-0 fill-keep text-keep" />}
        </div>
      </div>
      <span
        className={clsx('size-1.5 shrink-0 rounded-full group-hover:hidden', source.online ? 'bg-ok' : 'bg-dim')}
        title={source.online ? 'Connected' : 'Not connected'}
      />
      <button className="no-drag hidden text-muted hover:text-fg group-hover:block" onClick={() => setMenu((m) => !m)} aria-label="Source options">
        <MoreHorizontal size={15} />
      </button>
      {menu && (
        <div
          className="absolute top-8 right-0 z-30 w-52 rounded-lg border border-line-strong bg-panel p-1 text-[13px] shadow-2xl"
          onMouseLeave={() => setMenu(false)}
        >
          <div className="px-2.5 py-1.5 text-xs text-dim">
            {count(source.count)} items · {bytes(source.bytes)}
            {!source.online && <div className="text-warn">Not connected — browsing from cache</div>}
          </div>
          {!source.isPrimary && (
            <button
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 hover:bg-white/[0.07]"
              onClick={() => {
                void sift.setPrimarySource(source.id)
                setMenu(false)
              }}
            >
              <Star size={13} /> Make main library
            </button>
          )}
          <button
            className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-remove hover:bg-white/[0.07]"
            onClick={() => {
              setMenu(false)
              setConfirm(true)
            }}
          >
            <Trash2 size={13} /> Remove from Sift…
          </button>
        </div>
      )}
      <Confirm
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Remove “${source.name}” from Sift?`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => void sift.removeSource(source.id)}
      >
        Sift will stop showing this folder. <b className="text-fg">Your files are not touched</b> — only Sift’s index and thumbnails
        for it are forgotten.
      </Confirm>
    </div>
  )
}

export function Sidebar() {
  const { data: o } = useOverview()
  const { data: sources } = useSources()
  const c = o?.cleanup
  return (
    <aside className="drag flex w-[232px] shrink-0 flex-col border-r border-black/40 bg-[#18181d]/90 px-3 pt-[52px] pb-3">
      <div className="scroll-thin -mx-1 flex-1 overflow-y-auto px-1">
        <NavItem view="overview" icon={LayoutGrid} label="Overview" />
        <NavItem view="library" icon={Images} label="Library" badge={o?.totals.items} />

        <Section title="Clean up">
          <NavItem view="duplicates" icon={Copy} label="Duplicates" badge={c?.duplicates.groups} />
          <NavItem view="similar" icon={Layers} label="Similar & Bursts" badge={c?.similar.groups} />
          <NavItem view="blurry" icon={Focus} label="Blurry" badge={c?.blurry.items} />
          <NavItem view="junk" icon={Ghost} label="Junk" badge={c?.junk.items} />
          <NavItem view="videos" icon={Film} label="Large Videos" badge={c?.largeVideos.items} />
        </Section>

        <div className="mt-5">
          <NavItem view="bin" icon={Trash2} label="Review Bin" badge={o?.reviewBin.items} tone="red" />
        </div>

        <Section
          title="Sources"
          action={
            <button className="no-drag text-muted hover:text-fg" onClick={() => void addFolders()} title="Add folder or drive" aria-label="Add folder or drive">
              <FolderPlus size={14} />
            </button>
          }
        >
          {sources?.map((s) => <SourceRow key={s.id} source={s} />)}
          {sources?.length === 0 && (
            <button className="no-drag px-2.5 py-1 text-left text-[13px] text-accent hover:underline" onClick={() => void addFolders()}>
              Add a folder or drive…
            </button>
          )}
        </Section>
      </div>
      <NavItem view="settings" icon={Settings} label="Settings" />
    </aside>
  )
}
