import clsx from 'clsx'
import { AnimatePresence, motion } from 'motion/react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'
import { useStore } from '@/lib/store'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismiss)
  return (
    <div className="pointer-events-none fixed right-5 bottom-5 z-[60] flex w-[380px] flex-col items-end gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40 }}
            className="pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border border-line-strong bg-panel/95 p-3 text-[13px] shadow-2xl backdrop-blur-xl"
          >
            {t.tone === 'error' ? (
              <AlertCircle size={16} className="mt-px shrink-0 text-remove" />
            ) : (
              <CheckCircle2 size={16} className={clsx('mt-px shrink-0', t.tone === 'success' ? 'text-ok' : 'text-accent')} />
            )}
            <span className="flex-1 leading-snug">{t.message}</span>
            {t.action && (
              <button
                className="shrink-0 font-semibold text-accent hover:underline"
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="shrink-0 text-dim hover:text-fg" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
