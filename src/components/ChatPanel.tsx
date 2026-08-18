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

// A quién pertenece esta conversación: el chat de una lista (como hasta
// ahora) o el chat directo con un contacto (ver migration_v18.sql). El
// resto del componente deriva de aquí el payload de inserción y la
// convención de ruta de las fotos, sin duplicar la lógica de la UI.
export type ChatTarget = { kind: 'list'; listId: string } | { kind: 'direct'; peerId: string }

function imagePathPrefix(target: ChatTarget, myUserId: string) {
  if (target.kind === 'list') return target.listId
  // Convención "dm/{id_menor}_{id_mayor}" — ordenados para que ambas
  // personas calculen siempre la misma ruta. Debe coincidir exactamente
  // con la que espera public.is_chat_image_participant en migration_v18.sql.
  const pair = [myUserId, target.peerId].sort()
  return `dm/${pair[0]}_${pair[1]}`
}

function insertPayload(target: ChatTarget) {
  return target.kind === 'list'
    ? { list_id: target.listId, to_user_id: null }
    : { list_id: null, to_user_id: target.peerId }
}

export default function ChatPanel({
  target,
  messages,
  readOnly,
}: {
  target: ChatTarget
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
    let cancelled = false

    // Justo después de que alguien envía una foto, pedir su URL firmada
    // puede fallar la primera vez (el archivo acaba de subirse y el
    // almacenamiento tarda un pelín en tenerlo listo para firmar) — sin
    // reintentar, esa foto se quedaba rota hasta refrescar la página a
    // mano, porque nada más volvía a disparar este efecto. Reintentamos
    // un par de veces con una pequeña espera antes de rendirnos.
    const attempt = (retriesLeft: number) => {
      supabase.storage
        .from('chat-images')
        .createSignedUrls(missing, 3600)
        .then(({ data }) => {
          if (cancelled) return
          if (data) {
            setImageUrls((prev) => {
              const next = { ...prev }
              for (const row of data) {
                if (row.signedUrl && row.path) next[row.path] = row.signedUrl
              }
              return next
            })
          }
          const stillMissing = !data || data.some((row) => !row.signedUrl)
          if (stillMissing && retriesLeft > 0) {
            setTimeout(() => {
              if (!cancelled) attempt(retriesLeft - 1)
            }, 1200)
          }
        })
    }
    attempt(3)

    return () => {
      cancelled = true
    }
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
      .insert({ ...insertPayload(target), sender_id: user.id, content: text.trim() })
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
    const path = `${imagePathPrefix(target, user.id)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('chat-images')
      .upload(path, file, { contentType: file.type || 'image/jpeg' })

    if (uploadErr) {
      setError(t('profile.errorUploadPhoto', { message: uploadErr.message }))
      setSending(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const { error: insertErr } = await supabase
      .from('messages')
      .insert({ ...insertPayload(target), sender_id: user.id, image_path: path, content: text.trim() || null })

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
          <p className="py-8 text-center text-sm text-slate-400">{t('chat.empty')}</p>
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

      <div className="fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur border-[var(--color-surface-border)] bg-[var(--color-surface-alt)]/95">
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
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg text-slate-500 hover:bg-slate-200 disabled:opacity-50 bg-[var(--color-surface)] dark:text-slate-300 dark:hover:bg-slate-700"
                aria-label={t('chat.attachPhoto')}
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
                placeholder={t('chat.placeholder')}
                className="flex-1 rounded-full border px-4 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface)] dark:text-slate-100"
              />
              <button
                type="submit"
                disabled={sending || !text.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow ring-2 ring-white/40 dark:shadow-black/40 dark:ring-white/15 hover:bg-brand-700 disabled:opacity-50"
                aria-label={t('chat.send')}
              >
                ➤
              </button>
            </form>
          )}
        </div>
      </div>

      {lastPendingId && <UndoToast message={t('chat.messageDeleted')} onUndo={() => undoDeleteMessage(lastPendingId)} />}
      {copiedFeedback && <Toast message={t('chat.copied')} />}

      {menuTarget && (
        <ContextMenu
          onClose={() => setMenuTarget(null)}
          actions={[
            ...(menuTarget.content
              ? [{ label: t('menu.copy'), icon: '📋', onSelect: () => copyMessage(menuTarget) }]
              : []),
            { label: t('menu.forward'), icon: '↪️', onSelect: () => setForwardTarget(menuTarget) },
            ...(menuTarget.sender_id === user?.id
              ? [{ label: t('menu.delete'), icon: '🗑', danger: true, onSelect: () => requestDeleteMessage(menuTarget.id) }]
              : []),
          ]}
        />
      )}

      {forwardTarget && (
        <ForwardMessageModal
          message={forwardTarget}
          currentTarget={target}
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
            aria-label={t('chat.closeViewer')}
            title={t('chat.closeViewer')}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl text-white hover:bg-white/20"
          >
            ✕
          </button>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img
            src={viewerUrl}
            alt={t('chat.photoExpanded')}
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
  const { t, language } = useLanguage()
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
              ? 'rounded-br-sm bg-brand-500 text-white ring-1 ring-black/10'
              : 'rounded-bl-sm text-slate-800 ring-1 bg-[var(--color-surface)] dark:text-slate-100 ring-[var(--color-surface-border)]'
          }`}
        >
          {m.image_path && imageUrl && (
            <img
              src={imageUrl}
              alt={t('chat.photoAlt')}
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
          {new Date(m.created_at).toLocaleTimeString(language === 'en' ? 'en-US' : 'es-ES', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  )
}
