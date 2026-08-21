import { useState, type ChangeEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLanguage } from '../lib/i18n'
import AvatarCropper from './AvatarCropper'
import Avatar from './Avatar'

// Cambiar la foto de la lista — abierto a CUALQUIER miembro (no solo a
// quien la creó), a diferencia de RenameListModal (nombre/color/moneda),
// que sigue siendo solo para el dueño. Por eso usa la función
// set_list_photo en vez de actualizar la tabla "lists" directamente: esa
// función solo comprueba que quien la llama es miembro de la lista, sin
// abrir el resto de columnas (nombre, color, moneda...) a nadie más que al
// dueño — esas se quedan protegidas por la política RLS de siempre. Ver
// migration_v24.sql.
export default function ChangeListPhotoModal({
  listId,
  listName,
  currentPhotoUrl,
  onClose,
  onSaved,
}: {
  listId: string
  listName: string
  currentPhotoUrl: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setCropFile(file)
  }

  const handleCropConfirm = async (blob: Blob) => {
    setCropFile(null)
    setError(null)
    setUploading(true)

    const path = `${listId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const { error: uploadErr } = await supabase.storage
      .from('list-photos')
      .upload(path, blob, { contentType: 'image/jpeg' })
    if (uploadErr) {
      setUploading(false)
      setError(t('profile.errorUploadPhoto', { message: uploadErr.message }))
      return
    }

    const { data: publicData } = supabase.storage.from('list-photos').getPublicUrl(path)
    const { error: rpcErr } = await supabase.rpc('set_list_photo', {
      p_list_id: listId,
      p_photo_url: publicData.publicUrl,
    })
    setUploading(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    onSaved()
  }

  const removePhoto = async () => {
    setError(null)
    setUploading(true)
    const { error: rpcErr } = await supabase.rpc('set_list_photo', { p_list_id: listId, p_photo_url: null })
    setUploading(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    onSaved()
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
        <div
          className="glass-panel w-full max-w-md rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('list.changePhoto')}</h2>

          <div className="mb-4 flex items-center gap-3">
            {/* Antes era un <img> suelto, sin ampliar al tocarlo ni cerrar
                bien. Ahora reutiliza Avatar, que ya trae esa vista ampliada
                a pantalla completa con su botón ✕ funcional. */}
            <Avatar
              username={listName}
              avatarUrl={currentPhotoUrl}
              size={64}
              className="ring-1 ring-[var(--color-glass-border)]"
            />
            <div className="flex flex-col gap-1">
              <label className="cursor-pointer text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
                {uploading ? t('common.saving') : t('list.changePhoto')}
                <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} className="hidden" />
              </label>
              {currentPhotoUrl && (
                <button
                  type="button"
                  onClick={removePhoto}
                  disabled={uploading}
                  className="text-left text-sm text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                >
                  {t('list.removePhoto')}
                </button>
              )}
            </div>
          </div>

          {error && (
            <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
          >
            {t('common.close')}
          </button>
        </div>
      </div>

      {cropFile && <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={handleCropConfirm} />}
    </>
  )
}
