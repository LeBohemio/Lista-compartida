import { useState, type ChangeEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Avatar from './Avatar'

export default function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, profile, refreshProfile, signOut } = useAuth()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Tu perfil</h2>

        <div className="mb-5 flex flex-col items-center gap-3">
          <Avatar
            username={profile.username}
            avatarUrl={previewUrl ?? profile.avatar_url}
            size={88}
            className="ring-2 ring-slate-100"
          />
          <label className="cursor-pointer rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100">
            {uploading ? 'Subiendo…' : 'Cambiar foto'}
            <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} className="hidden" />
          </label>
        </div>

        <div className="mb-5 space-y-1 text-center">
          <p className="font-medium text-slate-900">{profile.username}</p>
          <p className="text-sm text-slate-500">{profile.email}</p>
        </div>

        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            Cerrar
          </button>
          <button
            onClick={() => signOut()}
            className="flex-1 rounded-lg border border-red-200 px-4 py-2.5 font-medium text-red-600 hover:bg-red-50"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  )
}
