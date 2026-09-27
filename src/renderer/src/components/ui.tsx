import clsx from 'clsx'
import type { LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Layer, useHotkeys } from '@/lib/hooks'

type Variant = 'primary' | 'danger' | 'keep' | 'ghost' | 'subtle'

export function Button({
  variant = 'subtle',
  size = 'md',
  icon: Icon,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon }) {
  return (
    <button
      className={clsx(
        'no-drag inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'md' && 'h-8 px-3 text-[13px]',
        size === 'lg' && 'h-10 px-4 text-sm',
        variant === 'primary' && 'bg-accent-strong text-white hover:bg-accent',
        variant === 'danger' && 'bg-remove text-white hover:brightness-110',
        variant === 'keep' && 'bg-keep text-black hover:brightness-105',
        variant === 'subtle' && 'bg-white/[0.07] text-fg hover:bg-white/[0.12]',
        variant === 'ghost' && 'text-muted hover:bg-white/[0.07] hover:text-fg',
        className
      )}
      {...props}
    >
      {Icon && <Icon size={size === 'sm' ? 13 : 15} strokeWidth={2} />}
      {children}
    </button>
  )
}

export function IconButton({
  icon: Icon,
  label,
  className,
  active,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx(
        'no-drag grid size-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.08] hover:text-fg',
        active && 'bg-white/[0.1] text-fg',
        className
      )}
      {...props}
    >
      <Icon size={16} />
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid min-w-5 place-items-center rounded border border-current/25 bg-black/10 px-1 py-px font-sans text-[11px] opacity-70">
      {children}
    </kbd>
  )
}

export function Chip({ active, children, onClick, count }: { active?: boolean; children: ReactNode; onClick?: () => void; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active ? 'border-accent/60 bg-accent/15 text-fg' : 'border-line-strong text-muted hover:text-fg'
      )}
    >
      {children}
      {count != null && <span className="tabular text-dim">{count}</span>}
    </button>
  )
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  className
}: {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  className?: string
}) {
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      className={clsx('no-drag h-1 cursor-pointer accent-accent', className)}
    />
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent-strong' : 'bg-white/15')}
    >
      <span className={clsx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-white/[0.05] text-muted">
        <Icon size={26} strokeWidth={1.6} />
      </div>
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children && <div className="max-w-sm text-muted">{children}</div>}
      {action}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx('inline-block size-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80', className)} />
}

export function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <Spinner className="size-6" />
    </div>
  )
}

/** Header strip at the top of a view: summary on the left, actions on the right. */
export function ViewHeader({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-4">
      <div className="mr-auto min-w-0">
        <div className="text-[15px] font-semibold">{title}</div>
        {subtitle && <div className="mt-0.5 text-muted">{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

export function Modal({ open, onClose, children, width = 440 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useHotkeys({ Escape: onClose }, Layer.dialog, open)
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={onClose}
        >
          <motion.div
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 8 }}
            transition={{ type: 'spring', duration: 0.3, bounce: 0.15 }}
            style={{ width }}
            className="rounded-2xl border border-line-strong bg-panel p-6 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Confirm({
  open,
  title,
  children,
  confirmLabel,
  variant = 'primary',
  onConfirm,
  onClose
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  variant?: Variant
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose}>
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="mt-2 leading-relaxed text-muted">{children}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant={variant}
          autoFocus
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}
