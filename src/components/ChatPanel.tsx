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
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage, type TranslationKey } from '../lib/i18n'
import { useLongPress } from '../hooks/useLongPress'
import { compressImage } from '../lib/imageCompression'
import Avatar from './Avatar'
import UndoToast from './UndoToast'
import Toast from './Toast'
import ContextMenu from './ContextMenu'
import ForwardMessageModal from './ForwardMessageModal'
import {
  CameraIcon,
  CheckIcon,
  ChevronUpIcon,
  CloseIcon,
  CopyIcon,
  EditIcon,
  FileAttachmentIcon,
  ForwardIcon,
  GalleryIcon,
  LockIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  ReplyIcon,
  SendIcon,
  TrashIcon,
} from './icons'
import { colorForName } from '../lib/colors'
import type { Message } from '../lib/types'

const UNDO_DELAY_MS = 5000

function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(s / 60)
  const seconds = s % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

// "245 KB", "3.1 MB"... para mostrar el peso del archivo adjunto sin tener
// que descargarlo primero (el tamaño se guarda en la fila al subirlo, ver
// migration_v31.sql).
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Resumen corto de un mensaje para mostrarlo citado — encima del
// compositor mientras se responde, o dentro de la burbuja de quien
// respondió. Un mensaje sin texto es una foto, una nota de voz o un
// archivo adjunto.
function replyPreviewText(
  m: { content: string | null; image_path: string | null; audio_path: string | null; file_path?: string | null; file_name?: string | null },
  t: (key: TranslationKey) => string,
): string {
  if (m.content) return m.content
  if (m.image_path) return t('chat.replyPhoto')
  if (m.audio_path) return t('chat.replyAudio')
  if (m.file_path) return m.file_name ?? t('chat.replyFile')
  return ''
}

// Ventana durante la que se puede editar un mensaje propio, igual que
// WhatsApp — comprobada también en el servidor (migration_v30.sql), esto
// aquí es solo para no ofrecer "Editar" en el menú cuando ya no vale de
// nada intentarlo.
const EDIT_WINDOW_MS = 15 * 60 * 1000

function canEditMessage(m: Message, userId?: string): boolean {
  if (!userId || m.sender_id !== userId) return false
  // Solo mensajes de puro texto: una foto, nota de voz o archivo ya
  // enviado no se puede sustituir por otra cosa.
  if (!m.content || m.image_path || m.audio_path || m.file_path) return false
  return Date.now() - new Date(m.created_at).getTime() < EDIT_WINDOW_MS
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
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  // Foto elegida (de cámara o galería) pendiente de confirmar: se muestra
  // en una hoja con vista previa y un texto opcional antes de subirla y
  // mandarla de verdad — antes se enviaba sola en cuanto se elegía el
  // archivo, sin poder revisarla ni añadir nada.
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null)
  // Mismo patrón para un documento (PDF, Word…) elegido para adjuntar —
  // aquí no hay vista previa visual, solo el icono, el nombre y el peso.
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const [recording, setRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [slideCancelHint, setSlideCancelHint] = useState(false)
  // Grabación "bloqueada" (deslizando el dedo hacia arriba, como WhatsApp):
  // deja de hacer falta mantener pulsado el botón — la grabación sigue sola
  // hasta que se pulse "detener y enviar" o "descartar".
  const [locked, setLocked] = useState(false)
  // Cuánto se ha deslizado el dedo hacia arriba todavía (0 = reposo,
  // -LOCK_THRESHOLD_PX = a punto de bloquear) — mueve de verdad el botón
  // dentro del "carril" mientras se arrastra, en vez de que el bloqueo
  // ocurra de golpe sin ningún aviso visual previo.
  const [dragY, setDragY] = useState(0)
  // Dedo apoyado en el botón del micro AHORA MISMO (desde el pointerdown
  // hasta soltar o cancelar) — a propósito NO es lo mismo que "recording":
  // ese tarda un rato más en confirmarse de verdad (ver comentario en
  // handleMicPointerMove) y, si la cápsula/candado dependieran de él en vez
  // de esto, tardarían ese mismo rato en aparecer tras apoyar el dedo.
  const [pressActive, setPressActive] = useState(false)
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
  const recordingStartYRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)
  const pendingReleaseRef = useRef<'send' | 'cancel' | null>(null)

  const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string>>(new Set())
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [lastPendingId, setLastPendingId] = useState<string | null>(null)
  const [menuTarget, setMenuTarget] = useState<Message | null>(null)
  // Mensaje al que se está respondiendo (se citará en el próximo mensaje
  // que se mande, sea texto, foto o nota de voz) — ver migration_v28.sql.
  const [replyTarget, setReplyTarget] = useState<Message | null>(null)
  // Mensaje propio que se está editando ahora mismo (ver migration_v30.sql)
  // — mutuamente excluyente con "responder": empezar a editar cancela
  // cualquier respuesta pendiente y viceversa, para no mezclar las dos
  // barras encima del compositor.
  const [editTarget, setEditTarget] = useState<Message | null>(null)
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

  const filePaths = useMemo(
    () => visibleMessages.filter((m) => m.file_path).map((m) => m.file_path as string),
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

  // Mismo patrón de reintento, contra el bucket "chat-files" (ver
  // migration_v31.sql) para los documentos adjuntos.
  useEffect(() => {
    const missing = filePaths.filter((p) => !fileUrls[p])
    if (missing.length === 0) return
    let cancelled = false

    const attempt = (retriesLeft: number) => {
      supabase.storage
        .from('chat-files')
        .createSignedUrls(missing, 3600)
        .then(({ data }) => {
          if (cancelled) return
          if (data) {
            setFileUrls((prev) => {
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
  }, [filePaths])

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
  }, [imageUrls, audioUrls, fileUrls, conversationKey])

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
    const { error: err } = await supabase.from('messages').insert({
      ...insertPayload(target),
      sender_id: user.id,
      content: text.trim(),
      reply_to_message_id: replyTarget?.id ?? null,
    })
    setSending(false)
    if (err) {
      setError(err.code === '42501' ? t('chat.blockedError') : err.message)
      return
    }
    setText('')
    setReplyTarget(null)
  }

  // Empezar a responder o a editar cancela lo otro, para que nunca se vean
  // las dos barras a la vez encima del compositor.
  const startReply = (m: Message) => {
    setReplyTarget(m)
    setEditTarget(null)
  }

  const startEdit = (m: Message) => {
    setEditTarget(m)
    setReplyTarget(null)
    setText(m.content ?? '')
    // El foco tiene que pedirse en el siguiente frame: el <textarea> del
    // compositor es el mismo elemento de siempre (no se desmonta al
    // entrar en modo edición), pero justo al pulsar "Editar" el foco
    // todavía está en el menú contextual que se acaba de cerrar.
    requestAnimationFrame(() => composerRef.current?.focus())
  }

  const cancelEdit = () => {
    setEditTarget(null)
    setText('')
  }

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editTarget || !text.trim() || !user) return
    setSending(true)
    setError(null)
    const { error: err } = await supabase
      .from('messages')
      .update({ content: text.trim(), edited_at: new Date().toISOString() })
      .eq('id', editTarget.id)
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    setText('')
    setEditTarget(null)
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

    const file = await compressImage(pendingImage.file)
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

    const { error: insertErr } = await supabase.from('messages').insert({
      ...insertPayload(target),
      sender_id: user.id,
      image_path: path,
      content: text.trim() || null,
      reply_to_message_id: replyTarget?.id ?? null,
    })

    setSending(false)
    URL.revokeObjectURL(pendingImage.previewUrl)
    setPendingImage(null)
    resetImageInputs()
    if (insertErr) {
      setError(insertErr.code === '42501' ? t('chat.blockedError') : insertErr.message)
      return
    }
    setText('')
    setReplyTarget(null)
  }

  // Elegir un documento (PDF, Word…) tampoco lo manda solo: igual que la
  // foto, se guarda como "pendiente" y se confirma en una hoja aparte
  // (aquí sin vista previa visual — solo icono, nombre y peso) antes de
  // subirlo de verdad.
  const onSelectFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPendingFile(file)
  }

  const resetFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const cancelPendingFile = () => {
    if (sending) return
    setPendingFile(null)
    resetFileInput()
  }

  const confirmSendFile = async () => {
    if (!pendingFile || !user) return
    setError(null)
    setSending(true)

    const file = pendingFile
    const ext = file.name.split('.').pop() || 'bin'
    const path = `${imagePathPrefix(target, user.id)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('chat-files')
      .upload(path, file, { contentType: file.type || 'application/octet-stream' })

    if (uploadErr) {
      setError(t('chat.errorUploadFile', { message: uploadErr.message }))
      setSending(false)
      return
    }

    const { error: insertErr } = await supabase.from('messages').insert({
      ...insertPayload(target),
      sender_id: user.id,
      file_path: path,
      file_name: file.name,
      file_mime_type: file.type || null,
      file_size_bytes: file.size,
      content: text.trim() || null,
      reply_to_message_id: replyTarget?.id ?? null,
    })

    setSending(false)
    setPendingFile(null)
    resetFileInput()
    if (insertErr) {
      setError(insertErr.code === '42501' ? t('chat.blockedError') : insertErr.message)
      return
    }
    setText('')
    setReplyTarget(null)
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
      reply_to_message_id: replyTarget?.id ?? null,
    })

    setSending(false)
    if (insertErr) {
      setError(insertErr.code === '42501' ? t('chat.blockedError') : insertErr.message)
      return
    }
    setReplyTarget(null)
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
      setLocked(false)
      setDragY(0)

      const chunks = audioChunksRef.current
      audioChunksRef.current = []
      if (!send) return
      // Si se soltó (o se pulsó "detener y enviar") casi al instante —
      // típicamente cuando el permiso del micrófono tardó en concederse y
      // ya se había soltado el dedo antes de que arrancara de verdad (ver
      // "pendingReleaseRef" en startRecording) — el grabador llega a
      // parar sin haber capturado sonido real. El contenedor de audio
      // (webm/ogg) igualmente ocupa algunos bytes de cabecera aunque no
      // haya nada grabado, así que blob.size==0 no basta para detectarlo:
      // se descarta en silencio (nada de mensaje "roto" que no se puede
      // escuchar) si duró menos de 1 segundo o el archivo es demasiado
      // pequeño para tener audio de verdad.
      // Subido de 1 a 2 segundos: en pruebas reales, las grabaciones que se
      // quedaban justo en "1 segundo" (según este contador, que solo mide
      // segundos completos desde que arrancó de verdad el micrófono)
      // resultaron ser siempre audio roto — sin sonido real, y encima el
      // propio reproductor era incapaz de calcularles la duración (se veía
      // "0:00 / 0:00" aunque la burbuja dijera "0:01"). Una nota de voz de
      // verdad rara vez dura menos de 2 segundos, así que este umbral no
      // debería notarse en el uso normal.
      const MIN_RECORDING_SECONDS = 2
      const MIN_RECORDING_BYTES = 2000
      if (durationSeconds < MIN_RECORDING_SECONDS) return
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
      if (blob.size < MIN_RECORDING_BYTES) return
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
  // Se pone a "true" en cuanto se apoya el dedo y a "false" en cuanto se
  // suelta/cancela DE VERDAD (ver releaseMicGesture) — a diferencia de
  // "pressActive" (estado de React, para pintar), esto es una ref que se
  // puede leer sin arrastrar cierres obsoletos desde el listener global de
  // más abajo, y sirve para que releaseMicGesture no haga nada dos veces si
  // se llega a llamar desde dos sitios para el mismo gesto (ver más abajo).
  const gestureActiveRef = useRef(false)

  const handleMicPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (sending || recording) return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // algún navegador raro sin soporte de pointer capture: seguimos sin
      // eso, simplemente no habrá gesto de deslizar para cancelar.
    }
    gestureActiveRef.current = true
    recordingStartXRef.current = e.clientX
    recordingStartYRef.current = e.clientY
    cancelledRef.current = false
    pendingReleaseRef.current = null
    setSlideCancelHint(false)
    setLocked(false)
    setDragY(0)
    setPressActive(true)
    // No arrancamos a grabar al instante: esperamos un poco a ver si de
    // verdad es un "mantener pulsado" y no un toque suelto.
    micHoldTimerRef.current = setTimeout(() => {
      micHoldTimerRef.current = null
      void startRecording()
    }, MIC_HOLD_THRESHOLD_MS)
  }

  // El botón de grabar vive DENTRO de una única "cápsula" (no es un botón
  // suelto con un carril flotando aparte por encima, con un hueco entre
  // medias — así era antes, y no llegaba a sentirse como que el botón de
  // verdad "subía hasta el candado"). Al empezar a grabar, la cápsula crece
  // hacia arriba (CAPSULE_HEIGHT_PX) y el botón, que nace pegado a su base,
  // se desliza hacia arriba POR DENTRO de ella (LOCK_THRESHOLD_PX de
  // recorrido real) hasta cubrir el candado que aparece fijo arriba del
  // todo. Solo se bloquea si de verdad se llega hasta ahí arriba — nada de
  // umbrales cortos que bloqueen con un roce. 112px son 3/4 del recorrido
  // que había antes (150px) — quedó un pelín largo.
  const CAPSULE_HEIGHT_PX = 162
  const LOCK_THRESHOLD_PX = 112
  const LOCK_CHEVRON_COUNT = 4

  const handleMicPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    // Antes este "if" también exigía "recording" (el estado ya confirmado
    // de que el MediaRecorder arrancó). El problema: entre el pointerdown y
    // ese momento pasan, como mínimo, los MIC_HOLD_THRESHOLD_MS de "esto va
    // en serio" MÁS lo que tarde el navegador en resolver getUserMedia (ver
    // startRecording) — y durante todo ese rato, con "recording" aún en
    // false, este manejador se cortaba aquí mismo y NO llegaba a leer la
    // posición del dedo ni una sola vez. Si la persona deslizaba rápido y
    // seguido (lo normal al "mantener e ir deslizando" de un tirón), para
    // cuando por fin llegaba el primer evento que sí se procesaba, el dedo
    // ya podía estar muy arriba — y ese primer cálculo, de golpe, ya salía
    // por encima del umbral: se bloqueaba "de repente", sin sensación de
    // recorrido. Ahora se sigue el dedo desde el primer pointerdown (los
    // refs ya están puestos, aunque "recording" tarde un poco más en
    // confirmarse), así que no se pierde ningún tramo del gesto.
    if (locked || recordingStartXRef.current == null || recordingStartYRef.current == null) return
    const dx = e.clientX - recordingStartXRef.current
    const dy = e.clientY - recordingStartYRef.current
    if (dy < -LOCK_THRESHOLD_PX) {
      setLocked(true)
      setDragY(0)
      cancelledRef.current = false
      setSlideCancelHint(false)
      // Vibración corta al llegar al candado: confirma sin tener que mirar
      // la pantalla que la grabación ya quedó bloqueada (sigue sola,
      // aunque se suelte el dedo) — mismo patrón que el aviso de "armado"
      // al deslizar un mensaje para responder (más abajo en este archivo).
      if (navigator.vibrate) navigator.vibrate(20)
      return
    }
    // El botón sigue al dedo de verdad mientras se arrastra hacia arriba
    // (nunca hacia abajo del reposo) — así se nota que falta poco para
    // bloquear, en vez de que pase de golpe al llegar al umbral.
    setDragY(Math.max(-LOCK_THRESHOLD_PX, Math.min(0, dy)))
    const shouldCancel = dx < -CANCEL_THRESHOLD_PX
    cancelledRef.current = shouldCancel
    setSlideCancelHint(shouldCancel)
  }

  // Toda la limpieza de "se soltó/canceló el gesto" en un solo sitio,
  // llamable tanto desde el propio botón como desde el respaldo global de
  // más abajo (ver el useEffect de "pointerup"/"pointercancel" en window).
  // Por qué hace falta ese respaldo: en un móvil real el gesto puede
  // interrumpirse sin que el botón llegue a recibir su propio evento de
  // soltar — una notificación entrante, un gesto del sistema, o (visto en
  // una captura real) que llegue un mensaje nuevo mientras tanto y el
  // navegador, en algún punto, deje de entregarle eventos a ESE botón en
  // concreto. Sin este respaldo, "pressActive" se quedaba en true para
  // siempre: la cápsula (candado + flechas) se veía "congelada" en pantalla
  // encima de mensajes posteriores, sin ninguna forma de que desapareciera
  // sola. gestureActiveRef hace que esto no se ejecute dos veces si al final
  // SÍ llegan ambos avisos (el del botón y el global) para el mismo gesto.
  const releaseMicGesture = () => {
    if (!gestureActiveRef.current) return
    gestureActiveRef.current = false
    // El dedo ya no está apoyado en ningún caso a partir de aquí — incluso
    // si queda bloqueada, la cápsula/candado (que dependen de esto y no de
    // "locked") tienen que desaparecer ya, y la propia condición "!locked"
    // de más abajo se encarga de que la barra de controles bloqueados no
    // parpadee de más.
    setPressActive(false)
    if (micHoldTimerRef.current) {
      // Se ha soltado antes de que se cumpliera el umbral: el micrófono no
      // ha llegado a arrancar (ni se ha pedido permiso), así que un toque
      // suelto no hace absolutamente nada.
      clearTimeout(micHoldTimerRef.current)
      micHoldTimerRef.current = null
      recordingStartXRef.current = null
      recordingStartYRef.current = null
      cancelledRef.current = false
      setSlideCancelHint(false)
      return
    }
    recordingStartXRef.current = null
    recordingStartYRef.current = null
    if (locked) {
      // Grabación bloqueada: soltar el dedo no la corta, sigue grabando
      // sola — se corta con los botones de "descartar" / "detener y enviar".
      return
    }
    const shouldSend = !cancelledRef.current
    setSlideCancelHint(false)
    if (recording) {
      stopRecording(shouldSend)
    } else {
      // El micrófono todavía no ha terminado de arrancar (primer permiso):
      // en cuanto lo haga, se cierra solo con esta misma decisión.
      pendingReleaseRef.current = shouldSend ? 'send' : 'cancel'
    }
  }

  const handleMicPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // nada que liberar si no se llegó a capturar.
    }
    releaseMicGesture()
  }

  // Respaldo global: si por lo que sea el propio botón nunca llega a recibir
  // su "pointerup"/"pointercancel" (ver el porqué en releaseMicGesture),
  // esto lo pilla igualmente — el navegador siempre entrega el evento a
  // "window" al soltar el dedo, aunque el elemento original ya no lo reciba.
  useEffect(() => {
    if (!pressActive) return
    window.addEventListener('pointerup', releaseMicGesture)
    window.addEventListener('pointercancel', releaseMicGesture)
    return () => {
      window.removeEventListener('pointerup', releaseMicGesture)
      window.removeEventListener('pointercancel', releaseMicGesture)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressActive])

  const requestDeleteMessage = (messageId: string) => {
    setPendingDeleteIds((prev) => new Set(prev).add(messageId))
    setLastPendingId(messageId)
    const timer = setTimeout(async () => {
      timersRef.current.delete(messageId)
      const { error: err } = await supabase.from('messages').delete().eq('id', messageId)
      if (err) setError(t('common.deleteError'))
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
          <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">{t('chat.empty')}</p>
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
                    <span className="glass-panel rounded-full px-3 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                      {formatDayLabel(m.created_at, t, language)}
                    </span>
                  </div>
                )}
                <MessageBubble
                  message={m}
                  isMine={isMine}
                  isFirstInGroup={isFirstInGroup}
                  currentUserId={user?.id}
                  imageUrl={m.image_path ? imageUrls[m.image_path] : undefined}
                  audioUrl={m.audio_path ? audioUrls[m.audio_path] : undefined}
                  fileUrl={m.file_path ? fileUrls[m.file_path] : undefined}
                  onLongPress={() => setMenuTarget(m)}
                  onOpenImage={setViewerUrl}
                  onSwipeReply={readOnly ? undefined : startReply}
                />
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Esta barra cambia de alto cada vez que aparece o desaparece la
          franja de "respondiendo a" / "editando" de arriba (y el propio
          <textarea> también cambia de alto al escribir). "glass-panel"
          lleva backdrop-filter (desenfoque), y un desenfoque en un
          elemento "fixed" que además cambia de tamaño obliga al navegador
          a recomponerlo entero en cada cambio — en Android eso es una
          causa conocida de parpadeos/roturas de pintado, más notorios
          cuanto más "pesado" es lo que hay reflowing a la vez (como una
          burbuja de foto volviendo a su sitio tras deslizarla para
          responder). Fondo sólido en vez de cristal aquí: nada que
          recomponer. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-surface-border)] bg-[var(--color-surface)]">
        <div className="mx-auto max-w-2xl px-4 py-3">
          {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}
          {!readOnly && replyTarget && !editTarget && (
            // Antes esta franja llevaba la clase "glass-panel" (fondo
            // translúcido + desenfoque de cristal) igual que la barra
            // entera del compositor en la que va metida — es decir, un
            // cristal DENTRO de otro cristal, ambos con su propio
            // backdrop-filter. Esa combinación es una causa conocida de
            // fallos de renderizado en Android (el navegador no compone
            // bien dos desenfoques anidados en un elemento "fixed" que
            // además cambia de contenido), y encaja con lo reportado: la
            // franja se quedaba sin fondo, sin borde y sin el botón de
            // cerrar visibles al responder a una foto. Con un fondo sólido
            // (sin desenfoque) en vez de cristal, no hay nada que anidar.
            <div className="mb-2 flex items-start gap-2 rounded-xl border border-[var(--color-surface-border)] !border-l-4 !border-l-[var(--color-brand-500)] bg-[var(--color-surface)] py-1.5 pl-2.5 pr-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-brand-600 dark:text-brand-400">
                  {replyTarget.sender_id === user?.id ? t('chat.you') : replyTarget.sender?.username || '—'}
                </p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{replyPreviewText(replyTarget, t)}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTarget(null)}
                aria-label={t('common.close')}
                className="shrink-0 text-slate-500 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          )}
          {!readOnly && editTarget && (
            // Mismo motivo que en la franja de "respondiendo a" de arriba:
            // fondo sólido en vez de "glass-panel" para no anidar dos
            // desenfoques.
            <div className="mb-2 flex items-start gap-2 rounded-xl border border-[var(--color-surface-border)] !border-l-4 !border-l-[var(--color-brand-500)] bg-[var(--color-surface)] py-1.5 pl-2.5 pr-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-brand-600 dark:text-brand-400">{t('chat.editingMessage')}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{editTarget.content}</p>
              </div>
              <button
                type="button"
                onClick={cancelEdit}
                aria-label={t('common.close')}
                className="shrink-0 text-slate-500 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
          )}
          {readOnly ? (
            <p className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              <LockIcon className="h-3.5 w-3.5 shrink-0" />
              {t('chat.readOnlyHint')}
            </p>
          ) : (
            // Un único <form> para toda la barra: el botón de micrófono
            // tiene que seguir siendo EL MISMO elemento del DOM mientras
            // dura el gesto de pulsar-mantener (si React lo desmontara al
            // entrar en "recording", se perdería la captura del puntero a
            // mitad de gesto). Por eso "recording" solo cambia lo que hay a
            // su izquierda, nunca desmonta el formulario ni el botón.
            <form onSubmit={editTarget ? saveEdit : sendText} className="flex items-center gap-2">
              {recording ? (
                <div className="glass-panel flex flex-1 items-center gap-2 rounded-full px-4 py-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                  {slideCancelHint ? (
                    <span className="text-sm font-medium text-red-500">{t('chat.releaseToCancel')}</span>
                  ) : (
                    <>
                      <span className="text-sm text-slate-600 dark:text-slate-300">{t('chat.recording')}</span>
                      <span className="tabular-nums text-sm text-slate-500 dark:text-slate-400">
                        {formatDuration(recordingSeconds)}
                      </span>
                      {!locked && (
                        <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                          {t('chat.slideToCancel')} · {t('chat.slideToLock')}
                        </span>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <>
                  {/* No se puede convertir un mensaje editado en una foto —
                      mientras se edita, el botón de cámara desaparece. */}
                  {!editTarget && (
                    <button
                      type="button"
                      onClick={() => setShowPhotoMenu(true)}
                      disabled={sending}
                      className="glass-panel flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 disabled:opacity-50 dark:text-slate-300"
                      aria-label={t('chat.attachMenu')}
                    >
                      <CameraIcon className="h-5 w-5" />
                    </button>
                  )}
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
                  {/* Documentos (PDF, Word) — mismo patrón que las fotos: un
                      input oculto que abre el propio selector de archivos
                      del sistema, ofrecido desde el mismo menú del botón
                      de adjuntar. */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    onChange={onSelectFile}
                    className="hidden"
                  />
                  <textarea
                    ref={composerRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder={t('chat.placeholder')}
                    aria-label={t('chat.placeholder')}
                    rows={1}
                    // Fondo translúcido con el mismo color que ".glass-panel"
                    // pero SIN backdrop-filter: ese desenfoque, aplicado a un
                    // <textarea> que cambia de alto en cada pulsación (ver
                    // el efecto de arriba), por un lado obligaba al navegador
                    // a recalcular el desenfoque en cada tecla (de ahí parte
                    // de la lentitud que se notaba al escribir) y por otro
                    // dejaba un filo visible justo en el borde del propio
                    // recuadro contra fondos oscuros. Esa parte ya se quitó,
                    // pero seguía viéndose una rayita gris vertical junto al
                    // micrófono — esa es la barra de scroll del propio
                    // <textarea> (overflow-y-auto): en Android se reserva su
                    // hueco aunque no haya nada que desplazar todavía. Con
                    // "no-scrollbar" (ver index.css) se oculta esa barra sin
                    // quitarle la función de scroll cuando el texto sí crece.
                    className="no-scrollbar border border-transparent bg-[var(--color-glass)] max-h-[120px] flex-1 resize-none overflow-y-auto rounded-2xl px-4 py-2.5 text-base leading-normal focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:text-slate-100"
                  />
                </>
              )}

              {/* Grabación bloqueada: botón para descartarla sin enviar nada
                  (aparece a la izquierda del botón de enviar/detener). Mira
                  solo "locked" (no "recording && locked"): al bloquear muy
                  rápido, "recording" puede tardar un pelín más en
                  confirmarse (getUserMedia es asíncrono) y con la condición
                  vieja esta barra tardaba ese mismo pelín en aparecer. */}
              {locked && (
                <button
                  type="button"
                  onClick={() => stopRecording(false)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-red-500 dark:text-slate-300"
                  aria-label={t('chat.cancelRecording')}
                  title={t('chat.cancelRecording')}
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
              )}

              {!recording && editTarget ? (
                <button
                  type="submit"
                  disabled={sending || !text.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_10px_20px_-10px_var(--color-glow)] disabled:opacity-50"
                  aria-label={t('chat.saveEdit')}
                  title={t('chat.saveEdit')}
                >
                  <CheckIcon className="h-4 w-4" />
                </button>
              ) : !recording && text.trim() ? (
                <button
                  type="submit"
                  disabled={sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_10px_20px_-10px_var(--color-glow)] disabled:opacity-50"
                  aria-label={t('chat.send')}
                >
                  <SendIcon className="h-4 w-4" />
                </button>
              ) : locked ? (
                // Grabación bloqueada: este botón sustituye al micrófono
                // (el gesto de mantener pulsado ya terminó al soltar el
                // dedo tras deslizar hacia arriba) — un toque normal detiene
                // la grabación y la manda, como el botón de enviar de texto.
                <button
                  type="button"
                  onClick={() => stopRecording(true)}
                  disabled={sending}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_10px_20px_-10px_var(--color-glow)] disabled:opacity-50"
                  aria-label={t('chat.stopAndSendRecording')}
                  title={t('chat.stopAndSendRecording')}
                >
                  <SendIcon className="h-4 w-4" />
                </button>
              ) : (
                // Envoltorio con el mismo hueco de siempre en la fila (40x10):
                // la cápsula de abajo crece hacia ARRIBA sobre esto (absolute,
                // anclada por bottom-0), así que no empuja ni agranda la
                // barra de escritura — solo "flota" por encima, igual que
                // hacía antes el carril suelto.
                <div className="relative h-10 w-11 shrink-0">
                  <div
                    className={`absolute inset-x-0 bottom-0 flex flex-col items-center justify-end rounded-full transition-[height] duration-150 ${
                      pressActive && !locked ? 'bg-[var(--color-glass)] pb-[3px] shadow-inner' : ''
                    }`}
                    style={{ height: pressActive && !locked ? CAPSULE_HEIGHT_PX : 40 }}
                  >
                    {/* El micrófono y el candado viven DENTRO de la misma
                        cápsula — no un botón suelto con un carril flotando
                        aparte por encima con un hueco entre medias (así era
                        antes, y nunca se sentía como que el botón de verdad
                        "llegaba" al candado). El botón nace pegado a la base
                        y sube por dentro de ella de verdad (ver
                        LOCK_THRESHOLD_PX más arriba). Las flechas se van
                        encendiendo una a una según se acerca, y el candado
                        se colorea al pasar del 60% del recorrido — ninguna
                        de las dos cosas decide el bloqueo, solo lo anuncian;
                        el bloqueo real sigue siendo el umbral en
                        handleMicPointerMove. */}
                    {pressActive && !locked && (
                      <div className="pointer-events-none absolute inset-x-0 top-3 flex flex-col items-center gap-1.5">
                        <div
                          className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border bg-[var(--color-surface)] shadow-sm transition-colors ${
                            dragY <= -LOCK_THRESHOLD_PX * 0.6
                              ? 'border-brand-300 text-brand-500 dark:border-brand-700'
                              : 'border-[var(--color-surface-border)] text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          <LockIcon className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex flex-col-reverse gap-1.5">
                          {Array.from({ length: LOCK_CHEVRON_COUNT }).map((_, i) => {
                            const lit = Math.round((dragY / -LOCK_THRESHOLD_PX) * LOCK_CHEVRON_COUNT) > i
                            return (
                              <ChevronUpIcon
                                key={i}
                                className={`h-2 w-3.5 text-brand-500 transition-all ${lit ? 'opacity-100 -translate-y-0.5' : 'opacity-25'}`}
                              />
                            )
                          })}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      onPointerDown={handleMicPointerDown}
                      onPointerMove={handleMicPointerMove}
                      onPointerUp={handleMicPointerUp}
                      onPointerCancel={handleMicPointerUp}
                      disabled={sending && !recording}
                      className={`relative z-[1] flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-full text-white shadow-[0_10px_20px_-10px_var(--color-glow)] transition-transform disabled:opacity-50 ${
                        slideCancelHint ? 'bg-red-500' : 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)]'
                      }`}
                      style={{
                        touchAction: 'none',
                        transform: pressActive ? `translateY(${dragY}px) scale(1.1)` : undefined,
                      }}
                      aria-label={recording ? t('chat.recording') : t('chat.attachAudio')}
                      title={recording ? t('chat.recording') : t('chat.attachAudio')}
                    >
                      <MicIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>
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
            ...(!readOnly
              ? [{ label: t('chat.reply'), icon: <ReplyIcon className="h-5 w-5" />, onSelect: () => startReply(menuTarget) }]
              : []),
            ...(!readOnly && canEditMessage(menuTarget, user?.id)
              ? [{ label: t('chat.edit'), icon: <EditIcon className="h-5 w-5" />, onSelect: () => startEdit(menuTarget) }]
              : []),
            ...(menuTarget.content
              ? [{ label: t('menu.copy'), icon: <CopyIcon className="h-5 w-5" />, onSelect: () => copyMessage(menuTarget) }]
              : []),
            { label: t('menu.forward'), icon: <ForwardIcon className="h-5 w-5" />, onSelect: () => setForwardTarget(menuTarget) },
            ...(menuTarget.sender_id === user?.id
              ? [
                  {
                    label: t('chat.deleteForEveryone'),
                    icon: <TrashIcon className="h-5 w-5" />,
                    danger: true,
                    onSelect: () => requestDeleteMessage(menuTarget.id),
                  },
                ]
              : []),
          ]}
        />
      )}

      {showPhotoMenu && (
        <ContextMenu
          onClose={() => setShowPhotoMenu(false)}
          actions={[
            { label: t('chat.takePhoto'), icon: <CameraIcon className="h-5 w-5" />, onSelect: () => cameraInputRef.current?.click() },
            { label: t('chat.choosePhoto'), icon: <GalleryIcon className="h-5 w-5" />, onSelect: () => galleryInputRef.current?.click() },
            { label: t('chat.chooseFile'), icon: <FileAttachmentIcon className="h-5 w-5" />, onSelect: () => fileInputRef.current?.click() },
          ]}
        />
      )}

      {pendingImage && createPortal(
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
              aria-label={t('chat.captionPlaceholder')}
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
        </div>,
        document.body,
      )}

      {pendingFile && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center"
          onClick={cancelPendingFile}
        >
          <div
            className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-4 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-3 rounded-xl border px-3 py-2.5 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)]">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-glass)] text-[var(--color-brand-600)]">
                <FileAttachmentIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{pendingFile.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{formatFileSize(pendingFile.size)}</p>
              </div>
            </div>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('chat.captionPlaceholder')}
              aria-label={t('chat.captionPlaceholder')}
              className="mb-3 w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
            {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={cancelPendingFile}
                disabled={sending}
                className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmSendFile}
                disabled={sending}
                className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {sending ? t('common.saving') : t('chat.send')}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {forwardTarget && (
        <ForwardMessageModal
          message={forwardTarget}
          currentTarget={target}
          onClose={() => setForwardTarget(null)}
          onForwarded={() => setForwardTarget(null)}
        />
      )}

      {viewerUrl && createPortal(
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setViewerUrl(null)}
        >
          <button
            onClick={() => setViewerUrl(null)}
            aria-label={t('chat.closeViewer')}
            title={t('chat.closeViewer')}
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img
            src={viewerUrl}
            alt={t('chat.photoExpanded')}
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body,
      )}

      {micErrorKind && createPortal(
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
        </div>,
        document.body,
      )}
    </div>
  )
}

// Deslizar una burbuja hacia la derecha para responder a ese mensaje, como
// en WhatsApp — cuanto más se desliza, más se ve el icono de "responder"
// asomando a la izquierda, hasta que pasa el umbral y queda "armado": al
// soltar ahí, se activa esa respuesta. Si se suelta antes del umbral, la
// burbuja vuelve sola a su sitio sin hacer nada.
const SWIPE_REPLY_MAX_PX = 64
const SWIPE_REPLY_THRESHOLD_PX = 44

// Solo puede sonar una nota de voz a la vez en toda la conversación (como
// en cualquier chat de verdad) — variable de módulo a propósito, no de
// estado de React: si se reproduce una y luego se abre otra burbuja, la
// anterior se para sola sin tener que pasar esto por props entre
// componentes que no tienen relación entre sí.
let currentlyPlayingAudio: HTMLAudioElement | null = null

function hashSeed(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = (hash << 5) - hash + str.charCodeAt(i)
  return Math.abs(hash)
}

// La forma de onda que se ve NO es la del audio de verdad (habría que
// decodificarlo entero con Web Audio API para sacar los picos reales, y no
// merece la pena solo para dibujarla) — es un dibujo con aspecto de onda,
// pero siempre EL MISMO para el mismo audio (a partir de su propia ruta:
// dos personas mirando el mismo mensaje ven exactamente las mismas
// barras, y no cambia cada vez que se vuelve a pintar).
function waveformBars(seed: string, count = 24): number[] {
  let s = hashSeed(seed) || 1
  const next = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  const bars: number[] = []
  let phase = next() * Math.PI * 2
  for (let i = 0; i < count; i++) {
    phase += 0.7 + next() * 0.6
    const wobble = (Math.sin(phase) + 1) / 2
    bars.push(Math.min(100, 22 + wobble * 68 + next() * 10))
  }
  return bars
}

// Reproductor de nota de voz a medida — sustituye al <audio controls>
// nativo del navegador (feo y, sobre todo, poco fiable: un audio grabado
// con MediaRecorder no lleva su duración total escrita en la cabecera del
// archivo, así que Chrome a veces es incapaz de calcularla y se queda
// mostrando "0:00 / 0:00" aunque el audio sí tenga sonido de verdad). Aquí
// la duración TOTAL nunca se lee del archivo — se usa siempre la que se
// guardó al grabar (audio_duration_seconds, ver sendAudioBlob) — y del
// elemento <audio> solo se lee lo que sí funciona bien siempre: la
// posición actual mientras suena.
function VoiceMessagePlayer({
  src,
  seed,
  totalSeconds,
  isMine,
}: {
  src: string
  seed: string
  totalSeconds: number
  isMine: boolean
}) {
  const { t } = useLanguage()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentSeconds, setCurrentSeconds] = useState(0)
  const bars = useMemo(() => waveformBars(seed), [seed])
  const progress = totalSeconds > 0 ? Math.min(1, currentSeconds / totalSeconds) : 0

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTimeUpdate = () => setCurrentSeconds(audio.currentTime)
    const onEnded = () => {
      setPlaying(false)
      setCurrentSeconds(0)
    }
    const onPause = () => setPlaying(false)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('pause', onPause)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('pause', onPause)
      if (currentlyPlayingAudio === audio) currentlyPlayingAudio = null
    }
  }, [])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      return
    }
    if (currentlyPlayingAudio && currentlyPlayingAudio !== audio) currentlyPlayingAudio.pause()
    currentlyPlayingAudio = audio
    void audio.play()
    setPlaying(true)
  }

  const barBaseClass = isMine ? 'bg-white/30' : 'bg-black/10 dark:bg-white/15'
  const barFillClass = isMine ? 'bg-white' : 'bg-[var(--color-brand-500)]'

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isMine ? 'bg-white/20 text-white' : 'bg-[var(--color-glass)] text-[var(--color-brand-600)]'
        }`}
        aria-label={playing ? t('chat.pauseAudio') : t('chat.playAudio')}
      >
        {playing ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="ml-0.5 h-3.5 w-3.5" />}
      </button>
      <div className="relative h-6 w-32 shrink-0">
        <div className="absolute inset-0 flex items-center gap-[2px]">
          {bars.map((h, i) => (
            <span key={i} className={`min-w-[2px] flex-1 rounded-full ${barBaseClass}`} style={{ height: `${h}%` }} />
          ))}
        </div>
        <div
          className="absolute inset-0 flex items-center gap-[2px]"
          style={{ clipPath: `inset(0 ${(100 - progress * 100).toFixed(2)}% 0 0)` }}
        >
          {bars.map((h, i) => (
            <span key={i} className={`min-w-[2px] flex-1 rounded-full ${barFillClass}`} style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
      <span className={`shrink-0 text-xs tabular-nums ${isMine ? 'text-white/80' : 'text-slate-500 dark:text-slate-400'}`}>
        {formatDuration(playing || currentSeconds > 0 ? currentSeconds : totalSeconds)}
      </span>
    </div>
  )
}

function MessageBubble({
  message: m,
  isMine,
  isFirstInGroup,
  currentUserId,
  imageUrl,
  audioUrl,
  fileUrl,
  onLongPress,
  onOpenImage,
  onSwipeReply,
}: {
  message: Message
  isMine: boolean
  isFirstInGroup: boolean
  currentUserId?: string
  imageUrl?: string
  audioUrl?: string
  fileUrl?: string
  onLongPress: () => void
  onOpenImage: (url: string) => void
  // undefined cuando el chat es de solo lectura (lista completada): sin
  // esta prop, el gesto de deslizar queda desactivado del todo.
  onSwipeReply?: (message: Message) => void
}) {
  const { t, language } = useLanguage()
  const longPress = useLongPress(onLongPress)

  const [dragX, setDragX] = useState(0)
  const [armed, setArmed] = useState(false)
  const dragStartXRef = useRef<number | null>(null)
  const draggingRef = useRef(false)

  const handleSwipePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onSwipeReply) return
    dragStartXRef.current = e.clientX
    draggingRef.current = false
  }

  const handleSwipePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onSwipeReply || dragStartXRef.current == null) return
    const dx = e.clientX - dragStartXRef.current
    // Un poco de margen antes de considerarlo un arrastre de verdad, para
    // no robarle el gesto a un simple toque con el dedo algo tembloroso.
    if (!draggingRef.current && dx <= 6) return
    if (!draggingRef.current) {
      draggingRef.current = true
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // sin soporte de pointer capture: el gesto sigue funcionando, solo
        // que se corta si el dedo se sale del todo de la burbuja.
      }
    }
    const clamped = Math.max(0, Math.min(dx, SWIPE_REPLY_MAX_PX))
    setDragX(clamped)
    const nowArmed = clamped >= SWIPE_REPLY_THRESHOLD_PX
    setArmed((wasArmed) => {
      if (nowArmed && !wasArmed && navigator.vibrate) navigator.vibrate(12)
      return nowArmed
    })
  }

  const endSwipe = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onSwipeReply) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // nada que liberar si no se llegó a capturar.
    }
    if (draggingRef.current && armed) onSwipeReply(m)
    dragStartXRef.current = null
    draggingRef.current = false
    setArmed(false)
    setDragX(0)
  }

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
        <div className="relative">
          {onSwipeReply && dragX > 0 && (
            <span
              className="pointer-events-none absolute top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-brand-500)] transition-opacity"
              style={{ left: '-30px', opacity: Math.min(dragX / SWIPE_REPLY_THRESHOLD_PX, 1) }}
            >
              <ReplyIcon className="h-4 w-4" />
            </span>
          )}
          <div
            {...longPress}
            onPointerDown={handleSwipePointerDown}
            onPointerMove={handleSwipePointerMove}
            onPointerUp={endSwipe}
            onPointerCancel={endSwipe}
            // Red de seguridad extra: si por lo que sea el navegador nunca
            // llega a avisar de que el puntero se soltó (pointerup) ni de
            // que se canceló (pointercancel) — como cuando un gesto nativo
            // del navegador se cuela a mitad del deslizamiento — esto
            // también cierra el gesto en cuanto el puntero sale de la
            // burbuja, para que nunca se quede "empujada" a un lado.
            onPointerLeave={(e) => {
              if (draggingRef.current) endSwipe(e)
            }}
            style={{
              transform: `translateX(${dragX}px)`,
              transition: draggingRef.current ? 'none' : 'transform 200ms ease-out',
              touchAction: 'pan-y',
            }}
            className={`select-none rounded-2xl px-3 py-2 text-sm ${
              isMine
                ? 'rounded-br-sm bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_10px_20px_-12px_var(--color-glow)]'
                : 'glass-panel rounded-bl-sm text-slate-800 dark:text-slate-100'
            }`}
          >
          {m.reply_to && (
            // Esta burbuja no tiene un ancho fijo (se ajusta a su contenido
            // dentro del max-w-[75%] de fuera), y un párrafo con "truncate"
            // (que por dentro es white-space:nowrap) solo recorta el texto
            // cuando tiene un ancho DEFINIDO donde recortar — si no, el
            // texto largo citado empuja a toda la burbuja a hacerse tan
            // ancha como haga falta para caber entero, aunque el mensaje
            // nuevo sea cortísimo. El tope va en "vw" (relativo al ancho de
            // la pantalla) y no en px fijos: un tope fijo (probado: 220px)
            // se queda demasiado ancho en pantallas pequeñas y la burbuja
            // volvía a asomarse por el borde — en vw se ajusta a cualquier
            // tamaño de móvil.
            <div
              className={`mb-1.5 max-w-[55vw] rounded-lg border-l-4 px-2 py-1 text-xs ${
                isMine ? 'border-white/50 bg-white/10' : 'border-brand-500 bg-black/5 dark:bg-white/5'
              }`}
            >
              <p className={`truncate font-medium ${isMine ? 'text-white/90' : 'text-brand-600 dark:text-brand-400'}`}>
                {m.reply_to.sender_id === currentUserId ? t('chat.you') : m.reply_to.sender?.username || '—'}
              </p>
              <p className={`truncate ${isMine ? 'text-white/70' : 'text-slate-500 dark:text-slate-400'}`}>
                {replyPreviewText(m.reply_to, t)}
              </p>
            </div>
          )}
          {m.image_path && imageUrl && (
            // draggable=false + user-drag/touch-callout "none": una <img>
            // es arrastrable por el propio navegador por defecto. Esta
            // burbuja ya tiene su propio gesto táctil (deslizar para
            // responder, con pointerdown/move/up manuales) — sin esto, el
            // navegador podía interpretar el deslizamiento sobre la FOTO
            // como su propio "arrastrar imagen" nativo en vez de dejarlo
            // pasar a nuestro gesto, dejando a medias la captura del
            // puntero (de ahí que responder a una foto se descuadrara y no
            // pasara con texto normal).
            <img
              src={imageUrl}
              alt={t('chat.photoAlt')}
              draggable={false}
              className="mb-1 max-h-56 cursor-pointer select-none rounded-lg object-contain [-webkit-touch-callout:none] [-webkit-user-drag:none]"
              onClick={(e) => {
                e.stopPropagation()
                onOpenImage(imageUrl)
              }}
            />
          )}
          {m.audio_path && (
            <div className="mb-1 flex items-center gap-2">
              {audioUrl ? (
                <VoiceMessagePlayer
                  src={audioUrl}
                  seed={m.audio_path}
                  totalSeconds={m.audio_duration_seconds ?? 0}
                  isMine={isMine}
                />
              ) : (
                <p className="text-xs italic text-slate-500 dark:text-slate-400">{t('chat.loadingAudio')}</p>
              )}
            </div>
          )}
          {m.file_path && (
            // No hay lector de PDF/Word embebido en la app — como en
            // cualquier chat, tocar el adjunto lo abre con el visor nativo
            // del propio navegador/teléfono en una pestaña nueva.
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.stopPropagation()
                if (!fileUrl) e.preventDefault()
              }}
              className={`mb-1 flex items-center gap-2.5 rounded-lg px-2.5 py-2 ${
                isMine ? 'bg-white/10' : 'bg-black/5 dark:bg-white/5'
              } ${fileUrl ? 'cursor-pointer' : 'cursor-default opacity-70'}`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  isMine ? 'bg-white/15 text-white' : 'bg-[var(--color-glass)] text-[var(--color-brand-600)]'
                }`}
              >
                <FileAttachmentIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.file_name ?? t('chat.replyFile')}</span>
                {m.file_size_bytes != null && (
                  <span className={`text-xs ${isMine ? 'text-white/70' : 'text-slate-500 dark:text-slate-400'}`}>
                    {formatFileSize(m.file_size_bytes)}
                  </span>
                )}
              </span>
            </a>
          )}
          {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
          </div>
        </div>
        <p className="mt-0.5 px-1 text-[10px] text-slate-500 dark:text-slate-400">
          {m.edited_at && `${t('chat.edited')} · `}
          {new Date(m.created_at).toLocaleTimeString(language === 'en' ? 'en-US' : 'es-ES', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  )
}
