import { motion } from 'motion/react'
import { Crown, FolderPlus, Layers, ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui'
import { addFolders } from '@/lib/actions'

const FEATURES = [
  { icon: Layers, title: 'Finds bursts & duplicates', text: 'Groups the 12 shots you took of the same moment, and every copy of the same file across folders and drives.' },
  { icon: Crown, title: 'Picks the best shot', text: 'Scores focus, composition, faces and exposure with Apple’s on-device AI — you just confirm.' },
  { icon: ShieldCheck, title: 'Safe by design', text: 'Nothing leaves your Mac. Nothing is deleted without your review, and even then it goes to the Trash — undoable.' }
]

export function Welcome() {
  return (
    <div className="scroll-thin flex h-full items-center justify-center overflow-y-auto p-10">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="flex max-w-2xl flex-col items-center text-center">
        <div className="relative mb-6">
          <div className="absolute inset-0 rounded-3xl bg-accent/40 blur-2xl" />
          <div className="relative grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-accent to-accent-strong shadow-2xl">
            <Sparkles size={38} className="text-white" strokeWidth={1.6} />
          </div>
        </div>
        <h2 className="text-3xl font-bold tracking-tight">Let’s tidy up your photos</h2>
        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted">
          Add the folders and drives where your photos live. Sift brings them into one library, then finds the duplicates, burst shots,
          blurry photos and junk — so you only have to make the final call.
        </p>
        <Button variant="primary" size="lg" icon={FolderPlus} className="mt-7" onClick={() => void addFolders()}>
          Add Folder or Drive…
        </Button>
        <p className="mt-3 text-xs text-dim">or drag folders from Finder onto this window</p>

        <div className="mt-12 grid grid-cols-3 gap-4 text-left">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-line bg-panel/60 p-4">
              <Icon size={18} className="text-accent" />
              <div className="mt-3 font-semibold">{title}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted">{text}</div>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
