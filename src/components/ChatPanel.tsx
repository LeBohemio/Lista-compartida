import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useLongPress } from '../hooks/useLongPress'
import Avatar from './Avatar'
import UndoToast from './UndoToast'
import Toast from './Toast'
import ContextMenu from './ContextMenu'
import ForwardMessageModal from './ForwardMessageModal'
import { colorForName } from '../lib/colors'
import type { Message } from '../lib/types'

const UNDO_DELAY_MS = 5000

export default function ChatPanel({
  listId,
  messages,
  readOnly,
}: {
  listId: string
  messages: Message[]
  readOnly?: boolean
}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [lastPendingId, setLastPendingId] = useState<string | null>(null)
  const [menuTarget, setMenuTarget] = useState<Message | null>(null)
  const [forwardTarget, setForwardTarget] = useState<Message | null>(null)
  const [copiedFeedback, setCopiedFeedback] = useState(false)
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)

  const visibleMessages = useMemo(
    () => messages.filter((m) => !pendingDeleteIds.has(m.id)),
    [messages, pendingDeleteIds],
  )

  const imagePaths = useMemo(
    () => visibleMessages.filter((m) => m.image_path).map((m) => m.image_path as string),
    [visibleMessages],
  )

  useEffect(() => {
    const missing = imagePaths.filter((p) => !imageUrls[p])
    if (missing.length === 0) return
    supabase.storage
      .from('chat-images')
      .createSignedUrls(missing, 3600)
      .then(({ data }) => {
        if (!data) return
        setImageUrls((prev) => {
          const next = { ...prev }
          for (const row of data) {
            if (row.signedUrl && row.path) next[row.path] = row.signedUrl
          }
          return next
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePaths])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [visibleMessages.length])

  const sendText = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim() || !user) return
    setSending(true)
    setError(null)
    const { error: err } = await supabase
      .from('messages')
      .insert({ list_id: listId, sender_id: user.id, content: text.trim() })
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    setText('')
  }

  const sendImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setError(null)
    setSending(true)

    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${listId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('chat-images')
      .upload(path, file, { contentType: file.type || 'image/jpeg' })

    if (uploadErr) {
      setError(`No se pudo subir la foto: ${uploadErr.message}`)
      setSending(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const { error: insertErr } = await supabase
      .from('messages')
      .insert({ list_id: listId, sender_id: user.id, image_path: path, content: text.trim() || null })

    setSending(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setText('')
  }

  const requestDeleteMessage = (messageId: string) => {
    setPendingDeleteIds((prev) => new Set(prev).add(messageId))
    setLastPendingId(messageId)
    const timer = setTimeout(async () => {
      timersRef.current.delete(messageId)
      await supabase.from('messages').delete().eq('id', messageId)
      setPendingDeleteIds((prev) => {
        const next = new Set(prev)
        next.delete(messageId)
        return next
      })
      setLastPendingId((cur) => (cur === messageId ? null : cur))
    }, UNDO_DELAY_MS)
    timersRef.current.set(messageId, timer)
  }

  const undoDeleteMessage = (messageId: string) => {
    const timer = timersRef.current.get(messageId)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(messageId)
    }
    setPendingDeleteIds((prev) => {
      const next = new Set(prev)
      next.delete(messageId)
      return next
    })
    setLastPendingId((cur) => (cur === messageId ? null : cur))
  }

  const copyMessage = async (m: Message) => {
    if (!m.content) return
    try {
      await navigator.clipboard.writeText(m.content)
      setCopiedFeedback(true)
      setTimeout(() => setCopiedFeedback(false), 1800)
    } catch {
      // silencioso
    }
  }

  return (
    <div>
      <div className="space-y-3 pb-24">
        {visibleMessages.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Todavía no hay mensajes. ¡Escribe el primero!</p>
        ) : (
          visibleMessages.map((m, idx) => {
            const isMine = m.sender_id === user?.id
            const isFirstInGroup = idx === 0 || visibleMessages[idx - 1].sender_id !== m.sender_id
            return (
              <MessageBubble
                key={m.id}
                message={m}
                isMine={isMine}
                isFirstInGroup={isFirstInGroup}
                imageUrl={m.image_path ? imageUrls[m.image_path] : undefined}
                onLongPress={() => setMenuTarget(m)}
                onOpenImage={setViewerUrl}
              />
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-[var(--color-surface-border)] dark:bg-[var(--color-surface-alt)]/95">
        <div className="mx-auto max-w-2xl px-4 py-3">
          {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}
          {readOnly ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              🔒 {t('chat.readOnlyHint')}
            </p>
          ) : (
            <form onSubmit={sendText} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg text-slate-500 hover:bg-slate-200 disabled:opacity-50 dark:bg-[var(--color-surface)] dark:text-slate-300 dark:hover:bg-slate-700"
                aria-label="Adjuntar foto"
              >
                📷
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={sendImage}
                className="hidden"
              />
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Escribe un mensaje…"
                className="flex-1 rounded-full border border-slate-300 px-4 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-[var(--color-surface-border)] dark:bg-[var(--color-surface)] dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={sending || !text.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
                aria-label="Enviar"
              >
                ➤
              </button>
            </form>
          )}
        </div>
      </div>

      {lastPendingId && <UndoToast message="Mensaje eliminado" onUndo={() => undoDeleteMessage(lastPendingId)} />}
      {copiedFeedback && <Toast message="Copiado al portapapeles" />}

      {menuTarget && (
        <ContextMenu
          onClose={() => setMenuTarget(null)}
          actions={[
            ...(menuTarget.content
              ? [{ label: 'Copiar', icon: '📋', onSelect: () => copyMessage(menuTarget) }]
              : []),
            { label: 'Reenviar', icon: '↪️', onSelect: () => setForwardTarget(menuTarget) },
            ...(menuTarget.sender_id === user?.id
              ? [{ label: 'Eliminar', icon: '🗑', danger: true, onSelect: () => requestDeleteMessage(menuTarget.id) }]
              : []),
          ]}
        />
      )}

      {forwardTarget && (
        <ForwardMessageModal
          message={forwardTarget}
          currentListId={listId}
          onClose={() => setForwardTarget(null)}
          onForwarded={() => setForwardTarget(null)}
        />
      )}

      {viewerUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setViewerUrl(null)}
        >
          <button
            onClick={() => setViewerUrl(null)}
            aria-label="Cerrar"
            title="Cerrar"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl text-white hover:bg-white/20"
          >
            ✕
          </button>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img
            src={viewerUrl}
            alt="Foto ampliada"
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  message: m,
  isMine,
  isFirstInGroup,
  imageUrl,
  onLongPress,
  onOpenImage,
}: {
  message: Message
  isMine: boolean
  isFirstInGroup: boolean
  imageUrl?: string
  onLongPress: () => void
  onOpenImage: (url: string) => void
}) {
  const longPress = useLongPress(onLongPress)

  return (
    <div className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
      {!isMine && (
        <div className="w-7 shrink-0">
          {isFirstInGroup && <Avatar username={m.sender?.username ?? '?'} avatarUrl={m.sender?.avatar_url} size={28} />}
        </div>
      )}
      <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isMine && isFirstInGroup && (
          <p className="mb-0.5 px-1 text-xs font-medium" style={{ color: colorForName(m.sender?.username ?? '?') }}>
            {m.sender?.username ?? '—'}
          </p>
        )}
        <div
          {...longPress}
          className={`select-none rounded-2xl px-3 py-2 text-sm shadow-sm ${
            isMine
              ? 'rounded-br-sm bg-brand-600 text-white'
              : 'rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200 dark:bg-[var(--color-surface)] dark:text-slate-100 dark:ring-[var(--color-surface-border)]'
          }`}
        >
          {m.image_path && imageUrl && (
            <img
              src={imageUrl}
              alt="Foto"
              className="mb-1 max-h-56 cursor-pointer rounded-lg object-contain"
              onClick={(e) => {
                e.stopPropagation()
                onOpenImage(imageUrl)
              }}
            />
          )}
          {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
        </div>
        <p className="mt-0.5 px-1 text-[10px] text-slate-400">
          {new Date(m.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}
