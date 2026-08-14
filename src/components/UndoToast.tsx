export default function UndoToast({ message, onUndo }: { message: string; onUndo: () => void }) {
  return (
    <div className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-slate-900 px-4 py-2.5 text-sm text-white shadow-xl">
      <span>{message}</span>
      <button onClick={onUndo} className="font-semibold text-brand-300 hover:text-brand-200">
        Deshacer
      </button>
    </div>
  )
}
