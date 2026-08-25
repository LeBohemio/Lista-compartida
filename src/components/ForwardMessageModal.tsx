import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { colorForList } from '../lib/colors'
import { useLanguage } from '../lib/i18n'
import Avatar from './Avatar'
import type { ChatTarget } from './ChatPanel'
import type { Contact, List, Message } from '../lib/types'

// Misma convención de rutas que ChatPanel.tsx (deben coincidir con
// public.is_chat_image_participant en migration_v18.sql).
function imagePathPrefix(target: ChatTarget, myUserId: string) {
  if (target.kind === 'list') return target.listId
  const pair = [myUserId, target.peerId].sort()
  return `dm/${pair[0]}_${pair[1]}`
}

export default function ForwardMessageModal({
  message,
  currentTarget,
  onClose,
  onForwarded,
}: {
  message: Message
  currentTarget: ChatTarget
  onClose: () => void
  onForwarded: () => void
}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [lists, setLists] = useState<List[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [sendingTo, setSendingTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    Promise.all([
      supabase.from('list_members').select('list:lists(*)').eq('user_id', user.id).eq('status', 'accepted'),
      supabase.from('contacts').select('*, contact:profiles!contacts_contact_user_id_fkey(*)').eq('user_id', user.id),
    ]).then(([listsRes, contactsRes]) => {
      const allLists = ((listsRes.data as unknown as { list: List }[]) ?? []).map((r) => r.list).filter(Boolean)
      setLists(allLists.filter((l) => !(currentTarget.kind === 'list' && l.id === currentTarget.listId)))
      const allContacts = ((contactsRes.data as unknown as Contact[]) ?? []).filter((c) => c.contact)
      setContacts(allContacts.filter((c) => !(currentTarget.kind === 'direct' && c.contact_user_id === currentTarget.peerId)))
      setLoading(false)
    })
  }, [user, currentTarget])

  const forwardTo = async (target: ChatTarget, key: string) => {
    if (!user) return
    setSendingTo(key)
    setError(null)

    let newImagePath: string | null = null
    if (message.image_path) {
      const { data: blob, error: downloadErr } = await supabase.storage
        .from('chat-images')
        .download(message.image_path)
      if (downloadErr || !blob) {
        setError(t('forward.errorCopyPhoto'))
        setSendingTo(null)
        return
      }
      const ext = message.image_path.split('.').pop() || 'jpg'
      newImagePath = `${imagePathPrefix(target, user.id)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('chat-images')
        .upload(newImagePath, blob, { contentType: blob.type || 'image/jpeg' })
      if (uploadErr) {
        setError(t('forward.errorCopyPhoto'))
        setSendingTo(null)
        return
      }
    }

    let newAudioPath: string | null = null
    if (message.audio_path) {
      const { data: blob, error: downloadErr } = await supabase.storage
        .from('chat-audio')
        .download(message.audio_path)
      if (downloadErr || !blob) {
        setError(t('forward.errorCopyAudio'))
        setSendingTo(null)
        return
      }
      const ext = message.audio_path.split('.').pop() || 'webm'
      newAudioPath = `${imagePathPrefix(target, user.id)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('chat-audio')
        .upload(newAudioPath, blob, { contentType: blob.type || 'audio/webm' })
      if (uploadErr) {
        setError(t('forward.errorCopyAudio'))
        setSendingTo(null)
        return
      }
    }

    let newFilePath: string | null = null
    if (message.file_path) {
      const { data: blob, error: downloadErr } = await supabase.storage
        .from('chat-files')
        .download(message.file_path)
      if (downloadErr || !blob) {
        setError(t('forward.errorCopyFile'))
        setSendingTo(null)
        return
      }
      const ext = message.file_path.split('.').pop() || 'bin'
      newFilePath = `${imagePathPrefix(target, user.id)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadErr } = await supabase.storage
        .from('chat-files')
        .upload(newFilePath, blob, { contentType: message.file_mime_type || 'application/octet-stream' })
      if (uploadErr) {
        setError(t('forward.errorCopyFile'))
        setSendingTo(null)
        return
      }
    }

    const { error: insertErr } = await supabase.from('messages').insert({
      list_id: target.kind === 'list' ? target.listId : null,
      to_user_id: target.kind === 'direct' ? target.peerId : null,
      sender_id: user.id,
      content: message.content,
      image_path: newImagePath,
      audio_path: newAudioPath,
      audio_duration_seconds: newAudioPath ? message.audio_duration_seconds : null,
      file_path: newFilePath,
      file_name: newFilePath ? message.file_name : null,
      file_mime_type: newFilePath ? message.file_mime_type : null,
      file_size_bytes: newFilePath ? message.file_size_bytes : null,
    })

    setSendingTo(null)
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    onForwarded()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="glass-panel max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{t('forward.title')}</h2>

        {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}

        {loading ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('forward.loadingLists')}</p>
        ) : lists.length === 0 && contacts.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">{t('forward.noOtherLists')}</p>
        ) : (
          <div className="space-y-4">
            {lists.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('nav.tabLists')}</p>
                <div className="space-y-2">
                  {lists.map((l) => (
                    <button
                      key={l.id}
                      onClick={() => forwardTo({ kind: 'list', listId: l.id }, l.id)}
                      disabled={sendingTo !== null}
                      className="flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left text-sm hover:bg-white/60 disabled:opacity-50 border-[var(--color-glass-border)] dark:hover:bg-white/10"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorForList(l) }} />
                      <span className="flex-1 truncate text-slate-800 dark:text-slate-100">{l.name}</span>
                      {sendingTo === l.id && <span className="text-xs text-slate-500 dark:text-slate-400">{t('forward.sending')}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {contacts.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{t('nav.tabContacts')}</p>
                <div className="space-y-2">
                  {contacts.map((c) => (
                    <button
                      key={c.contact_user_id}
                      onClick={() => forwardTo({ kind: 'direct', peerId: c.contact_user_id }, c.contact_user_id)}
                      disabled={sendingTo !== null}
                      className="flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left text-sm hover:bg-white/60 disabled:opacity-50 border-[var(--color-glass-border)] dark:hover:bg-white/10"
                    >
                      <Avatar username={c.contact!.username} avatarUrl={c.contact!.avatar_url} size={24} enlargeOnClick={false} />
                      <span className="flex-1 truncate text-slate-800 dark:text-slate-100">{c.contact!.username}</span>
                      {sendingTo === c.contact_user_id && <span className="text-xs text-slate-500 dark:text-slate-400">{t('forward.sending')}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
