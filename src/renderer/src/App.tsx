import { DropOverlay } from '@/components/DropOverlay'
import { Sidebar } from '@/components/Sidebar'
import { Toasts } from '@/components/Toasts'
import { Toolbar } from '@/components/Toolbar'
import { Loading } from '@/components/ui'
import { Viewer } from '@/components/Viewer'
import { useSiftEvents, useSources } from '@/lib/api'
import { useStore, type View } from '@/lib/store'
import { Duplicates } from '@/views/Duplicates'
import { Blurry, Junk, Library, ReviewBin, Search } from '@/views/grids'
import { LargeVideos } from '@/views/LargeVideos'
import { Overview } from '@/views/Overview'
import { Settings } from '@/views/Settings'
import { Similar } from '@/views/Similar'
import { Welcome } from '@/views/Welcome'

const VIEWS: Record<View, () => React.JSX.Element> = {
  overview: Overview,
  library: Library,
  duplicates: Duplicates,
  similar: Similar,
  blurry: Blurry,
  junk: Junk,
  videos: LargeVideos,
  bin: ReviewBin,
  search: Search,
  settings: Settings
}

export default function App() {
  useSiftEvents()
  const view = useStore((s) => s.view)
  const { data: sources } = useSources()
  const Current = VIEWS[view]
  const empty = sources?.length === 0 && view !== 'settings'

  return (
    <div className="flex h-full select-none">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col bg-bg">
        <Toolbar />
        <div className="relative min-h-0 flex-1">{!sources ? <Loading /> : empty ? <Welcome /> : <Current />}</div>
      </main>
      <Viewer />
      <Toasts />
      <DropOverlay />
    </div>
  )
}
