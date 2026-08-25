import { useState, type ChangeEvent, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { PALETTE, colorNameKey } from '../lib/colors'
import { CURRENCIES, type CurrencyCode } from '../lib/currencies'
import { useLanguage } from '../lib/i18n'
import AvatarCropper from './AvatarCropper'

export default function RenameListModal({
  listId,
  currentName,
  currentColor,
  currentCurrency,
  currentPhotoUrl,
  onClose,
  onSaved,
}: {
  listId: string
  currentName: string
  currentColor: string | null
  currentCurrency: CurrencyCode
  currentPhotoUrl: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useLanguage()
  const [name, setName] = useState(currentName)
  const [color, setColor] = useState<string | null>(currentColor)
  const [currency, setCurrency] = useState<CurrencyCode>(currentCurrency)
  const [photoUrl, setPhotoUrl] = useState<string | null>(currentPhotoUrl)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePhotoFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setCropFile(file)
  }

  // La foto se sube y se guarda al momento (no espera al "Guardar" del
  // resto del formulario) — así el picker de la app de fotos del móvil, que
  // puede tardar, no bloquea el resto de cambios ya hechos.
  const handleCropConfirm = async (blob: Blob) => {
    setCropFile(null)
    setError(null)
    setUploadingPhoto(true)

    const path = `${listId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const { error: uploadErr } = await supabase.storage.from('list-photos').upload(path, blob, { contentType: 'image/jpeg' })
    if (uploadErr) {
      setUploadingPhoto(false)
      setError(t('profile.errorUploadPhoto', { message: uploadErr.message }))
      return
    }

    const { data: publicData } = supabase.storage.from('list-photos').getPublicUrl(path)
    const { error: updateErr } = await supabase.from('lists').update({ photo_url: publicData.publicUrl }).eq('id', listId)
    setUploadingPhoto(false)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    setPhotoUrl(publicData.publicUrl)
  }

  const removePhoto = async () => {
    setError(null)
    setUploadingPhoto(true)
    const { error: updateErr } = await supabase.from('lists').update({ photo_url: null }).eq('id', listId)
    setUploadingPhoto(false)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    setPhotoUrl(null)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError(t('list.nameRequired'))
      return
    }
    setSubmitting(true)
    setError(null)
    const { error: err } = await supabase.from('lists').update({ name: name.trim(), color, currency }).eq('id', listId)
    setSubmitting(false)
    if (err) {
      setError(err.message)
      return
    }
    onSaved()
  }

  return (
    // Fragmento en vez de anidar el AvatarCropper dentro del fondo que
    // cierra al hacer clic: si estuviera dentro, cualquier clic dentro del
    // recorte (arrastrar la foto, tocar el deslizador, confirmar) burbujea
    // hasta ese fondo y cerraría TODO este modal de golpe en vez de
    // quedarse aquí para seguir editando el resto.
    <>
      {createPortal(
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
        <div
          className="glass-panel w-full max-w-md rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
          onClick={(e) => e.stopPropagation()}
        >
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('list.editTitle')}</h2>

        <div className="mb-4 flex items-center gap-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--color-glass)] ring-1 ring-[var(--color-glass-border)]">
            {photoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img src={photoUrl} alt={t('list.photo')} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl" style={{ color: color ?? undefined }}>
                ●
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="cursor-pointer text-sm font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400">
              {uploadingPhoto ? t('common.saving') : t('list.changePhoto')}
              <input type="file" accept="image/*" onChange={handlePhotoFile} disabled={uploadingPhoto} className="hidden" />
            </label>
            {photoUrl && (
              <button
                type="button"
                onClick={removePhoto}
                disabled={uploadingPhoto}
                className="text-left text-sm text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
              >
                {t('list.removePhoto')}
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="rename-list-name" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('list.name')}</label>
            <input
              id="rename-list-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-2xl border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Color</label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={t(colorNameKey(c))}
                  className="h-8 w-8 rounded-full ring-offset-2 transition"
                  style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none' }}
                />
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="rename-list-currency" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('profile.currency')}</label>
            <select
              id="rename-list-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="w-full rounded-2xl border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.code} — {c.symbol}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)] disabled:opacity-60"
            >
              {submitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
        </div>
      </div>,
        document.body,
      )}

      {cropFile && <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={handleCropConfirm} />}
    </>
  )
}
