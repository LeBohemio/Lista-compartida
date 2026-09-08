import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useToast } from '../context/ToastContext'
import { useNoteDetail } from '../hooks/useNoteDetail'
import { supabase } from '../lib/supabaseClient'
import InviteNoteMemberModal from '../components/InviteNoteMemberModal'
import ConfirmDialog from '../components/ConfirmDialog'
import Avatar from '../components/Avatar'
import {
  BoldIcon,
  CloseIcon,
  HelpCircleIcon,
  NumberedListIcon,
  SubtitleIcon,
  TextRedoIcon,
  TextSizeIcon,
  TextUndoIcon,
  TrashIcon,
} from '../components/icons'
import { PALETTE, colorForNote, colorNameKey } from '../lib/colors'

// Tamaños de letra en píxeles reales (ver applyFontSize más abajo, que
// envuelve el texto seleccionado en un <span style="font-size:...">) — ya
// no se usa la escala clásica 1-7 de document.execCommand('fontSize', ...),
// que en algunos navegadores móviles se comportaba de forma poco fiable.
const FONT_SIZE_OPTIONS: { value: string; labelKey: 'apuntes.fontSizeSmall' | 'apuntes.fontSizeNormal' | 'apuntes.fontSizeLarge' | 'apuntes.fontSizeHuge' }[] = [
  { value: '13', labelKey: 'apuntes.fontSizeSmall' },
  { value: '16', labelKey: 'apuntes.fontSizeNormal' },
  { value: '20', labelKey: 'apuntes.fontSizeLarge' },
  { value: '28', labelKey: 'apuntes.fontSizeHuge' },
]

const AUTOSAVE_DELAY_MS = 800

export default function NoteDetailPage() {
  const { noteId } = useParams<{ noteId: string }>()
  const { user, profile } = useAuth()
  const { t } = useLanguage()
  const { showError } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const { note, members, myMembership, isOwner, loading, error, refetch, updateNote } = useNoteDetail(noteId)

  const [title, setTitle] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  // Posición (en coordenadas de PANTALLA, no del árbol de componentes) de
  // cada menú flotante, calculada justo antes de abrirlo a partir del botón
  // que lo abre — ver openColorPicker/openFormatMenu/openNumberedHelp. Hace
  // falta porque los tres se portan directos a document.body con "fixed"
  // (ver el comentario grande junto a la barra de formato, más abajo, sobre
  // por qué "absolute" dentro de esta tarjeta no funcionaba).
  const [colorPickerPos, setColorPickerPos] = useState<{ top: number; left: number } | null>(null)
  const [showNumberedHelp, setShowNumberedHelp] = useState(false)
  const [helpPos, setHelpPos] = useState<{ bottom: number; left: number } | null>(null)
  const [formatMenuOpen, setFormatMenuOpen] = useState(false)
  const [formatMenuPos, setFormatMenuPos] = useState<{ bottom: number; left: number } | null>(null)
  // A diferencia de bodyFocusedRef (que solo sirve para que el efecto de
  // sincronización no le pise a la persona lo que está escribiendo), esto
  // sí dispara un re-render: es lo que decide si se ve o no la barra de
  // formato fija de abajo (ver más abajo, "Barra de formato").
  const [isBodyFocused, setIsBodyFocused] = useState(false)
  // Aviso discreto de "toca aquí para cambiar el color" — solo aparece la
  // vez que se acaba de crear la nota (CreateNoteModal navega aquí con
  // justCreated:true, ver NotesPage.tsx), no cada vez que se abre la nota.
  const [showColorHint, setShowColorHint] = useState(
    () => Boolean((location.state as { justCreated?: boolean } | null)?.justCreated),
  )
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; username: string } | null>(null)
  // Sustituye a la idea de mostrar "editado hace X" (no guardamos quién ni
  // cuándo se tocó por última vez el título/cuerpo por separado, solo
  // last_activity_at general) por algo más simple y sincero: un indicador
  // de guardado en vivo, con las cadenas 'apuntes.saving'/'apuntes.saved'
  // que ya existían en las traducciones pero no se usaban en ningún sitio.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const titleAreaRef = useRef<HTMLTextAreaElement>(null)
  // El cuerpo ahora es un <div contentEditable> (para poder tener negrita,
  // subtítulos y tamaños de letra de verdad, no solo texto plano) en vez de
  // un <textarea> — por eso es "no controlado": React no le pone el
  // contenido en cada render (eso le rompería el cursor mientras escribes),
  // se lo ponemos nosotros a mano vía este ref, solo cuando hace falta.
  const bodyDivRef = useRef<HTMLDivElement>(null)

  // Botones "pestaña" que abren un menú flotante (color, formato, ayuda de
  // numerado) — se guarda un ref de cada uno para poder calcular, justo
  // antes de abrirlo, en qué coordenadas exactas de la PANTALLA (con
  // getBoundingClientRect, no del árbol de componentes) hay que pintar su
  // menú una vez portado a document.body.
  const colorTabRef = useRef<HTMLButtonElement>(null)
  const formatTabRef = useRef<HTMLButtonElement>(null)
  const helpTabRef = useRef<HTMLButtonElement>(null)

  // Mientras la persona tiene el campo enfocado (escribiendo), no le
  // pisamos lo que está tecleando con lo que llegue de la base de datos
  // (ni lo suyo propio reflejado, ni un cambio de otro miembro) — solo se
  // actualiza el campo local cuando NO lo tiene activo.
  const titleFocusedRef = useRef(false)
  const bodyFocusedRef = useRef(false)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bodyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (note && !titleFocusedRef.current) setTitle(note.title)
  }, [note?.title, note])

  useEffect(() => {
    if (!note || bodyFocusedRef.current) return
    // Contenido no controlado (ver bodyDivRef arriba): lo pintamos a mano
    // solo cuando la persona no lo tiene enfocada — ni lo suyo propio ya
    // reflejado, ni un cambio de otro miembro le pisa lo que está
    // escribiendo ahora mismo.
    const el = bodyDivRef.current
    if (el && el.innerHTML !== note.body) el.innerHTML = note.body
  }, [note?.body, note])

  useEffect(() => {
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
      if (bodyTimerRef.current) clearTimeout(bodyTimerRef.current)
    }
  }, [])

  // "Recientes": mismo mecanismo que ListDetailPage.tsx — entrar de verdad
  // en esta nota guarda cuándo fue en TU propia fila de note_members, y eso
  // es lo que usa "Notas" para subirla arriba (ver useNotes.ts). No cambia
  // por lo que edite otra persona, solo por lo que abres tú. Ver
  // migration_v38.sql.
  useEffect(() => {
    if (!user || !noteId) return
    supabase
      .from('note_members')
      .update({ last_opened_at: new Date().toISOString() })
      .eq('note_id', noteId)
      .eq('user_id', user.id)
      .then(({ error: err }) => {
        if (err) console.error('[note_members] no se pudo guardar la apertura reciente:', err)
      })
  }, [noteId, user])

  const scheduleSave = (patch: { title?: string; body?: string }, timerRef: typeof titleTimerRef) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setSaveStatus('saving')
    timerRef.current = setTimeout(async () => {
      await updateNote(patch)
      setSaveStatus('saved')
    }, AUTOSAVE_DELAY_MS)
  }

  // El título ahora es un <textarea> de una sola fila que crece con el
  // contenido (igual que el compositor del chat) en vez de un <input> de
  // toda la vida — un título largo se veía cortado a la mitad, sin forma
  // de leerlo entero, porque un <input> nunca hace salto de línea.
  useEffect(() => {
    const el = titleAreaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title])

  const handleTitleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setTitle(value)
    scheduleSave({ title: value }, titleTimerRef)
  }

  // Lee el HTML que hay ahora mismo en el editor y programa el guardado —
  // lo llaman tanto el evento nativo "input" (al teclear o pegar) como cada
  // botón de la barra de formato después de aplicar su comando.
  const syncBodyFromDom = () => {
    const el = bodyDivRef.current
    if (!el) return
    scheduleSave({ body: el.innerHTML }, bodyTimerRef)
  }

  const handleBodyInput = () => syncBodyFromDom()

  // Al pegar, se inserta solo texto plano (nunca el formato/estilo de
  // origen) — así una nota no acaba llena de fuentes y colores ajenos
  // pegados de otra web o app, y de paso nos ahorramos tener que sanear en
  // el momento cualquier HTML raro que traiga el portapapeles.
  const handleBodyPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
  }

  // Los botones de la barra de formato son <button>, así que sin esto el
  // navegador les daría el foco (y con él se perdería la selección de
  // texto del editor) antes de que llegue a ejecutarse el onClick. Al
  // cancelar el mousedown, el editor conserva el foco y su selección.
  const preventToolbarFocusSteal = (e: ReactMouseEvent) => e.preventDefault()

  const applyBold = () => {
    bodyDivRef.current?.focus()
    document.execCommand('bold')
    syncBodyFromDom()
  }

  // Convierte la línea actual en subtítulo (<h3>), o la devuelve a texto
  // normal si ya lo era — solo afecta a la línea del cursor (o a las
  // líneas seleccionadas), nunca a toda la nota de golpe.
  const applySubtitle = () => {
    bodyDivRef.current?.focus()
    const current = document.queryCommandValue('formatBlock')
    const isSubtitle = current?.toLowerCase() === 'h3'
    document.execCommand('formatBlock', false, isSubtitle ? 'div' : 'h3')
    syncBodyFromDom()
  }

  // document.execCommand('fontSize', ...) resultó poco fiable en el móvil
  // (el motivo original de la queja de "no funciona"), así que el tamaño de
  // letra se aplica a mano con un <span style="font-size:Npx">. Hay dos
  // casos distintos:
  //
  // 1. Con texto seleccionado: se ENVUELVE la selección en el span.
  //    range.surroundContents lanza una excepción cuando la selección cruza
  //    varios elementos de bloque a la vez (por ejemplo, si abarca un salto
  //    de línea) porque en ese caso no forma un único trozo continuo que se
  //    pueda "envolver" tal cual — para ese caso se usa en su lugar
  //    extractContents + insertNode, que sí admite un trozo con varias
  //    piezas dentro.
  // 2. Sin texto seleccionado, con el cursor a secas (por ejemplo, antes de
  //    escribir nada): también tiene que "funcionar", como pidió quien usa
  //    la app — no tiene sentido obligar a escribir primero y seleccionar
  //    después solo para poder elegir el tamaño con el que se va a escribir.
  //    Aquí no hay nada que envolver todavía, así que se deja preparado el
  //    punto de escritura: se inserta un span vacío (con un carácter
  //    invisible dentro, porque los navegadores no dejan colocar el cursor
  //    dentro de un elemento totalmente vacío) y se deja el cursor justo
  //    detrás de ese carácter — así, lo próximo que se teclee cae dentro de
  //    ese mismo span y sale ya con el tamaño elegido.
  const applyFontSize = (size: string) => {
    const el = bodyDivRef.current
    if (!el) return
    el.focus()
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      setFormatMenuOpen(false)
      return
    }
    const range = selection.getRangeAt(0)
    const span = document.createElement('span')
    span.style.fontSize = `${size}px`

    if (selection.isCollapsed) {
      // U+200B: espacio de ancho cero, para poder colocar el cursor dentro
      // del span (ver comentario de más arriba). String.fromCharCode en vez
      // de escribir el carácter invisible tal cual en el código fuente, que
      // sería imposible de distinguir a simple vista de un espacio en
      // blanco normal (o de estar vacío del todo) al releer este archivo.
      span.appendChild(document.createTextNode(String.fromCharCode(8203)))
      range.insertNode(span)
      const newRange = document.createRange()
      newRange.setStart(span.firstChild as Node, 1)
      newRange.collapse(true)
      selection.removeAllRanges()
      selection.addRange(newRange)
      setFormatMenuOpen(false)
      syncBodyFromDom()
      return
    }

    try {
      range.surroundContents(span)
    } catch {
      const frag = range.extractContents()
      span.appendChild(frag)
      range.insertNode(span)
    }
    // Reselecciona el texto ya envuelto, tanto para que se vea claro qué se
    // acaba de cambiar como para que tocar otro tamaño justo después actúe
    // sobre el mismo trozo.
    const newRange = document.createRange()
    newRange.selectNodeContents(span)
    selection.removeAllRanges()
    selection.addRange(newRange)
    setFormatMenuOpen(false)
    syncBodyFromDom()
  }

  // Numera (o, si ya estaban numeradas, quita la numeración de) solo las
  // líneas tocadas por la selección actual — o, si no hay nada seleccionado,
  // solo la línea donde está el cursor. document.execCommand se encarga de
  // no tocar el resto de la nota y de alternar entre numerar/desnumerar por
  // sí solo, así que no hace falta calcular nada a mano.
  const toggleNumberedList = () => {
    bodyDivRef.current?.focus()
    document.execCommand('insertOrderedList')
    syncBodyFromDom()
  }

  // Deshacer/rehacer: piden ambos "sí o sí" (ver captura de referencia) —
  // document.execCommand mantiene su propia pila de deshacer del navegador
  // para el contenido editable, así que no hace falta llevar una a mano.
  const applyUndo = () => {
    bodyDivRef.current?.focus()
    document.execCommand('undo')
    syncBodyFromDom()
  }

  const applyRedo = () => {
    bodyDivRef.current?.focus()
    document.execCommand('redo')
    syncBodyFromDom()
  }

  // Los tres menús flotantes (color, formato "Aa", ayuda de numerado) se
  // portan directos a document.body con position:fixed — así que, antes de
  // abrir cada uno, se mide con getBoundingClientRect en qué coordenadas de
  // PANTALLA está su botón, para pintar el menú justo ahí (ver el
  // comentario grande junto a la barra de formato sobre por qué hacía falta
  // este cambio). Los dos que cuelgan de la barra de abajo (formato y
  // ayuda) se anclan por su borde inferior ("bottom", no "top") porque la
  // barra está pegada al fondo de la pantalla y el menú tiene que abrirse
  // hacia arriba, por encima del botón.
  const openColorPicker = () => {
    const rect = colorTabRef.current?.getBoundingClientRect()
    if (rect) setColorPickerPos({ top: rect.bottom + 8, left: rect.left })
    setShowColorPicker(true)
  }

  const openFormatMenu = () => {
    const rect = formatTabRef.current?.getBoundingClientRect()
    if (rect) setFormatMenuPos({ bottom: window.innerHeight - rect.top + 8, left: rect.left })
    setFormatMenuOpen(true)
  }

  const openNumberedHelp = () => {
    const rect = helpTabRef.current?.getBoundingClientRect()
    if (rect) {
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - 230 - 12))
      setHelpPos({ bottom: window.innerHeight - rect.top + 8, left })
    }
    setShowNumberedHelp(true)
  }

  const removeMember = async () => {
    if (!confirmRemove || !noteId) return
    const { error: err } = await supabase.from('note_members').delete().eq('note_id', noteId).eq('user_id', confirmRemove.userId)
    if (err) showError(t('common.deleteError'))
    setConfirmRemove(null)
    refetch()
  }

  const existingMemberIds = members.map((m) => m.user_id)
  const acceptedMembers = members.filter((m) => m.status === 'accepted')

  if (!noteId) return null

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-500 dark:text-slate-400">{t('list.loading')}</p>
      </div>
    )
  }

  if (error || !note) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-slate-600 dark:text-slate-300">{t('list.errorLoad')}</p>
        <button onClick={() => navigate('/notes')} className="text-brand-600 underline dark:text-brand-400">
          {t('apuntes.tabTitle')}
        </button>
      </div>
    )
  }

  // A esta pantalla se puede llegar directamente desde el aviso push de
  // invitación (ver send-push/index.ts, handleNoteMembers) antes de haber
  // aceptado — la política de SELECT de "notes" (migration_v23.sql) deja
  // ver el contenido a un invitado sin aceptar todavía, pero la de UPDATE
  // no, así que sin esta comprobación se entraba directo al editor y
  // cualquier cambio fallaba en silencio al guardar. Mismo patrón que ya
  // tenía ListDetailPage.tsx para listas.
  if (!myMembership || myMembership.status !== 'accepted') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-slate-600 dark:text-slate-300">{t('apuntes.pendingInviteBody', { name: note.title })}</p>
        <button onClick={() => navigate('/notes')} className="text-brand-600 underline dark:text-brand-400">
          {t('apuntes.goToMyNotes')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen"
      style={profile?.background_color ? { backgroundColor: profile.background_color } : undefined}
    >
      {/* HEADER_ACCENT_FLOAT: mismo patrón que en el resto de cabeceras — ver
          el comentario completo en SettingsPage.tsx. */}
      <header
        className="sticky top-0 z-10 overflow-hidden bg-[var(--color-brand-700)] px-4 pb-3"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <span className="pointer-events-none absolute -right-8 -top-16 h-36 w-36 rounded-full bg-[var(--color-brand-400)] opacity-50 blur-2xl" />
        <span className="pointer-events-none absolute -bottom-10 right-14 h-24 w-24 rounded-full bg-[var(--color-brand-300)] opacity-30 blur-xl" />
        <div className="relative mx-auto flex max-w-2xl items-center justify-between gap-2">
          <button
            onClick={() => navigate('/notes')}
            aria-label={t('common.back')}
            className="shrink-0 text-xl text-white/80 hover:text-white"
          >
            ‹
          </button>
          <div className="min-w-0 flex-1">
            <button onClick={() => setShowMembers((s) => !s)} className="block text-xs text-white/75 hover:text-white">
              {acceptedMembers.length} {acceptedMembers.length === 1 ? t('list.member') : t('list.membersPlural')}
            </button>
          </div>
          {/* Invitar ahora está abierto a cualquier miembro, no solo al
              dueño (ver migration_v40.sql) — igual que ya pasaba en listas
              (ver ListDetailPage.tsx). Como esta pantalla solo se llega a
              pintar siendo ya miembro aceptado, no hace falta comprobación
              extra aquí; la de verdad vive en la política de note_members. */}
          <button
            onClick={() => setShowInvite(true)}
            className="shrink-0 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-[var(--color-brand-700)] shadow-[0_8px_18px_-8px_rgba(20,21,26,0.4)]"
          >
            {t('list.inviteButton')}
          </button>
        </div>

        {showMembers && (
          <div className="glass-panel mx-auto mt-3 max-w-2xl rounded-2xl p-3 text-sm">
            <ul className="space-y-2">
              {members.map((m) => {
                const isSelf = m.user_id === user?.id
                return (
                  <li key={m.user_id} className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                      <Avatar username={m.profile?.username ?? '?'} avatarUrl={m.profile?.avatar_url} size={24} enlargeOnClick={false} />
                      {m.profile?.username ?? m.user_id}
                      {isSelf ? ` ${t('expenses.you')}` : ''}
                      {m.role === 'owner' ? t('list.ownerSuffix') : ''}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className={`text-xs ${m.status === 'accepted' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {m.status === 'accepted' ? t('member.statusActive') : t('member.statusPending')}
                      </span>
                      {isOwner && m.role !== 'owner' && (
                        <button
                          onClick={() => setConfirmRemove({ userId: m.user_id, username: m.profile?.username ?? t('list.thisUser') })}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-950/40"
                          aria-label={t('list.removeMember')}
                          title={t('list.removeMember')}
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-2xl px-3 py-5">
        {/* Diseño "tarjeta con lengüeta": una pestañita de color asomando
            arriba (como una nota adhesiva de verdad) en vez de la tarjeta
            de cristal neutra de siempre — para que una nota no se sienta
            como la de cualquier app de notas genérica. La lengüeta usa el
            acento de quien mira, igual que el resto de la app. */}
        <div>
          {/* La lengüeta va DENTRO de la propia tarjeta (pegada a su borde
              superior, por eso la tarjeta necesita "relative" y algo más
              de padding arriba), no en un envoltorio aparte por encima —
              así se queda embebida en el borde en vez de flotar suelta por
              fuera de la nota. */}
          <div className="glass-panel relative rounded-[22px] px-4 pb-4 pt-5">
            {/* La lengüeta ahora tiene el color propio de la nota (el
                elegido a mano, o uno estable según el título — ver
                colorForNote) en vez del acento fijo de siempre, y se puede
                tocar para cambiarlo. El mismo color se ve también en la
                fila de esta nota dentro del listado (ver NotesPage.tsx). */}
            <button
              type="button"
              ref={colorTabRef}
              onClick={() => (showColorPicker ? setShowColorPicker(false) : openColorPicker())}
              aria-label={t('apuntes.changeColor')}
              title={t('apuntes.changeColor')}
              className="absolute left-6 top-0 h-2.5 w-14 rounded-b-md"
              style={{ backgroundColor: colorForNote(note) }}
            />
            {/* IMPORTANTE: el fondo invisible de "tocar fuera para cerrar" y
                el propio selector se portan JUNTOS, en la misma llamada a
                createPortal, directos a document.body con position:fixed —
                antes iban cada uno por su lado (el fondo portado, pero el
                selector "absolute" dentro de esta tarjeta, que tiene
                backdrop-filter). Un backdrop-filter crea su propio contexto
                de apilamiento y "atrapa" dentro cualquier position:fixed o
                absolute de sus descendientes (mismo problema ya documentado
                en ContextMenu.tsx) — así que el selector, aun viéndose
                encima, en realidad quedaba POR DEBAJO del fondo invisible
                en el orden de eventos, y cada toque sobre un color lo
                interceptaba el fondo (cerrando el selector) en vez de
                llegar al color. Portando ambos juntos, los dos viven en el
                mismo contexto de apilamiento de la raíz y el selector
                queda de verdad por encima. */}
            {showColorPicker && colorPickerPos &&
              createPortal(
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowColorPicker(false)} />
                  <div
                    className="glass-panel fixed z-50 flex flex-wrap gap-2 rounded-2xl p-3 shadow-[0_16px_40px_-16px_rgba(20,21,26,0.45)]"
                    style={{ top: colorPickerPos.top, left: colorPickerPos.left, width: '184px' }}
                  >
                    {PALETTE.map((c) => (
                      <button
                        type="button"
                        key={c}
                        onClick={() => {
                          updateNote({ color: c })
                          setShowColorPicker(false)
                        }}
                        aria-label={t(colorNameKey(c))}
                        className="h-7 w-7 rounded-full"
                        style={{ backgroundColor: c, boxShadow: note.color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none' }}
                      />
                    ))}
                  </div>
                </>,
                document.body,
              )}
            {showColorHint && (
              <div className="mb-3 mt-4 flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                <span className="flex-1">{t('apuntes.colorHint')}</span>
                <button
                  type="button"
                  onClick={() => setShowColorHint(false)}
                  aria-label={t('common.close')}
                  className="shrink-0 text-brand-600 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-200"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <textarea
              ref={titleAreaRef}
              value={title}
              onChange={handleTitleChange}
              onKeyDown={(e) => {
                // El título sigue siendo conceptualmente "una línea": puede
                // ocupar varias líneas en pantalla si es largo, pero Intro
                // no debería meter un salto de línea manual dentro de él.
                if (e.key === 'Enter') e.preventDefault()
              }}
              onFocus={() => (titleFocusedRef.current = true)}
              onBlur={() => {
                titleFocusedRef.current = false
              }}
              placeholder={t('apuntes.titlePlaceholder')}
              rows={1}
              className="w-full resize-none overflow-hidden border-0 bg-transparent px-0 font-display text-xl font-bold leading-snug text-slate-900 focus:outline-none focus:ring-0 dark:text-slate-100"
            />
            {saveStatus !== 'idle' && (
              <p className="mb-1.5 mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {saveStatus === 'saving' ? t('apuntes.saving') : t('apuntes.saved')}
              </p>
            )}
            <div className="mb-3 mt-3 h-px bg-[var(--color-glass-border)]" />
            <div
              ref={bodyDivRef}
              contentEditable
              suppressContentEditableWarning
              onInput={handleBodyInput}
              onPaste={handleBodyPaste}
              onFocus={() => {
                bodyFocusedRef.current = true
                setIsBodyFocused(true)
              }}
              onBlur={() => {
                bodyFocusedRef.current = false
                setIsBodyFocused(false)
              }}
              data-placeholder={t('apuntes.bodyPlaceholder')}
              // pb-14: para que la barra de formato fija de abajo (solo
              // visible mientras se escribe, ver más abajo) no tape las
              // últimas líneas de la nota mientras se teclea.
              className={`note-body-editable min-h-[20rem] w-full border-0 bg-transparent px-0 text-base leading-relaxed text-slate-800 focus:outline-none focus:ring-0 dark:text-slate-100 ${isBodyFocused ? 'pb-14' : ''}`}
            />
          </div>
        </div>
      </main>

      {/* Barra de formato: una fila estrecha, solo iconos, fija abajo del
          todo (mismo patrón que el compositor del chat, ver ChatPanel.tsx)
          en vez de ir metida arriba del texto — así nunca queda tapada por
          el menú nativo de "Cortar/Copiar/Pegar" que Android saca justo
          encima de cualquier texto que selecciones. Inspirada directamente
          en la app de notas que envió como referencia quien usa la app: una
          fila fina de iconos pegada al teclado, donde "Aa" abre una
          ventanita aparte con negrita/subtítulo/tamaño en vez de tener
          todos esos botones siempre a la vista — así se ve mucho más
          discreta que antes. Deshacer/rehacer van aparte, a la derecha.
          Todos usan onMouseDown={preventToolbarFocusSteal} para que el
          editor no pierda el foco (y con él, la selección) al tocar el
          botón — y la fila solo se muestra mientras el cuerpo está
          enfocado, para no estorbar el resto del tiempo. */}
      {isBodyFocused && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-surface-border)] bg-[var(--color-surface)]">
          <div className="mx-auto flex max-w-2xl items-center gap-1 px-3 py-2">
            <button
              type="button"
              ref={formatTabRef}
              onMouseDown={preventToolbarFocusSteal}
              onClick={() => (formatMenuOpen ? setFormatMenuOpen(false) : openFormatMenu())}
              aria-label={t('apuntes.formatMenu')}
              title={t('apuntes.formatMenu')}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
            >
              <TextSizeIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onMouseDown={preventToolbarFocusSteal}
              onClick={toggleNumberedList}
              aria-label={t('apuntes.numberedList')}
              title={t('apuntes.numberedListHint')}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
            >
              <NumberedListIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              ref={helpTabRef}
              onMouseDown={preventToolbarFocusSteal}
              onClick={() => (showNumberedHelp ? setShowNumberedHelp(false) : openNumberedHelp())}
              aria-label={t('apuntes.numberedListHelpCta')}
              title={t('apuntes.numberedListHelpCta')}
              className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-500 dark:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-300"
            >
              <HelpCircleIcon className="h-4 w-4" />
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onMouseDown={preventToolbarFocusSteal}
              onClick={applyUndo}
              aria-label={t('apuntes.undo')}
              title={t('apuntes.undo')}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
            >
              <TextUndoIcon className="h-5 w-5" />
            </button>
            <button
              type="button"
              onMouseDown={preventToolbarFocusSteal}
              onClick={applyRedo}
              aria-label={t('apuntes.redo')}
              title={t('apuntes.redo')}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
            >
              <TextRedoIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Ventanita de formato ("Aa"): negrita, subtítulo y tamaño de letra
          juntos en un panel pequeño y aparte, en vez de ir sueltos en la
          barra de abajo — igual que el resto de menús flotantes de esta
          pantalla, se porta a document.body junto con su fondo de "tocar
          fuera para cerrar" en una sola llamada a createPortal (ver el
          comentario grande del selector de color, más arriba, sobre por
          qué hace falta). Se ancla por su borde inferior porque tiene que
          abrirse hacia ARRIBA, por encima de la barra que está pegada al
          fondo de la pantalla. */}
      {formatMenuOpen && formatMenuPos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onMouseDown={preventToolbarFocusSteal} onClick={() => setFormatMenuOpen(false)} />
            <div
              className="glass-panel fixed z-50 flex flex-col gap-2 rounded-2xl p-3 shadow-[0_16px_40px_-16px_rgba(20,21,26,0.45)]"
              style={{ bottom: formatMenuPos.bottom, left: formatMenuPos.left, width: '210px' }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {t('apuntes.formatMenu')}
                </span>
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={() => setFormatMenuOpen(false)}
                  aria-label={t('common.close')}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={applyBold}
                  aria-label={t('apuntes.bold')}
                  title={t('apuntes.boldHint')}
                  className="flex flex-1 items-center justify-center rounded-lg py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                >
                  <BoldIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={applySubtitle}
                  aria-label={t('apuntes.subtitle')}
                  title={t('apuntes.subtitleHint')}
                  className="flex flex-1 items-center justify-center rounded-lg py-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                >
                  <SubtitleIcon className="h-4 w-4" />
                </button>
              </div>
              {/* Los cuatro tamaños se ven a su propio tamaño real (dentro
                  de un límite razonable) para que se note de un vistazo
                  cuál es cuál, en vez de cuatro "A" idénticas con solo la
                  etiqueta de texto para distinguirlas. */}
              <div className="flex items-end gap-1">
                {FONT_SIZE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onMouseDown={preventToolbarFocusSteal}
                    onClick={() => applyFontSize(opt.value)}
                    aria-label={t(opt.labelKey)}
                    title={t(opt.labelKey)}
                    className="flex flex-1 items-center justify-center rounded-lg py-1.5 font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
                    style={{ fontSize: `${Math.min(20, Number(opt.value))}px` }}
                  >
                    A
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}

      {/* Ayuda del botón de numerar: mismo patrón de portal que los otros
          dos menús flotantes de esta pantalla (ver comentario grande del
          selector de color) — antes iba "absolute" dentro de la barra de
          abajo, que no tiene backdrop-filter así que no le afectaba el bug
          de apilamiento, pero se deja igual de consistente que el resto. */}
      {showNumberedHelp && helpPos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onMouseDown={preventToolbarFocusSteal} onClick={() => setShowNumberedHelp(false)} />
            <div
              className="glass-panel fixed z-50 rounded-xl p-3 text-xs leading-relaxed text-slate-600 shadow-[0_16px_40px_-16px_rgba(20,21,26,0.45)] dark:text-slate-300"
              style={{ bottom: helpPos.bottom, left: helpPos.left, width: '230px' }}
            >
              {t('apuntes.numberedListHelpText')}
            </div>
          </>,
          document.body,
        )}

      {showInvite && (
        <InviteNoteMemberModal
          noteId={noteId}
          existingMemberIds={existingMemberIds}
          onClose={() => setShowInvite(false)}
          onInvited={refetch}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={t('list.removeMember')}
          message={t('list.removeMemberConfirm', { name: confirmRemove.username })}
          confirmLabel={t('menu.delete')}
          danger
          onConfirm={removeMember}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  )
}
