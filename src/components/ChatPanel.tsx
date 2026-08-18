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

function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(s / 60)
  const seconds = s % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

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
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const audioPaths = useMemo(
    () => visibleMessages.filter((m) => m.audio_path).map((m) => m.audio_path as string),
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

  // Mismo patrón de reintento que las fotos, pero contra el bucket
  // "chat-audio" (ver migration_v20.sql) para las notas de voz.
  useEffect(() => {
    const missing = audioPaths.filter((p) => !audioUrls[p])
    if (missing.length === 0) return
    let cancelled = false

    const attempt = (retriesLeft: number) => {
      supabase.storage
        .from('chat-audio')
        .createSignedUrls(missing, 3600)
        .then(({ data }) => {
          if (cancelled) return
          if (data) {
            setAudioUrls((prev) => {
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
  }, [audioPaths])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [visibleMessages.length])

  // Si la persona sale de la conversación (o del navegador desde otra
  // pestaña) mientras estaba grabando, no queremos dejar el micrófono
  // "encendido" a nivel de sistema operativo.
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

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

  const sendAudioBlob = async (blob: Blob, durationSeconds: number) => {
    if (!user || blob.size === 0) return
    setError(null)
    setSending(true)

    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'
    const path = `${imagePathPrefix(target, user.id)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('chat-audio')
      .upload(path, blob, { contentType: blob.type || 'audio/webm' })

    if (uploadErr) {
      setError(t('chat.errorUploadAudio', { message: uploadErr.message }))
      setSending(false)
      return
    }

    const { error: insertErr } = await supabase.from('messages').insert({
      ...insertPayload(target),
      sender_id: user.id,
      audio_path: path,
      audio_duration_seconds: Math.max(1, Math.round(durationSeconds)),
    })

    setSending(false)
    if (insertErr) setError(insertErr.message)
  }

  const startRecording = async () => {
    if (!user || recording) return
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      recordingStreamRef.current = stream
      const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(
        (candidate) => typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(candidate),
      )
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.start()
      mediaRecorderRef.current = recorder
      setRecording(true)
      setRecordingSeconds(0)
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000)
    } catch {
      setError(t('chat.micError'))
    }
  }

  // send=false → botón de papelera, descarta la grabación.
  // send=true  → botón de enviar, sube el audio y crea el mensaje.
  const stopRecording = (send: boolean) => {
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    const durationSeconds = recordingSeconds

    recorder.onstop = () => {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
      recordingStreamRef.current = null
      mediaRecorderRef.current = null
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
      }
      setRecording(false)
      setRecordingSeconds(0)

      const chunks = audioChunksRef.current
      audioChunksRef.current = []
      if (!send) return
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      void sendAudioBlob(blob, durationSeconds)
    }

    if (recorder.state !== 'inactive') recorder.stop()
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
                audioUrl={m.audio_path ? audioUrls[m.audio_path] : undefined}
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
          ) : recording ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stopRecording(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                aria-label={t('chat.cancelRecording')}
                title={t('chat.cancelRecording')}
              >
                🗑
              </button>
              <div className="flex flex-1 items-center gap-2 rounded-full border px-4 py-2.5 border-[var(--color-surface-border)] bg-[var(--color-surface)]">
                <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                <span className="text-sm text-slate-600 dark:text-slate-300">{t('chat.recording')}</span>
                <span className="ml-auto text-sm tabular-nums text-slate-500 dark:text-slate-400">
                  {formatDuration(recordingSeconds)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => stopRecording(true)}
                disabled={sending}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow ring-2 ring-white/40 dark:shadow-black/40 dark:ring-white/15 hover:bg-brand-700 disabled:opacity-50"
                aria-label={t('chat.sendAudio')}
                title={t('chat.sendAudio')}
              >
                ➤
              </button>
            </div>
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
              {text.trim() ? (
                <button
                  type="submit"
                  disabled={sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow ring-2 ring-white/40 dark:shadow-black/40 dark:ring-white/15 hover:bg-brand-700 disabled:opacity-50"
                  aria-label={t('chat.send')}
                >
                  ➤
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow ring-2 ring-white/40 dark:shadow-black/40 dark:ring-white/15 hover:bg-brand-700 disabled:opacity-50"
                  aria-label={t('chat.attachAudio')}
                  title={t('chat.attachAudio')}
                >
                  🎤
                </button>
              )}
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
  audioUrl,
  onLongPress,
  onOpenImage,
}: {
  message: Message
  isMine: boolean
  isFirstInGroup: boolean
  imageUrl?: string
  audioUrl?: string
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
          {m.audio_path && (
            <div className="mb-1 flex items-center gap-2">
              {audioUrl ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio controls preload="metadata" src={audioUrl} className="h-10 w-56 max-w-full" />
              ) : (
                <p className="text-xs italic text-slate-400">{t('chat.loadingAudio')}</p>
              )}
              {m.audio_duration_seconds != null && (
                <span className={`text-xs tabular-nums ${isMine ? 'text-white/80' : 'text-slate-400'}`}>
                  {formatDuration(m.audio_duration_seconds)}
                </span>
              )}
            </div>
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
