import type { Settings as SettingsT } from '@shared/types'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loading, Slider, Toggle } from '@/components/ui'
import { sift, useSettings } from '@/lib/api'

function Row({ title, text, children }: { title: string; text: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-b border-line py-5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted">{text}</div>
      </div>
      <div className="flex w-64 shrink-0 items-center justify-end gap-3">{children}</div>
    </div>
  )
}

/** Local draft so sliders move instantly; changes are saved once dragging pauses. */
function useDraft(saved: SettingsT | undefined) {
  const [draft, setDraft] = useState<SettingsT | undefined>(saved)
  const pending = useRef<Partial<SettingsT>>({})
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    if (!Object.keys(pending.current).length) setDraft(saved)
  }, [saved])
  const set = (patch: Partial<SettingsT>): void => {
    setDraft((d) => d && { ...d, ...patch })
    pending.current = { ...pending.current, ...patch }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const p = pending.current
      pending.current = {}
      void sift.updateSettings(p)
    }, 350)
  }
  return [draft, set] as const
}

export function Settings() {
  const { data } = useSettings()
  const [s, set] = useDraft(data)
  if (!s) return <Loading />
  return (
    <div className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-6">
        <h2 className="mb-1 text-xs font-semibold tracking-wide text-dim uppercase">Finding similar shots</h2>
        <div className="rounded-2xl border border-line bg-panel px-5">
          <Row title="Similarity" text="How alike photos must look to be grouped. Looser finds more groups; stricter only groups near-identical shots.">
            <span className="text-xs text-dim">Looser</span>
            <Slider value={s.strictness} min={0} max={1} step={0.05} onChange={(strictness) => set({ strictness })} className="w-32" />
            <span className="text-xs text-dim">Stricter</span>
          </Row>
          <Row title="Burst window" text="Photos taken within this time of each other can be treated as the same moment.">
            <Slider value={s.burstWindowSec} min={5} max={600} step={5} onChange={(burstWindowSec) => set({ burstWindowSec })} className="w-32" />
            <span className="w-14 text-right text-xs tabular">{s.burstWindowSec < 60 ? `${s.burstWindowSec} s` : `${(s.burstWindowSec / 60).toFixed(s.burstWindowSec % 60 ? 1 : 0)} min`}</span>
          </Row>
        </div>

        <h2 className="mt-8 mb-1 text-xs font-semibold tracking-wide text-dim uppercase">Clean-up rules</h2>
        <div className="rounded-2xl border border-line bg-panel px-5">
          <Row title="Blur threshold" text="Photos with a focus score below this count as blurry.">
            <Slider value={s.blurThreshold} min={5} max={80} step={1} onChange={(blurThreshold) => set({ blurThreshold })} className="w-32" />
            <span className="w-14 text-right text-xs tabular">{s.blurThreshold}</span>
          </Row>
          <Row title="Dark shot threshold" text="Photos darker than this (like a camera in a pocket) are listed under Junk.">
            <Slider value={s.darkThreshold} min={0.02} max={0.25} step={0.01} onChange={(darkThreshold) => set({ darkThreshold })} className="w-32" />
            <span className="w-14 text-right text-xs tabular">{Math.round(s.darkThreshold * 100)}%</span>
          </Row>
          <Row title="Large video size" text="Videos bigger than this are listed under Large Videos.">
            <Slider value={s.largeVideoMB} min={50} max={2000} step={50} onChange={(largeVideoMB) => set({ largeVideoMB })} className="w-32" />
            <span className="w-14 text-right text-xs tabular">{s.largeVideoMB >= 1000 ? `${(s.largeVideoMB / 1024).toFixed(1)} GB` : `${s.largeVideoMB} MB`}</span>
          </Row>
        </div>

        <h2 className="mt-8 mb-1 text-xs font-semibold tracking-wide text-dim uppercase">Analysis</h2>
        <div className="rounded-2xl border border-line bg-panel px-5">
          <Row
            title="Smart analysis (Apple Vision)"
            text="Uses your Mac’s on-device AI to compare shots, score composition and faces, and recognize what’s in each photo for search. About 2× slower than basic analysis. Nothing is uploaded."
          >
            <Toggle checked={s.deepAnalysis} onChange={(deepAnalysis) => set({ deepAnalysis })} />
          </Row>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-dim">
          Sift never deletes anything on its own. Removed items go to the Review Bin, then to the Trash only when you confirm — and every batch can be
          restored.
        </p>
      </div>
    </div>
  )
}
