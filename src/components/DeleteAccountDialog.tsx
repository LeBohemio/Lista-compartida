import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'

// Antes de borrar la cuenta de verdad (delete_own_account, que cascada sobre
// las tablas), limpiamos también los archivos que esa persona tiene en
// Storage: nada en las tablas apunta a ellos después de borrarse, así que si
// no se borran aquí se quedan huérfanos ahí para siempre. Las fotos de
// LISTAS se dejan aparte a propósito: son un elemento compartido de la
// lista, no algo personal de quien se borra — si la lista sigue existiendo
// para el resto de miembros, su foto debe seguir ahí.
//
// Es un intento "a lo mejor que se pueda": si algo de esto falla (por
// ejemplo, por estar sin conexión a mitad), no bloquea el borrado de la
// cuenta en sí — mejor una cuenta borrada con algún archivo suelto de sobra
// en Storage que una cuenta que no se puede borrar por un fallo en la
// limpieza de fotos.
async function cleanupOwnStorage(userId: string) {
  try {
    const { data: ownMessages } = await supabase
      .from('messages')
      .select('image_path, audio_path, file_path')
      .eq('sender_id', userId)

    const imagePaths = (ownMessages ?? []).map((m) => m.image_path).filter((p): p is string => !!p)
    const audioPaths = (ownMessages ?? []).map((m) => m.audio_path).filter((p): p is string => !!p)
    const filePaths = (ownMessages ?? []).map((m) => m.file_path).filter((p): p is string => !!p)

    if (imagePaths.length) await supabase.storage.from('chat-images').remove(imagePaths)
    if (audioPaths.length) await supabase.storage.from('chat-audio').remove(audioPaths)
    if (filePaths.length) await supabase.storage.from('chat-files').remove(filePaths)

    const { data: ownExpenses } = await supabase
      .from('expenses')
      .select('receipt_image_path')
      .eq('created_by', userId)
      .not('receipt_image_path', 'is', null)
    const receiptPaths = (ownExpenses ?? []).map((e) => e.receipt_image_path).filter((p): p is string => !!p)
    if (receiptPaths.length) await supabase.storage.from('receipts').remove(receiptPaths)

    // La carpeta de avatares puede tener varias fotos subidas a lo largo
    // del tiempo (no solo la que se ve ahora mismo), así que se listan y se
    // borran todas.
    const { data: avatarFiles } = await supabase.storage.from('avatars').list(userId)
    if (avatarFiles && avatarFiles.length > 0) {
      await supabase.storage.from('avatars').remove(avatarFiles.map((f) => `${userId}/${f.name}`))
    }
  } catch {
    // Best-effort — ver el comentario de arriba.
  }
}

export default function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { t } = useLanguage()
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmWord = t('account.confirmWord')
  const canDelete = confirmText.trim().toUpperCase() === confirmWord

  const handleDelete = async () => {
    if (!canDelete || !user) return
    setSubmitting(true)
    setError(null)
    // La limpieza de Storage va ANTES del RPC: necesita seguir autenticada
    // como esta persona (auth.uid()) para que las políticas de "borrar lo
    // mío" de cada bucket la dejen borrar sus propios archivos — una vez
    // borrada la cuenta, ya no habría sesión con la que hacerlo.
    await cleanupOwnStorage(user.id)
    const { error: err } = await supabase.rpc('delete_own_account')
    if (err) {
      setSubmitting(false)
      setError(err.message)
      return
    }
    await signOut()
    navigate('/login')
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="glass-panel w-full max-w-sm rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-2 text-lg font-semibold text-red-600 dark:text-red-400">{t('profile.deleteAccount')}</h2>
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">{t('account.deleteWarning')}</p>
        <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('account.typeToConfirm', { word: confirmWord })}
        </p>
        <input
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          className="mb-4 w-full rounded-2xl border px-3 py-2.5 text-base focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
          placeholder={confirmWord}
          aria-label={t('account.typeToConfirm', { word: confirmWord })}
        />

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleDelete}
            disabled={!canDelete || submitting}
            className="flex-1 rounded-full bg-gradient-to-br from-red-500 to-red-600 px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_rgba(220,38,38,0.5)] disabled:opacity-50"
          >
            {submitting ? t('account.deleting') : t('profile.deleteAccount')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
