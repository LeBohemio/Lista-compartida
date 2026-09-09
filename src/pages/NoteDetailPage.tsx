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
  CloseIcon,
  HelpCircleIcon,
  NumberedListIcon,
  PaletteIcon,
  TextRedoIcon,
  TextSizeIcon,
  TextUndoIcon,
  TrashIcon,
} from '../components/icons'
import { PALETTE, colorForNote, colorNameKey } from '../lib/colors'

// Fila que se ve ahora mismo dentro de la barra de formato de abajo — las
// tres viven en la MISMA barra fija (nunca en una ventanita flotando por
// encima, ver el comentario grande junto a la barra más abajo): "collapsed"
// es la fila fina de iconos de siempre, "expanded" es la fila de
// título/subtítulo/normal + negrita/cursiva/subrayado, y "colors" es la
// fila con los colores de la nota.
type ToolbarRow = 'collapsed' | 'expanded' | 'colors'

// Los tres tamaños de línea (Título/Subtítulo/Normal) son EXCLUYENTES entre
// sí — nunca hay dos activos a la vez, a diferencia de negrita, cursiva y
// subrayado, que son interruptores independientes combinables entre ellos y
// con cualquiera de los tres tamaños. "h2" es el título grande y "h3" el
// subtítulo (ver richText.ts y el CSS de .note-body-editable en index.css)
// — en pantalla el botón del título se llama "H1", pero por dentro sigue
// usando la etiqueta <h2>, para no tener que tocar el saneador ni el CSS ya
// existentes.
type BlockStyle = 'h2' | 'h3' | 'div'

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
  // Qué fila se ve ahora mismo dentro de la barra de formato fija de abajo
  // — ver el tipo ToolbarRow más arriba. Ya no es una ventanita flotante
  // aparte: la misma barra cambia de contenido en el sitio.
  const [toolbarRow, setToolbarRow] = useState<ToolbarRow>('collapsed')
  // Estado de formato de la línea/selección actual, para pintar resaltado
  // (fondo de "activo") en los botones de la fila expandida — se recalcula
  // con syncFormatState() cada vez que cambia la selección dentro del
  // cuerpo, y también justo después de aplicar cualquiera de estos formatos.
  const [activeBlock, setActiveBlock] = useState<BlockStyle>('div')
  const [boldOn, setBoldOn] = useState(false)
  const [italicOn, setItalicOn] = useState(false)
  const [underlineOn, setUnderlineOn] = useState(false)
  // Cuánto hay que levantar la barra de formato para que quede pegada
  // JUSTO encima del teclado en pantalla, en píxeles — ver el efecto de
  // más abajo que lo calcula con la Visual Viewport API. Con solo CSS
  // ("fixed" + "bottom: 0") la barra se quedaba anclada al teclado al
  // hacer scroll hacia abajo (porque ahí el navegador SÍ recalculaba la
  // posición) pero desaparecía al volver a subir (porque el navegador
  // deja de recalcularla y la barra se queda pegada al fondo de la
  // pantalla ENTERA, por debajo del teclado, tapada) — un problema típico
  // de los navegadores/WebView de móvil, donde "fixed" se ancla a la
  // ventana de diseño (que no se encoge cuando aparece el teclado) y no a
  // la ventana VISIBLE de verdad. Calculando el hueco a mano con
  // window.visualViewport y aplicándolo como "bottom" en cada
  // resize/scroll de esa ventana visible, la barra se queda anclada de
  // forma fiable pase lo que pase con el scroll.
  const [keyboardOffset, setKeyboardOffset] = useState(0)
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

  // Botones "pestaña" que abren un menú flotante — se guarda un ref de cada
  // uno para poder calcular, justo antes de abrirlo, en qué coordenadas
  // exactas de la PANTALLA (con getBoundingClientRect, no del árbol de
  // componentes) hay que pintar su menú una vez portado a document.body.
  // Solo quedan dos: el de color de arriba (colorTabRef) y el de ayuda de
  // numerado (helpTabRef) — el de formato ya no abre una ventanita aparte,
  // así que no necesita ref propio (ver toolbarRow).
  const colorTabRef = useRef<HTMLButtonElement>(null)
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

  // Mantiene keyboardOffset al día con el hueco real que deja el teclado
  // (u otra barra del propio navegador) por debajo de la ventana VISIBLE —
  // ver el comentario grande junto a keyboardOffset más arriba. Se
  // recalcula en cada "resize" (el teclado aparece/desaparece, o cambia de
  // alto al sugerir palabras) y en cada "scroll" de la propia Visual
  // Viewport (algunos navegadores solo actualizan el desplazamiento ahí, no
  // con un resize aparte). No todos los navegadores tienen
  // window.visualViewport — donde falte, el hueco se queda en 0 y la barra
  // se comporta como un "fixed bottom: 0" normal y corriente.
  //
  // Ambos eventos pueden dispararse muchas veces seguidas mientras la
  // pantalla del móvil termina de animar (el teclado subiendo, la barra de
  // direcciones ocultándose al hacer scroll…) — llamar a setState en cada
  // uno de esos disparos, sin más, es lo que hacía que la barra "vibrara"
  // al hacer scroll: cada pequeño cambio de un píxel forzaba un nuevo
  // render y un nuevo repintado, peleándose visualmente con el propio
  // scroll nativo del navegador. Para evitarlo: (1) como mucho un cálculo
  // por fotograma, con requestAnimationFrame, en vez de uno por cada
  // evento suelto; y (2) solo se actualiza el estado (y por tanto se
  // vuelve a pintar la barra) cuando el hueco cambia de verdad — un
  // pixel de diferencia de más no cuenta.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    let frame = 0
    let lastGap = 0

    const recompute = () => {
      frame = 0
      const gap = Math.round(window.innerHeight - (vv.height + vv.offsetTop))
      const clamped = gap > 0 ? gap : 0
      if (Math.abs(clamped - lastGap) < 1) return
      lastGap = clamped
      setKeyboardOffset(clamped)
    }

    const scheduleRecompute = () => {
      if (frame) return
      frame = requestAnimationFrame(recompute)
    }

    recompute()
    vv.addEventListener('resize', scheduleRecompute)
    vv.addEventListener('scroll', scheduleRecompute)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      vv.removeEventListener('resize', scheduleRecompute)
      vv.removeEventListener('scroll', scheduleRecompute)
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

  // Recalcula qué formato tiene la línea/selección actual del cuerpo, para
  // poder resaltar (fondo "activo") el botón correspondiente en la fila
  // expandida de la barra — se llama tras cada acción de formato y también
  // cada vez que cambia la selección mientras se escribe (ver
  // onKeyUp/onMouseUp/onFocus del cuerpo, más abajo).
  const syncFormatState = () => {
    const block = document.queryCommandValue('formatBlock')?.toLowerCase()
    setActiveBlock(block === 'h2' ? 'h2' : block === 'h3' ? 'h3' : 'div')
    setBoldOn(document.queryCommandState('bold'))
    setItalicOn(document.queryCommandState('italic'))
    setUnderlineOn(document.queryCommandState('underline'))
  }

  // Negrita, cursiva y subrayado son tres interruptores independientes:
  // cada uno se puede activar/desactivar sin afectar a los otros dos, ni al
  // tamaño de línea (Título/Subtítulo/Normal) que esté puesto.
  const applyBold = () => {
    bodyDivRef.current?.focus()
    document.execCommand('bold')
    syncFormatState()
    syncBodyFromDom()
  }

  const applyItalic = () => {
    bodyDivRef.current?.focus()
    document.execCommand('italic')
    syncFormatState()
    syncBodyFromDom()
  }

  const applyUnderline = () => {
    bodyDivRef.current?.focus()
    document.execCommand('underline')
    syncFormatState()
    syncBodyFromDom()
  }

  // Título (<h2>), Subtítulo (<h3>) y Normal (<div>) son EXCLUYENTES entre
  // sí — a diferencia del viejo applySubtitle (que alternaba entre h3 y
  // normal), aquí cada botón fija directamente el tamaño que representa,
  // sin comprobar cuál estaba puesto antes: tocar "Normal" siempre deja
  // Normal, tocar "H1" siempre deja Título, etc.
  const applyBlockStyle = (tag: BlockStyle) => {
    bodyDivRef.current?.focus()
    document.execCommand('formatBlock', false, tag)
    syncFormatState()
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

  // Los dos menús flotantes que quedan (color de arriba, ayuda de numerado)
  // se portan directos a document.body con position:fixed — así que, antes
  // de abrir cada uno, se mide con getBoundingClientRect en qué coordenadas
  // de PANTALLA está su botón, para pintar el menú justo ahí (ver el
  // comentario grande junto al selector de color sobre por qué hacía falta
  // este cambio). El de ayuda cuelga de la barra de abajo y se ancla por su
  // borde inferior ("bottom", no "top") porque la barra está pegada al
  // fondo de la pantalla y el menú tiene que abrirse hacia arriba, por
  // encima del botón.
  const openColorPicker = () => {
    const rect = colorTabRef.current?.getBoundingClientRect()
    if (rect) setColorPickerPos({ top: rect.bottom + 8, left: rect.left })
    setShowColorPicker(true)
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
                syncFormatState()
              }}
              onBlur={() => {
                bodyFocusedRef.current = false
                setIsBodyFocused(false)
                // Al salir del cuerpo se cierra también cualquier fila
                // desplegada (formato o colores) — los botones de la propia
                // barra no disparan este onBlur porque cancelan el
                // mousedown (ver preventToolbarFocusSteal), así que esto
                // solo pasa al tocar fuera de verdad.
                setToolbarRow('collapsed')
              }}
              // Con el cursor solo (sin escribir) también puede cambiar el
              // formato "activo" a resaltar en la barra — por ejemplo, al
              // mover el cursor con las flechas hasta un título ya
              // existente. onSelect no es fiable en todos los navegadores
              // para un <div contentEditable>, así que se recalcula también
              // en cada tecla o clic dentro del cuerpo.
              onKeyUp={syncFormatState}
              onMouseUp={syncFormatState}
              data-placeholder={t('apuntes.bodyPlaceholder')}
              // pb-14: para que la barra de formato fija de abajo (solo
              // visible mientras se escribe, ver más abajo) no tape las
              // últimas líneas de la nota mientras se teclea.
              className={`note-body-editable min-h-[20rem] w-full border-0 bg-transparent px-0 text-base leading-relaxed text-slate-800 focus:outline-none focus:ring-0 dark:text-slate-100 ${isBodyFocused ? 'pb-14' : ''}`}
            />
          </div>
        </div>
      </main>

      {/* Barra de formato: una barra PLANA (sin tarjeta ni sombra propia),
          fija abajo del todo (mismo patrón que el compositor del chat, ver
          ChatPanel.tsx) en vez de ir metida arriba del texto — así nunca
          queda tapada por el menú nativo de "Cortar/Copiar/Pegar" que
          Android saca justo encima de cualquier texto que selecciones.
          Calcada de las capturas que envió quien usa la app: la MISMA barra
          cambia de contenido en el sitio según toolbarRow, en vez de abrir
          una ventanita flotante aparte por encima — "colapsada" es la fila
          fina de iconos de siempre, y tocar la paleta o "Aa" la transforma,
          en el sitio, en la fila de colores o de formato; el botón de
          cerrar (×) de cada una vuelve a dejarla colapsada. Cada botón
          lleva su propio "chip" circular de fondo (nunca un icono pelado
          sobre la barra), como en las fotos de referencia. Todos usan
          onMouseDown={preventToolbarFocusSteal} para que el editor no
          pierda el foco (y con él, la selección) al tocar el botón — y la
          barra entera solo se muestra mientras el cuerpo está enfocado,
          para no estorbar el resto del tiempo. */}
      {isBodyFocused && (
        <div
          className="fixed inset-x-0 z-30 border-t border-[var(--color-surface-border)] bg-[var(--color-surface)]"
          // "bottom" a mano, en vez de la clase bottom-0 de Tailwind — ver
          // keyboardOffset más arriba: así la barra queda pegada de verdad
          // al teclado (o al fondo de la pantalla, si no hay teclado)
          // pase lo que pase con el scroll.
          style={{ bottom: keyboardOffset }}
        >
          <div className="mx-auto max-w-2xl px-3">
            {toolbarRow === 'collapsed' && (
              <div className="flex h-[58px] items-center gap-1.5">
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={() => setToolbarRow('colors')}
                  aria-label={t('apuntes.changeColor')}
                  title={t('apuntes.changeColor')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-alt)] text-slate-600 hover:opacity-100 dark:text-slate-300"
                >
                  <PaletteIcon className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={() => setToolbarRow('expanded')}
                  aria-label={t('apuntes.formatMenu')}
                  title={t('apuntes.formatMenu')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-alt)] text-slate-600 hover:opacity-100 dark:text-slate-300"
                >
                  <TextSizeIcon className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={toggleNumberedList}
                  aria-label={t('apuntes.numberedList')}
                  title={t('apuntes.numberedListHint')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-alt)] text-slate-600 hover:opacity-100 dark:text-slate-300"
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
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-alt)] text-slate-400 hover:opacity-100 dark:text-slate-500"
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
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-alt)] text-slate-600 hover:opacity-100 dark:text-slate-300"
                >
                  <TextUndoIcon className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={applyRedo}
                  aria-label={t('apuntes.redo')}
                  title={t('apuntes.redo')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-alt)] text-slate-600 hover:opacity-100 dark:text-slate-300"
                >
                  <TextRedoIcon className="h-5 w-5" />
                </button>
              </div>
            )}

            {/* Fila de formato: tres tamaños EXCLUYENTES entre sí (H1
                título, H2 subtítulo, Aa normal) más tres interruptores
                independientes y combinables entre ellos y con cualquiera de
                los tres tamaños (Negrita/Cursiva/Subrayado) — los tres
                aplican de verdad sobre el texto seleccionado (o sobre lo
                próximo que se escriba, si no hay selección), igual que ya
                hacía Negrita. La "N" se ve bien gorda (font-black) para que
                no haya duda de que es la de negrita. El botón activo de
                cada grupo se resalta con el color de acento. */}
            {toolbarRow === 'expanded' && (
              <div className="flex h-[58px] items-center gap-1.5 overflow-x-auto">
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={() => applyBlockStyle('h2')}
                  aria-label={t('apuntes.titleStyle')}
                  title={t('apuntes.titleStyleHint')}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${activeBlock === 'h2' ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300' : 'bg-[var(--color-surface-alt)] text-slate-600 dark:text-slate-300'}`}
                >
                  H1
                </button>
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={() => applyBlockStyle('h3')}
                  aria-label={t('apuntes.subtitle')}
                  title={t('apuntes.subtitleHint')}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${activeBlock === 'h3' ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300' : 'bg-[var(--color-surface-alt)] text-slate-600 dark:text-slate-300'}`}
                >
                  H2
                </button>
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={() => applyBlockStyle('div')}
                  aria-label={t('apuntes.normalStyle')}
                  title={t('apuntes.normalStyleHint')}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${activeBlock === 'div' ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300' : 'bg-[var(--color-surface-alt)] text-slate-600 dark:text-slate-300'}`}
                >
                  Aa
                </button>
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={applyBold}
                  aria-label={t('apuntes.bold')}
                  title={t('apuntes.boldHint')}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-black ${boldOn ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300' : 'bg-[var(--color-surface-alt)] text-slate-600 dark:text-slate-300'}`}
                >
                  N
                </button>
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={applyItalic}
                  aria-label={t('apuntes.italic')}
                  title={t('apuntes.italicHint')}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold italic ${italicOn ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300' : 'bg-[var(--color-surface-alt)] text-slate-600 dark:text-slate-300'}`}
                >
                  I
                </button>
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={applyUnderline}
                  aria-label={t('apuntes.underline')}
                  title={t('apuntes.underlineHint')}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold underline decoration-2 underline-offset-2 ${underlineOn ? 'bg-brand-50 text-brand-600 dark:bg-brand-950/40 dark:text-brand-300' : 'bg-[var(--color-surface-alt)] text-slate-600 dark:text-slate-300'}`}
                >
                  U
                </button>
                <div className="mx-0.5 h-5 w-px shrink-0 bg-[var(--color-surface-border)]" />
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={() => setToolbarRow('collapsed')}
                  aria-label={t('common.close')}
                  title={t('common.close')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-alt)] text-slate-500 dark:text-slate-400"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Fila de color: la misma barra se transforma en el sitio,
                igual que la de formato — nada de ventanita aparte flotando
                por encima. Es una segunda entrada al mismo cambio de color
                que ya ofrecía (y sigue ofreciendo) la pestañita de arriba
                de la tarjeta. */}
            {toolbarRow === 'colors' && (
              // px-1 (y no solo el px-3 del envoltorio de fuera): el
              // círculo de "seleccionado" se pinta con un box-shadow que
              // sobresale unos px por FUERA del propio botón — sin este
              // margen extra aquí dentro, ese anillo del primer color de la
              // fila quedaba recortado por el propio borde de scroll
              // (overflow-x-auto), aunque el envoltorio de fuera sí tuviera
              // hueco de sobra a la izquierda.
              <div className="-mx-1 flex h-[58px] items-center gap-2 overflow-x-auto px-1">
                {PALETTE.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onMouseDown={preventToolbarFocusSteal}
                    onClick={() => updateNote({ color: c })}
                    aria-label={t(colorNameKey(c))}
                    title={t(colorNameKey(c))}
                    className="h-[25px] w-[25px] shrink-0 rounded-full"
                    style={{ backgroundColor: c, boxShadow: note.color === c ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${c}` : 'none' }}
                  />
                ))}
                <div className="flex-1" />
                <button
                  type="button"
                  onMouseDown={preventToolbarFocusSteal}
                  onClick={() => setToolbarRow('collapsed')}
                  aria-label={t('common.close')}
                  title={t('common.close')}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-alt)] text-slate-500 dark:text-slate-400"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ayuda del botón de numerar: mismo patrón de portal que el selector
          de color de arriba (ver el comentario grande junto a él) — antes
          iba "absolute" dentro de la barra de abajo, que no tiene
          backdrop-filter así que no le afectaba el bug de apilamiento, pero
          se deja igual de consistente que el resto. */}
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
