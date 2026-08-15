import { useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { PALETTE } from '../lib/colors'
import Avatar from './Avatar'
import DeleteAccountDialog from './DeleteAccountDialog'
import MyExpensesModal from './MyExpensesModal'
import type { Theme } from '../lib/types'

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'light', label: '☀️ Claro' },
  { value: 'dark', label: '🌙 Oscuro' },
  { value: 'system', label: '📱 Del móvil' },
]

export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, profile, refreshProfile, signOut } = useAuth()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [showDelete, setShowDelete] = useState(false)
  const [showMyExpenses, setShowMyExpenses] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [emailSubmitting, setEmailSubmitting] = useState(false)
  const [emailMessage, setEmailMessage] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)

  if (!user || !profile) return null

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setPreviewUrl(URL.createObjectURL(file))
    setUploading(true)

    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { contentType: file.type || 'image/jpeg' })

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
    setEmailMessage('Te hemos mandado un email de confirmación a la nueva dirección. Hasta que no lo confirmes, seguirás entrando con la actual.')
    setNewEmail('')
  }

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault()
    setPasswordMessage(null)
    if (newPassword.length < 6) {
      setPasswordMessage('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage('Las dos contraseñas no coinciden.')
      return
    }
    setPasswordSubmitting(true)
    const { error: err } = await supabase.auth.updateUser({ password: newPassword })
    setPasswordSubmitting(false)
    if (err) {
      setPasswordMessage(err.message)
      return
    }
    setPasswordMessage('Contraseña actualizada.')
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Cerrar"
          title="Cerrar"
          className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
        >
          ✕
        </button>
        <h2 className="mb-4 pr-8 text-lg font-semibold text-slate-900 dark:text-slate-100">Tu perfil</h2>

        <div className="mb-5 flex flex-col items-center gap-3">
          <Avatar
            username={profile.username}
            avatarUrl={previewUrl ?? profile.avatar_url}
            size={88}
            className="ring-2 ring-slate-100 dark:ring-slate-700"
          />
          <label className="cursor-pointer rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100">
            {uploading ? 'Subiendo…' : 'Cambiar foto'}
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
          className="mb-6 w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          📊 Mis gastos
        </button>

        <div className="mb-6 space-y-3 border-t border-slate-100 pt-5 dark:border-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Apariencia</p>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTheme(t.value)}
                className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium transition ${
                  profile.theme === t.value
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-700/20'
                    : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Color de acento</p>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setAccentColor(c)}
                  aria-label={`Color ${c}`}
                  className="h-8 w-8 rounded-full transition"
                  style={{
                    backgroundColor: c,
                    boxShadow: profile.accent_color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mb-6 space-y-3 border-t border-slate-100 pt-5 dark:border-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cambiar contraseña</p>
          <form onSubmit={handleChangePassword} className="space-y-2">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Contraseña nueva"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repite la contraseña"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            {passwordMessage && <p className="text-xs text-slate-500 dark:text-slate-400">{passwordMessage}</p>}
            <button
              type="submit"
              disabled={passwordSubmitting || !newPassword}
              className="w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {passwordSubmitting ? 'Guardando…' : 'Actualizar contraseña'}
            </button>
          </form>
        </div>

        <div className="mb-6 space-y-3 border-t border-slate-100 pt-5 dark:border-slate-700">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Cambiar email</p>
          <form onSubmit={handleChangeEmail} className="space-y-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="nuevo@email.com"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
            />
            {emailMessage && <p className="text-xs text-slate-500 dark:text-slate-400">{emailMessage}</p>}
            <button
              type="submit"
              disabled={emailSubmitting || !newEmail}
              className="w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {emailSubmitting ? 'Guardando…' : 'Actualizar email'}
            </button>
          </form>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cerrar
          </button>
          <button
            onClick={() => signOut()}
            className="flex-1 rounded-lg border border-red-200 px-4 py-2.5 font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
          >
            Cerrar sesión
          </button>
        </div>

        <button
          onClick={() => setShowDelete(true)}
          className="mt-4 w-full text-center text-xs text-red-400 hover:text-red-600"
        >
          Eliminar cuenta
        </button>
      </div>

      {showDelete && <DeleteAccountDialog onClose={() => setShowDelete(false)} />}
      {showMyExpenses && <MyExpensesModal onClose={() => setShowMyExpenses(false)} />}
    </div>
  )
}
