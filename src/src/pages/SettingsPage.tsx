import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage, type TranslationKey } from '../lib/i18n'
import Avatar from '../components/Avatar'
import DeleteAccountDialog from '../components/DeleteAccountDialog'
import MyExpensesModal from '../components/MyExpensesModal'
import AvatarCropper from '../components/AvatarCropper'
import AvatarPicker from '../components/AvatarPicker'
import { CloseIcon } from '../components/icons'
import { CURRENCIES, type CurrencyCode } from '../lib/currencies'
import type { Language, Theme } from '../lib/types'
import { disablePush, enablePush, isPushSupported } from '../lib/push'

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
// botones/burbujas. `null` representa "usar el fondo por defecto de la app"
// y va siempre primero. El resto está ordenado de más claro a más oscuro
// (de blanco a negro), no por tono — así el orden se entiende de un
// vistazo aunque cambien las tonalidades exactas. Quien use el tema oscuro
// puede igualmente elegir un fondo clarito si le gusta más, y viceversa —
// no se restringe según el tema activo.
//
// Antes había un color de acento y de fondo "amarillo" casi calcado del
// "ámbar" de al lado (comprobado con un contraste de color: apenas se
// distinguían, ni con un vistazo normal ni para quien tiene daltonismo) —
// se ha quitado para no duplicar. Lo mismo con "violeta" (casi idéntico a
// "índigo") y "teal" (casi idéntico a "esmeralda") en los acentos.
const ALL_BACKGROUND_OPTIONS: { value: string | null; labelKey: TranslationKey; swatch: string }[] = [
  { value: null, labelKey: 'bg.default', swatch: '#f1f5f9' },
  { value: '#fffbea', labelKey: 'bg.yellow', swatch: '#fffbea' },
  { value: '#eefaf1', labelKey: 'bg.green', swatch: '#eefaf1' },
  { value: '#fdf6ec', labelKey: 'bg.warm', swatch: '#fdf6ec' },
  { value: '#eef4ff', labelKey: 'bg.blue', swatch: '#eef4ff' },
  { value: '#fdf0f6', labelKey: 'bg.pink', swatch: '#fdf0f6' },
  { value: '#f4f0ff', labelKey: 'bg.purple', swatch: '#f4f0ff' },
  { value: '#2a2712', labelKey: 'bg.yellow', swatch: '#2a2712' },
  { value: '#132a1c', labelKey: 'bg.green', swatch: '#132a1c' },
  { value: '#241f18', labelKey: 'bg.warm', swatch: '#241f18' },
  { value: '#15202e', labelKey: 'bg.blue', swatch: '#15202e' },
  { value: '#1e1a2e', labelKey: 'bg.purple', swatch: '#1e1a2e' },
  { value: '#2a1720', labelKey: 'bg.pink', swatch: '#2a1720' },
  // Negro neutro (sin ningún tinte de color), algo más claro que el negro
  // puro para que no se coma los bordes/sombras — pensado para combinar
  // con el acento negro de abajo.
  { value: '#1c1c1e', labelKey: 'bg.black', swatch: '#1c1c1e' },
]

// Los mismos 6 tonos de PALETTE (colors.ts) que no se confunden entre sí a
// simple vista, en su versión clarita y en su versión oscura (para cuando
// se combina con un fondo oscuro), ordenados de más claro a más oscuro y
// terminando en negro puro. No se reordena ni se toca PALETTE en sí — ese
// array decide el color de avatares/listas de cada persona a partir de su
// nombre, así que cambiar su orden le cambiaría el color a gente que ya
// tiene uno asignado.
const ACCENT_LIGHT_TO_DARK: { light: string; dark: string; nameKey: TranslationKey }[] = [
  { light: '#f59e0b', dark: '#78350f', nameKey: 'accent.amber' },
  { light: '#10b981', dark: '#065f46', nameKey: 'accent.emerald' },
  { light: '#0ea5e9', dark: '#0c4a6e', nameKey: 'accent.sky' },
  { light: '#ec4899', dark: '#831843', nameKey: 'accent.pink' },
  { light: '#ef4444', dark: '#7f1d1d', nameKey: 'accent.red' },
  { light: '#6366f1', dark: '#312e81', nameKey: 'accent.indigo' },
]
// Negro puro, al final del todo — combinado con "Negro" en color de fondo
// da un tema en escala de grises. shadesFromAccent() (ver theme.ts) trata
// un acento sin saturación como gris puro en todos sus tonos, así que
// funciona bien sin ningún caso especial.
const BLACK_ACCENT = '#000000'
// Antes solo eran los códigos de color sueltos (sin nombre visible, solo el
// tooltip del navegador) — ahora cada swatch lleva su nombre para poder
// mostrarlo debajo, igual que ya se hacía con los fondos.
const ALL_ACCENT_SWATCHES: { value: string; nameKey: TranslationKey; dark: boolean }[] = [
  ...ACCENT_LIGHT_TO_DARK.map((c) => ({ value: c.light, nameKey: c.nameKey, dark: false })),
  ...ACCENT_LIGHT_TO_DARK.map((c) => ({ value: c.dark, nameKey: c.nameKey, dark: true })),
  { value: BLACK_ACCENT, nameKey: 'accent.black' as TranslationKey, dark: false },
]

// Ajustes — antes era un modal (ProfileModal) al que se accedía desde el
// avatar en "Mis listas"; ahora es una pantalla propia, con ruta y
// navegación real, dentro de la pestaña "Ajustes" de la barra inferior
// (ver MainLayout.tsx / App.tsx). El botón de "Contactos" que vivía aquí
// dentro se ha quitado: Contactos es ahora su propia pestaña.
export default function SettingsPage() {
  const { user, profile, refreshProfile, signOut } = useAuth()
  const { language, setLanguage, t } = useLanguage()
  const location = useLocation()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  // Se puede llegar aquí ya con la intención de abrir "Mis gastos" directo
  // (atajo desde la cabecera de "Mis listas", ver ListsPage.tsx) — se lee
  // una sola vez al montar, no hace falta que sea reactivo.
  const [showMyExpenses, setShowMyExpenses] = useState(
    () => Boolean((location.state as { openExpenses?: boolean } | null)?.openExpenses),
  )
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)

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

  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)

  if (!user || !profile) return null

  const togglePush = async () => {
    setPushError(null)
    setPushBusy(true)
    try {
      if (profile.notify_push_enabled) {
        await disablePush(user.id)
      } else {
        await enablePush(user.id)
      }
      await refreshProfile()
    } catch (err) {
      const code = err instanceof Error ? err.message : 'unknown'
      setPushError(
        code === 'denied'
          ? t('profile.pushDenied')
          : code === 'unsupported'
            ? t('profile.pushUnsupported')
            : t('profile.pushGenericError'),
      )
    } finally {
      setPushBusy(false)
    }
  }

  const setNotifyPref = async (
    field: 'notify_chat' | 'notify_expenses' | 'notify_invites' | 'notify_settlements',
    value: boolean,
  ) => {
    await supabase.from('profiles').update({ [field]: value }).eq('id', user.id)
    await refreshProfile()
  }

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
      setError(t('profile.errorUploadPhoto', { message: uploadErr.message }))
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

  const handlePickAvatar = async (url: string) => {
    setShowAvatarPicker(false)
    setError(null)
    setPreviewUrl(url)
    setUploading(true)

    const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id)

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

  // Esto es solo tu divisa por defecto: las listas que crees a partir de
  // ahora la heredan directamente, sin preguntarte nada al crearlas. Las
  // listas que ya existen no cambian — su divisa se edita aparte, en los
  // ajustes de cada lista.
  const setCurrency = async (currency: (typeof CURRENCIES)[number]['code']) => {
    await supabase.from('profiles').update({ currency }).eq('id', user.id)
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
    <div
      className="min-h-screen pb-28"
      style={profile?.background_color ? { backgroundColor: profile.background_color } : undefined}
    >
      {/* HEADER_ACCENT_RECT: pegada arriba del todo, en rectángulo completo
          (sin ninguna esquina redondeada, ni arriba ni abajo — solo una
          línea recta) y con el degradado de varias tonalidades del acento
          del usuario como fondo. Mismo patrón en todas las cabeceras. */}
      <header
        className="sticky top-0 z-10 bg-gradient-to-br from-[var(--color-brand-400)] via-[var(--color-brand-500)] to-[var(--color-brand-700)] px-4 pb-4 shadow-[0_10px_24px_-16px_rgba(20,21,26,0.5)]"
        style={{ paddingTop: 'calc(0.875rem + env(safe-area-inset-top))' }}
      >
        <h1 className="mx-auto max-w-2xl font-display font-medium text-white">{t('profile.title')}</h1>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-5 flex flex-col items-center gap-3">
          <Avatar
            username={profile.username}
            avatarUrl={previewUrl ?? profile.avatar_url}
            size={88}
            className="ring-2 ring-[var(--color-glass-border)]"
          />
          <div className="flex gap-2">
            <label className="cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium text-[var(--color-brand-600)] border-[var(--color-glass-border)] bg-[var(--color-glass)] hover:bg-white/60 dark:text-[var(--color-brand-400)] dark:hover:bg-white/10">
              {uploading ? t('profile.uploading') : t('profile.changePhoto')}
              <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} className="hidden" />
            </label>
            <button
              type="button"
              onClick={() => setShowAvatarPicker(true)}
              disabled={uploading}
              className="rounded-full border px-3 py-1.5 text-sm font-medium text-[var(--color-brand-600)] border-[var(--color-glass-border)] bg-[var(--color-glass)] hover:bg-white/60 disabled:opacity-50 dark:text-[var(--color-brand-400)] dark:hover:bg-white/10"
            >
              {t('profile.chooseAvatar')}
            </button>
          </div>
        </div>

        <div className="mb-6 space-y-1 text-center">
          <p className="font-medium text-slate-900 dark:text-slate-100">{profile.username}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">{profile.email}</p>
        </div>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mb-6">
          <button
            onClick={() => setShowMyExpenses(true)}
            className="glass-panel w-full rounded-2xl px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-white/60 dark:text-slate-200 dark:hover:bg-white/10"
          >
            {t('profile.myExpenses')}
          </button>
        </div>

        <div className="glass-panel mb-6 space-y-3 rounded-[26px] p-4">
          <p className="font-mono text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('profile.appearance')}</p>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                className={`flex-1 rounded-full px-2 py-2 text-sm font-medium transition ${
                  profile.theme === opt.value
                    ? 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_8px_18px_-8px_var(--color-glow)]'
                    : 'border text-slate-600 border-[var(--color-glass-border)] hover:bg-white/40 dark:text-slate-300 dark:hover:bg-white/5'
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t('profile.accentColor')}</p>
            <div className="flex flex-wrap gap-3">
              {ALL_ACCENT_SWATCHES.map((opt) => {
                const label = opt.dark ? `${t(opt.nameKey)} · ${t('color.darkSuffix')}` : t(opt.nameKey)
                return (
                  <button
                    key={opt.value}
                    onClick={() => setAccentColor(opt.value)}
                    aria-label={label}
                    title={label}
                    className="flex w-14 flex-col items-center gap-1 rounded-2xl py-1 transition hover:bg-white/40 dark:hover:bg-white/5"
                  >
                    <span
                      className="h-8 w-8 rounded-full border border-black/5"
                      style={{
                        backgroundColor: opt.value,
                        boxShadow:
                          profile.accent_color === opt.value ? `0 0 0 2px white, 0 0 0 4px ${opt.value}` : 'none',
                      }}
                    />
                    <span className="w-full truncate text-center text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                      {label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t('profile.backgroundColor')}</p>
            <div className="flex flex-wrap gap-3">
              {ALL_BACKGROUND_OPTIONS.map((opt, idx) => (
                <button
                  key={opt.value ?? `default-${idx}`}
                  onClick={() => setBackgroundColor(opt.value)}
                  aria-label={t(opt.labelKey)}
                  title={t(opt.labelKey)}
                  className="flex w-14 flex-col items-center gap-1 rounded-2xl py-1 transition hover:bg-white/40 dark:hover:bg-white/5"
                >
                  <span
                    className="relative h-8 w-8 rounded-full border transition border-[var(--color-glass-border)]"
                    style={{
                      backgroundColor: opt.swatch,
                      boxShadow:
                        profile.background_color === opt.value ? '0 0 0 2px white, 0 0 0 4px #4f46e5' : 'none',
                    }}
                  >
                    {opt.value === null && (
                      <span className="absolute inset-0 flex items-center justify-center text-slate-400">
                        <CloseIcon className="h-3 w-3" />
                      </span>
                    )}
                  </span>
                  <span className="w-full truncate text-center text-[10px] leading-tight text-slate-500 dark:text-slate-400">
                    {t(opt.labelKey)}
                  </span>
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
                  className={`flex-1 rounded-full px-2 py-2 text-sm font-medium transition ${
                    language === opt.value
                      ? 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_8px_18px_-8px_var(--color-glow)]'
                      : 'border text-slate-600 border-[var(--color-glass-border)] hover:bg-white/40 dark:text-slate-300 dark:hover:bg-white/5'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{t('profile.currency')}</p>
            <select
              value={profile.currency}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="w-full rounded-2xl border px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.flag} {c.code} — {c.symbol}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">{t('profile.currencyHint')}</p>
          </div>
        </div>

        <div className="glass-panel mb-6 space-y-3 rounded-[26px] p-4">
          <p className="font-mono text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('profile.notifications')}</p>

          {!isPushSupported() ? (
            <p className="text-xs text-slate-400">{t('profile.pushUnsupported')}</p>
          ) : (
            <>
              <button
                type="button"
                onClick={togglePush}
                disabled={pushBusy}
                className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2.5 text-sm font-medium transition disabled:opacity-50 ${
                  profile.notify_push_enabled
                    ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)] dark:border-brand-400 dark:bg-brand-700/20 dark:text-brand-400'
                    : 'text-slate-600 border-[var(--color-glass-border)] dark:text-slate-300'
                }`}
              >
                <span>{t('profile.pushEnableToggle')}</span>
                <span
                  aria-hidden="true"
                  className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                    profile.notify_push_enabled ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'
                  }`}
                >
                  <span
                    className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      profile.notify_push_enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </span>
              </button>

              {pushError && <p className="text-xs text-red-500 dark:text-red-400">{pushError}</p>}

              {profile.notify_push_enabled && (
                <div className="space-y-2 rounded-2xl p-3 bg-black/5 dark:bg-white/5">
                  {(
                    [
                      { field: 'notify_chat', label: t('profile.notifyChat'), value: profile.notify_chat },
                      { field: 'notify_expenses', label: t('profile.notifyExpenses'), value: profile.notify_expenses },
                      { field: 'notify_invites', label: t('profile.notifyInvites'), value: profile.notify_invites },
                      {
                        field: 'notify_settlements',
                        label: t('profile.notifySettlements'),
                        value: profile.notify_settlements,
                      },
                    ] as const
                  ).map((row) => (
                    <label key={row.field} className="flex items-center justify-between text-sm text-slate-700 dark:text-slate-200">
                      {row.label}
                      <input
                        type="checkbox"
                        checked={row.value}
                        onChange={(e) => setNotifyPref(row.field, e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 accent-brand-600"
                      />
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="glass-panel mb-6 space-y-5 rounded-[26px] p-4">
          <p className="font-mono text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('profile.accountSection')}</p>

          <div className="space-y-2">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('profile.changeUsername')}</p>
            <form onSubmit={handleChangeUsername} className="space-y-2">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder={profile.username}
                className="w-full rounded-2xl border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
              />
              {usernameMessage && <p className="text-xs text-slate-500 dark:text-slate-400">{usernameMessage}</p>}
              <button
                type="submit"
                disabled={usernameSubmitting || !newUsername.trim()}
                className="w-full rounded-full border py-2 text-sm font-medium text-slate-700 hover:bg-white/60 disabled:opacity-50 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
              >
                {usernameSubmitting ? t('common.saving') : t('profile.updateUsername')}
              </button>
            </form>
          </div>

          <div className="space-y-2 border-t pt-4 border-[var(--color-glass-border)]">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('profile.changeEmail')}</p>
            <form onSubmit={handleChangeEmail} className="space-y-2">
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={t('profile.newEmailPlaceholder')}
                className="w-full rounded-2xl border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
              />
              {emailMessage && <p className="text-xs text-slate-500 dark:text-slate-400">{emailMessage}</p>}
              <button
                type="submit"
                disabled={emailSubmitting || !newEmail}
                className="w-full rounded-full border py-2 text-sm font-medium text-slate-700 hover:bg-white/60 disabled:opacity-50 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
              >
                {emailSubmitting ? t('common.saving') : t('profile.updateEmail')}
              </button>
            </form>
          </div>

          <div className="space-y-2 border-t pt-4 border-[var(--color-glass-border)]">
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('profile.changePassword')}</p>
            <form onSubmit={handleChangePassword} className="space-y-2">
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('profile.newPassword')}
                className="w-full rounded-2xl border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('profile.repeatPassword')}
                className="w-full rounded-2xl border px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
              />
              {passwordMessage && <p className="text-xs text-slate-500 dark:text-slate-400">{passwordMessage}</p>}
              <button
                type="submit"
                disabled={passwordSubmitting || !newPassword}
                className="w-full rounded-full border py-2 text-sm font-medium text-slate-700 hover:bg-white/60 disabled:opacity-50 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
              >
                {passwordSubmitting ? t('common.saving') : t('profile.updatePassword')}
              </button>
            </form>
          </div>
        </div>

        <button
          onClick={() => signOut()}
          className="w-full rounded-full border px-4 py-2.5 font-medium text-red-600 hover:bg-red-50/60 border-red-300/60 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/30"
        >
          {t('profile.signOut')}
        </button>

        <button
          onClick={() => setShowDelete(true)}
          className="mt-4 w-full text-center text-xs text-red-400 hover:text-red-600"
        >
          {t('profile.deleteAccount')}
        </button>
      </main>

      {showDelete && <DeleteAccountDialog onClose={() => setShowDelete(false)} />}
      {showMyExpenses && <MyExpensesModal onClose={() => setShowMyExpenses(false)} />}
      {cropFile && (
        <AvatarCropper file={cropFile} onCancel={() => setCropFile(null)} onConfirm={handleCropConfirm} />
      )}
      {showAvatarPicker && (
        <AvatarPicker
          currentUrl={profile.avatar_url}
          onClose={() => setShowAvatarPicker(false)}
          onSelect={handlePickAvatar}
        />
      )}
    </div>
  )
}
