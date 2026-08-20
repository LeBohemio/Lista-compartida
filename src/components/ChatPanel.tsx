import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage, type TranslationKey } from '../lib/i18n'
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

function isSameDay(a: string, b: string) {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

// Separadores de fecha entre grupos de mensajes de días distintos, como en
// cualquier app de chat — "Hoy" y "Ayer" en vez de la fecha completa cuando
// aplica, para que sea más fácil de leer de un vistazo.
function formatDayLabel(dateStr: string, t: (key: TranslationKey) => string, language: 'es' | 'en') {
  const date = new Date(dateStr)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(dateStr, now.toISOString())) return t('chat.today')
  if (isSameDay(dateStr, yesterday.toISOString())) return t('chat.yesterday')
  return date.toLocaleDateString(language === 'en' ? 'en-US' : 'es-ES', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
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

// Para poder darle a la persona los pasos exactos de SU navegador cuando
// falla el permiso de micrófono, en vez de una instrucción genérica que no
// encaja con lo que está viendo en pantalla.
function detectPlatform(): 'android' | 'ios' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  return 'desktop'
}

// Si la persona instaló NoteUs en la pantalla de inicio (en vez de tenerla
// abierta como una pestaña más del navegador), Android/iOS la tratan como
// una app de verdad: el permiso de micrófono se gestiona luego desde los
// Ajustes de aplicaciones del propio teléfono, no desde los ajustes del
// navegador — que es justo lo que se pidió ("autorizar a la aplicación").
// display-mode:standalone (Android/Chrome) y navigator.standalone (iOS
// Safari) son las dos formas de saberlo.
function isStandalonePwa(): boolean {
  if (typeof window === 'undefined') return false
  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)').matches
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return Boolean(standaloneMedia || iosStandalone)
}

function micDeniedInstructionKey(): TranslationKey {
  const platform = detectPlatform()
  const standalone = isStandalonePwa()
  if (platform === 'android') return standalone ? 'chat.micDeniedAndroidApp' : 'chat.micDeniedAndroidBrowser'
  if (platform === 'ios') return standalone ? 'chat.micDeniedIosApp' : 'chat.micDeniedIosBrowser'
  return 'chat.micDeniedDesktop'
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
  const { t, language } = useLanguage()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [audioUrls, setAudioUrls] = useState<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Foto elegida (de cámara o galería) pendiente de confirmar: se muestra
  // en una hoja con vista previa y un texto opcional antes de subirla y
  // mandarla de verdad — antes se enviaba sola en cuanto se elegía el
  // archivo, sin poder revisarla ni añadir nada.
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null)

  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [slideCancelHint, setSlideCancelHint] = useState(false)
  const [micErrorKind, setMicErrorKind] = useState<'denied' | 'notfound' | 'other' | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Umbral antes de que un pulsar-mantener en el micrófono empiece a grabar
  // de verdad: un toque suelto (más corto que esto) no hace nada en
  // absoluto, ni siquiera pide permiso — solo si el dedo sigue apoyado
  // pasado este tiempo se arranca el micrófono.
  const micHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Punto X donde empezó el gesto (para el "desliza para cancelar") y si ya
  // se ha soltado el dedo antes de que el micrófono terminara de arrancar
  // (el permiso del navegador tarda en resolver la primera vez).
  const recordingStartXRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)
  const pendingReleaseRef = useRef<'send' | 'cancel' | null>(null)

  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [lastPendingId, setLastPendingId] = useState<string | null>(null)
  const [menuTarget, setMenuTarget] = useState<Message | null>(null)
  const [showPhotoMenu, setShowPhotoMenu] = useState(false)
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

  // Al entrar en una conversación hay que aterrizar YA en el mensaje más
  // reciente (como cualquier app de chat), no ir viéndolo deslizarse desde
  // arriba — así que la primera vez que hay mensajes cargados, el salto es
  // instantáneo. Si mientras tanto llegan mensajes nuevos con el chat ya
  // abierto, ahí sí queremos el deslizamiento suave de toda la vida.
  const conversationKey = target.kind === 'list' ? `list:${target.listId}` : `direct:${target.peerId}`
  const landedRef = useRef<string | null>(null)
  useEffect(() => {
    if (visibleMessages.length === 0) return
    const isFirstLanding = landedRef.current !== conversationKey
    if (isFirstLanding) landedRef.current = conversationKey
    bottomRef.current?.scrollIntoView({ behavior: isFirstLanding ? 'auto' : 'smooth' })
  }, [visibleMessages.length, conversationKey])

  // Las fotos y notas de voz llegan con su URL firmada un poco después del
  // primer render (ver los efectos de arriba) y cambian la altura de la
  // conversación al cargar — sin este segundo salto (sin animación, para no
  // ser intrusivo), ese cambio de altura podía dejar el aterrizaje inicial
  // a media conversación en vez de al final del todo.
  useEffect(() => {
    if (landedRef.current !== conversationKey) return
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [imageUrls, audioUrls, conversationKey])

  // Si la persona sale de la conversación (o del navegador desde otra
  // pestaña) mientras estaba grabando, no queremos dejar el micrófono
  // "encendido" a nivel de sistema operativo.
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      if (micHoldTimerRef.current) clearTimeout(micHoldTimerRef.current)
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  // La caja de escribir crece con el texto (hasta un máximo, luego hace
  // scroll dentro) en vez de quedarse en una sola línea — así un mensaje
  // largo se ve entero mientras se escribe, sin desplazarse por dentro de
  // una línea diminuta.
  const COMPOSER_MAX_HEIGHT_PX = 120
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`
  }, [text])

  // Enter manda el mensaje (como siempre); Mayús+Enter mete un salto de
  // línea, para poder escribir mensajes de varias líneas cuando hace falta.
  const handleComposerKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.trim() && !sending) e.currentTarget.form?.requestSubmit()
    }
  }

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

  // Al elegir una foto (de cámara o galería) no se manda sola: se guarda
  // como "pendiente" y se muestra en una hoja de confirmación con vista
  // previa, donde se puede añadir un texto antes de mandarla de verdad.
  const onSelectImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return { file, previewUrl: URL.createObjectURL(file) }
    })
  }

  const resetImageInputs = () => {
    if (galleryInputRef.current) galleryInputRef.current.value = ''
    if (cameraInputRef.current) cameraInputRef.current.value = ''
  }

  const cancelPendingImage = () => {
    if (sending) return
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl)
    setPendingImage(null)
    resetImageInputs()
  }

  const confirmSendImage = async () => {
    if (!pendingImage || !user) return
    setError(null)
    setSending(true)

    const file = pendingImage.file
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${imagePathPrefix(target, user.id)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('chat-images')
      .upload(path, file, { contentType: file.type || 'image/jpeg' })

    if (uploadErr) {
      setError(t('profile.errorUploadPhoto', { message: uploadErr.message }))
      setSending(false)
      return
    }

    const { error: insertErr } = await supabase
      .from('messages')
      .insert({ ...insertPayload(target), sender_id: user.id, image_path: path, content: text.trim() || null })

    setSending(false)
    URL.revokeObjectURL(pendingImage.previewUrl)
    setPendingImage(null)
    resetImageInputs()
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
    setMicErrorKind(null)
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

      // Si para cuando el micrófono por fin ha arrancado la persona ya
      // había soltado el dedo (típico la primera vez: el permiso del
      // navegador tarda en resolverse y el toque puede ser muy rápido), no
      // dejamos la grabación colgada — se cierra ya mismo con lo que se
      // decidió al soltar.
      if (pendingReleaseRef.current) {
        const action = pendingReleaseRef.current
        pendingReleaseRef.current = null
        stopRecording(action === 'send')
      }
    } catch (err) {
      pendingReleaseRef.current = null
      const name = (err as { name?: string } | undefined)?.name
      setMicErrorKind(name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' ? 'notfound' : 'other')
    }
  }

  // send=false → se ha cancelado (deslizando), descarta la grabación.
  // send=true  → se ha soltado sin cancelar, sube el audio y crea el mensaje.
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
      setSlideCancelHint(false)

      const chunks = audioChunksRef.current
      audioChunksRef.current = []
      if (!send) return
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      void sendAudioBlob(blob, durationSeconds)
    }

    if (recorder.state !== 'inactive') recorder.stop()
  }

  const CANCEL_THRESHOLD_PX = 80
  const MIC_HOLD_THRESHOLD_MS = 200

  // Mantener pulsado para grabar, soltar para enviar, deslizar hacia la
  // izquierda para cancelar — igual que WhatsApp. Usamos Pointer Events con
  // "capture" para seguir recibiendo el movimiento y la soltada aunque el
  // dedo se salga del botón mientras se desliza.
  const handleMicPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (sending || recording) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // algún navegador raro sin soporte de pointer capture: seguimos sin
      // eso, simplemente no habrá gesto de deslizar para cancelar.
    }
    recordingStartXRef.current = e.clientX
    cancelledRef.current = false
    pendingReleaseRef.current = null
    setSlideCancelHint(false)
    // No arrancamos a grabar al instante: esperamos un poco a ver si de
    // verdad es un "mantener pulsado" y no un toque suelto.
    micHoldTimerRef.current = setTimeout(() => {
      micHoldTimerRef.current = null
      void startRecording()
    }, MIC_HOLD_THRESHOLD_MS)
  }

  const handleMicPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!recording || recordingStartXRef.current == null) return
    const dx = e.clientX - recordingStartXRef.current
    const shouldCancel = dx < -CANCEL_THRESHOLD_PX
    cancelledRef.current = shouldCancel
    setSlideCancelHint(shouldCancel)
  }

  const handleMicPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // nada que liberar si no se llegó a capturar.
    }
    if (micHoldTimerRef.current) {
      // Se ha soltado antes de que se cumpliera el umbral: el micrófono no
      // ha llegado a arrancar (ni se ha pedido permiso), así que un toque
      // suelto no hace absolutamente nada.
      clearTimeout(micHoldTimerRef.current)
      micHoldTimerRef.current = null
      recordingStartXRef.current = null
      cancelledRef.current = false
      setSlideCancelHint(false)
      return
    }
    const shouldSend = !cancelledRef.current
    recordingStartXRef.current = null
    setSlideCancelHint(false)
    if (recording) {
      stopRecording(shouldSend)
    } else {
      // El micrófono todavía no ha terminado de arrancar (primer permiso):
      // en cuanto lo haga, se cierra solo con esta misma decisión.
      pendingReleaseRef.current = shouldSend ? 'send' : 'cancel'
    }
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
            const prev = idx > 0 ? visibleMessages[idx - 1] : null
            const isMine = m.sender_id === user?.id
            const isFirstInGroup = !prev || prev.sender_id !== m.sender_id
            const showDateDivider = !prev || !isSameDay(prev.created_at, m.created_at)
            return (
              <div key={m.id}>
                {showDateDivider && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full px-3 py-1 text-[11px] font-medium text-slate-500 ring-1 bg-[var(--color-surface)] ring-[var(--color-surface-border)] dark:text-slate-300">
                      {formatDayLabel(m.created_at, t, language)}
                    </span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  isMine={isMine}
                  isFirstInGroup={isFirstInGroup}
                  imageUrl={m.image_path ? imageUrls[m.image_path] : undefined}
                  audioUrl={m.audio_path ? audioUrls[m.audio_path] : undefined}
                  onLongPress={() => setMenuTarget(m)}
                  onOpenImage={setViewerUrl}
                />
              </div>
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
            // Un único <form> para toda la barra: el botón de micrófono
            // tiene que seguir siendo EL MISMO elemento del DOM mientras
            // dura el gesto de pulsar-mantener (si React lo desmontara al
            // entrar en "recording", se perdería la captura del puntero a
            // mitad de gesto). Por eso "recording" solo cambia lo que hay a
            // su izquierda, nunca desmonta el formulario ni el botón.
            <form onSubmit={sendText} className="flex items-center gap-2">
              {recording ? (
                <div className="flex flex-1 items-center gap-2 rounded-full border px-4 py-2.5 border-[var(--color-surface-border)] bg-[var(--color-surface)]">
                  <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                  {slideCancelHint ? (
                    <span className="text-sm font-medium text-red-500">{t('chat.releaseToCancel')}</span>
                  ) : (
                    <>
                      <span className="text-sm text-slate-600 dark:text-slate-300">{t('chat.recording')}</span>
                      <span className="tabular-nums text-sm text-slate-500 dark:text-slate-400">
                        {formatDuration(recordingSeconds)}
                      </span>
                      <span className="ml-auto text-xs text-slate-400">{t('chat.slideToCancel')}</span>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setShowPhotoMenu(true)}
                    disabled={sending}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg text-slate-500 hover:bg-slate-200 disabled:opacity-50 bg-[var(--color-surface)] dark:text-slate-300 dark:hover:bg-slate-700"
                    aria-label={t('chat.attachPhoto')}
                  >
                    📷
                  </button>
                  {/* Dos inputs separados en vez de uno solo: dejar que el
                      propio navegador decida si ofrece cámara y galería
                      juntas (con o sin el atributo "capture") es poco
                      fiable — según el teléfono, a veces solo deja hacer
                      foto y a veces solo elegir de la galería. Con dos
                      botones explícitos, cada uno fuerza su propio modo. */}
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={onSelectImage}
                    className="hidden"
                  />
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    onChange={onSelectImage}
                    className="hidden"
                  />
                  <textarea
                    ref={composerRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={t('chat.placeholder')}
                    rows={1}
                    className="max-h-[120px] flex-1 resize-none overflow-y-auto rounded-2xl border px-4 py-2.5 text-base leading-normal focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface)] dark:text-slate-100"
                  />
                </>
              )}

              {!recording && text.trim() ? (
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
                  onPointerDown={handleMicPointerDown}
                  onPointerMove={handleMicPointerMove}
                  onPointerUp={handleMicPointerUp}
                  onPointerCancel={handleMicPointerUp}
                  disabled={sending && !recording}
                  className={`flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full text-white shadow ring-2 ring-white/40 transition-transform dark:shadow-black/40 dark:ring-white/15 disabled:opacity-50 ${
                    slideCancelHint ? 'bg-red-500' : 'bg-brand-600 hover:bg-brand-700'
                  } ${recording ? 'scale-110' : ''}`}
                  style={{ touchAction: 'none' }}
                  aria-label={recording ? t('chat.recording') : t('chat.attachAudio')}
                  title={recording ? t('chat.recording') : t('chat.attachAudio')}
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

      {showPhotoMenu && (
        <ContextMenu
          onClose={() => setShowPhotoMenu(false)}
          actions={[
            { label: t('chat.takePhoto'), icon: '📷', onSelect: () => cameraInputRef.current?.click() },
            { label: t('chat.choosePhoto'), icon: '🖼️', onSelect: () => galleryInputRef.current?.click() },
          ]}
        />
      )}

      {pendingImage && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center"
          onClick={cancelPendingImage}
        >
          <div
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-4 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={pendingImage.previewUrl}
              alt={t('chat.photoAlt')}
              className="mb-3 max-h-[55vh] w-full rounded-lg object-contain"
            />
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('chat.captionPlaceholder')}
              className="mb-3 w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={cancelPendingImage}
                disabled={sending}
                className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmSendImage}
                disabled={sending}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {sending ? t('common.saving') : t('chat.send')}
              </button>
            </div>
          </div>
        </div>
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

      {micErrorKind && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setMicErrorKind(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-t-2xl p-6 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {micErrorKind === 'notfound' ? t('chat.micNotFoundTitle') : t('chat.micDeniedTitle')}
            </h2>
            <p className="mb-4 text-sm text-slate-600 dark:text-slate-300">
              {micErrorKind === 'notfound'
                ? t('chat.micNotFoundBody')
                : micErrorKind === 'other'
                  ? t('chat.micError')
                  : t(micDeniedInstructionKey())}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setMicErrorKind(null)}
                className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {t('common.close')}
              </button>
              {micErrorKind === 'denied' && (
                <button
                  onClick={() => {
                    setMicErrorKind(null)
                    void startRecording()
                  }}
                  className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700"
                >
                  {t('chat.retry')}
                </button>
              )}
            </div>
          </div>
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
