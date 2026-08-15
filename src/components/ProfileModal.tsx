import { useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage, type TranslationKey } from '../lib/i18n'
import { PALETTE } from '../lib/colors'
import Avatar from './Avatar'
import DeleteAccountDialog from './DeleteAccountDialog'
import MyExpensesModal from './MyExpensesModal'
import AvatarCropper from './AvatarCropper'
import type { Language, Theme } from '../lib/types'

const THEME_OPTIONS: { value: Theme; labelKey: TranslationKey }[] = [
  { value: 'light', labelKey: 'theme.light' },
  { value: 'dark', labelKey: 'theme.dark' },
  { value: 'system', labelKey: 'theme.system' },
]

const LANGUAGE_OPTIONS: { value: Language; label: string }[] = [
  { value: 'es', label: '🇪🇸 Español' },
  { value: 'en', label: '🇬🇧 English' },
]

// Fondos suaves, pensados para no competir con el color de acento de
// botones/burbujas. `null` representa "usar el fondo por defecto de la app".
// Se muestran siempre las claritas y las oscuras juntas: quien use el tema
// oscuro puede igualmente elegir un fondo clarito si le gusta más, y
// viceversa — no se restringe según el tema activo.
const BACKGROUND_OPTIONS: { value: string | null; labelKey: TranslationKey; swatch: string }[] = [
  { value: null, labelKey: 'bg.default', swatch: '#f1f5f9' },
  { value: '#fdf6ec', labelKey: 'bg.warm', swatch: '#fdf6ec' },
  { value: '#eef4ff', labelKey: 'bg.blue', swatch: '#eef4ff' },
  { value: '#eefaf1', labelKey: 'bg.green', swatch: '#eefaf1' },
  { value: '#fdf0f6', labelKey: 'bg.pink', swatch: '#fdf0f6' },
  { value: '#f4f0ff', labelKey: 'bg.purple', swatch: '#f4f0ff' },
  { value: '#fffbea', labelKey: 'bg.yellow', swatch: '#fffbea' },
]

const DARK_BACKGROUND_OPTIONS: { value: string | null; labelKey: TranslationKey; swatch: string }[] = [
  { value: '#241f18', labelKey: 'bg.warm', swatch: '#241f18' },
  { value: '#15202e', labelKey: 'bg.blue', swatch: '#15202e' },
  { value: '#132a1c', labelKey: 'bg.green', swatch: '#132a1c' },
  { value: '#2a1720', labelKey: 'bg.pink', swatch: '#2a1720' },
  { value: '#1e1a2e', labelKey: 'bg.purple', swatch: '#1e1a2e' },
  { value: '#2a2712', labelKey: 'bg.yellow', swatch: '#2a2712' },
]

// Todas las opciones de fondo van juntas en una sola fila (claritas y
// oscuras seguidas), sin ninguna separación ni etiqueta entre ellas.
const ALL_BACKGROUND_OPTIONS = [...BACKGROUND_OPTIONS, ...DARK_BACKGROUND_OPTIONS]

// Versiones oscuras de los mismos 8 colores de acento, para cuando se
// combina con un fondo oscuro. Van seguidas de las claritas, en la misma
// fila, sin ninguna separación entre ellas.
const DARK_ACCENT_PALETTE = [
  '#312e81', // indigo oscuro
  '#0c4a6e', // sky oscuro
  '#065f46', // emerald oscuro
  '#78350f', // amber oscuro
  '#7f1d1d', // red oscuro
  '#831843', // pink oscuro
  '#4c1d95', // violet oscuro
  '#134e4a', // teal oscuro
]
// El naranja/ámbar de PALETTE se queda tal cual, y añadimos un amarillo
// aparte (no está en la paleta compartida de avatares para no reordenar
// los colores que ya tiene asignados cada persona) justo al lado del
// naranja, para que quien lo busque lo encuentre cerca.
const YELLOW_ACCENT = '#eab308'
const amberIndex = PALETTE.indexOf('#f59e0b')
const LIGHT_ACCENT_COLORS =
  amberIndex === -1
    ? [...PALETTE, YELLOW_ACCENT]
    : [...PALETTE.slice(0, amberIndex + 1), YELLOW_ACCENT, ...PALETTE.slice(amberIndex + 1)]
const ALL_ACCENT_COLORS = [...LIGHT_ACCENT_COLORS, ...DARK_ACCENT_PALETTE]

export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, profile, refreshProfile, signOut } = useAuth()
  const { language, setLanguage, t } = useLanguage()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [showMyExpenses, setShowMyExpenses] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)

  const [newUsername, setNewUsername] = useState('')
  const [usernameSubmitting, setUsernameSubmitting] = useState(false)
  const [usernameMessage, setUsernameMessage] = useState<string | null>(null)

  const [newEmail, setNewEmail] = useState('')
  const [emailSubmitting, setEmailSubmitting] = useState(false)
  const [emailMessage, setEmailMessage] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)

  if (!user || !profile) return null

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
    setPreviewUrl(URL.createObjectURL(blob))
    setUploading(true)

    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`

    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { contentType: 'image/jpeg' })

    if (uploadErr) {
      setError(`No se pudo subir la foto: ${uploadErr.message}`)
      setUploading(false)
      return
    }

    const { data: publicData } = supabase.storage.from('avatars').getPublicUrl(path)

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ avatar_url: publicData.publicUrl })
      .eq('id', user.id)

    setUploading(false)
    if (updateErr) {
      setError(updateErr.message)
      return
    }

    await refreshProfile()
  }

  const setTheme = async (theme: Theme) => {
    await supabase.from('profiles').update({ theme }).eq('id', user.id)
    await refreshProfile()
  }

  const setAccentColor = async (color: string | null) => {
    await supabase.from('profiles').update({ accent_color: color }).eq('id', user.id)
    await refreshProfile()
  }

  const setBackgroundColor = async (color: string | null) => {
    await supabase.from('profiles').update({ background_color: color }).eq('id', user.id)
    await refreshProfile()
  }

  const handleChangeUsername = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = newUsername.trim()
    if (!trimmed || trimmed === profile.username) return
    setUsernameSubmitting(true)
    setUsernameMessage(null)
    const { error: err } = await supabase.from('profiles').update({ username: trimmed }).eq('id', user.id)
    setUsernameSubmitting(false)
    if (err) {
      setUsernameMessage(err.message)
      return
    }
    await refreshProfile()
    setUsernameMessage(t('profile.usernameUpdated'))
    setNewUsername('')
  }

  const handleChangeEmail = async (e: FormEvent) => {
    e.preventDefault()
    if (!newEmail.trim()) return
    setEmailSubmitting(true)
    setEmailMessage(null)
    const { error: err } = await supabase.auth.updateUser({ email: newEmail.trim() })
    setEmailSubmitting(false)
    if (err) {
      setEmailMessage(err.message)
      return
    }
    setEmailMessage(t('profile.emailConfirmSent'))
    setNewEmail('')
  }

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordMessage(null)
    if (newPassword.length < 6) {
      setPasswordMessage(t('profile.passwordTooShort'))
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage(t('profile.passwordsDontMatch'))
      return
    }
    setPasswordSubmitting(true)
    const { error: err } = await supabase.auth.updateUser({ password: newPassword })
    setPasswordSubmitting(false)
    if (err) {
      setPasswordMessage(err.message)
      return
    }
    setPasswordMessage(t('profile.passwordUpdated'))
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-6 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          title={t('common.close')}
          className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          ✕
        </button>
        <h2 className="mb-4 pr-8 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('profile.title')}</h2>

        <div className="mb-5 flex flex-col items-center gap-3">
          <Avatar
            username={profile.username}
            avatarUrl={previewUrl ?? profile.avatar_url}
            size={88}
            className="ring-2 ring-slate-100 ring-[var(--color-surface-border)]"
          />
          <label className="cursor-pointer rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100">
            {uploading ? t('profile.uploading') : t('profile.changePhoto')}
            <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} className="hidden" />
          </label>
        </div>

        <div className="mb-6 space-y-1 text-center">
          <p className="font-medium text-slate-900 dark:text-slate-100">{profile.username}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{profile.email}</p>
        </div>

        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950">{error}</p>}

        <button
          onClick={() => setShowMyExpenses(true)}
          className="mb-6 w-full rounded-lg border px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
        >
          {t('profile.myExpenses')}
        </button>

        <div className="mb-6 space-y-3 border-t border-slate-100 pt-5 border-[var(--color-surface-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('profile.appearance')}</p>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition ${
                  profile.theme === opt.value
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-700/20'
                    : 'text-slate-600 border-[var(--color-surface-border)] dark:text-slate-300'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t('profile.accentColor')}</p>
            <div className="flex flex-wrap gap-2">
              {ALL_ACCENT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setAccentColor(c)}
                  aria-label={`Color ${c}`}
                  className="h-8 w-8 rounded-full border border-black/5 transition"
                  style={{
                    backgroundColor: c,
                    boxShadow: profile.accent_color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none',
                  }}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t('profile.backgroundColor')}</p>
            <div className="flex flex-wrap gap-2">
              {ALL_BACKGROUND_OPTIONS.map((opt, idx) => (
                <button
                  key={opt.value ?? `default-${idx}`}
                  onClick={() => setBackgroundColor(opt.value)}
                  aria-label={t(opt.labelKey)}
                  title={t(opt.labelKey)}
                  className="relative h-8 w-8 rounded-full border transition border-[var(--color-surface-border)]"
                  style={{
                    backgroundColor: opt.swatch,
                    boxShadow:
                      profile.background_color === opt.value ? '0 0 0 2px white, 0 0 0 4px #4f46e5' : 'none',
                  }}
                >
                  {opt.value === null && (
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-slate-400">
                      ✕
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t('profile.language')}</p>
            <div className="flex gap-2">
              {LANGUAGE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLanguage(opt.value)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition ${
                    language === opt.value
                      ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-700/20'
                      : 'text-slate-600 border-[var(--color-surface-border)] dark:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-6 space-y-3 border-t border-slate-100 pt-5 border-[var(--color-surface-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('profile.changeUsername')}</p>
          <form onSubmit={handleChangeUsername} className="space-y-2">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder={profile.username}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
            {usernameMessage && <p className="text-xs text-slate-500 dark:text-slate-400">{usernameMessage}</p>}
            <button
              type="submit"
              disabled={usernameSubmitting || !newUsername.trim()}
              className="w-full rounded-lg border py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {usernameSubmitting ? t('common.saving') : t('profile.updateUsername')}
            </button>
          </form>
        </div>

        <div className="mb-6 space-y-3 border-t border-slate-100 pt-5 border-[var(--color-surface-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('profile.changePassword')}</p>
          <form onSubmit={handleChangePassword} className="space-y-2">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t('profile.newPassword')}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('profile.repeatPassword')}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
            {passwordMessage && <p className="text-xs text-slate-500 dark:text-slate-400">{passwordMessage}</p>}
            <button
              type="submit"
              disabled={passwordSubmitting || !newPassword}
              className="w-full rounded-lg border py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {passwordSubmitting ? t('common.saving') : t('profile.updatePassword')}
            </button>
          </form>
        </div>

        <div className="mb-6 space-y-3 border-t border-slate-100 pt-5 border-[var(--color-surface-border)]">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('profile.changeEmail')}</p>
          <form onSubmit={handleChangeEmail} className="space-y-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="nuevo@email.com"
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
            {emailMessage && <p className="text-xs text-slate-500 dark:text-slate-400">{emailMessage}</p>}
            <button
              type="submit"
              disabled={emailSubmitting || !newEmail}
              className="w-full rounded-lg border py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {emailSubmitting ? t('common.saving') : t('profile.updateEmail')}
            </button>
          </form>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t('common.close')}
          </button>
          <button
            onClick={() => signOut()}
            className="flex-1 rounded-lg border border-red-200 px-4 py-2.5 font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
          >
            {t('profile.signOut')}
          </button>
        </div>

        <button
          onClick={() => setShowDelete(true)}
          className="mt-4 w-full text-center text-xs text-red-400 hover:text-red-600"
        >
          {t('profile.deleteAccount')}
        </button>
      </div>

      {showDelete && <DeleteAccountDialog onClose={() => setShowDelete(false)} />}
      {showMyExpenses && <MyExpensesModal onClose={() => setShowMyExpenses(false)} />}
      {cropFile && (
        <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={handleCropConfirm} />
      )}
    </div>
  )
}
