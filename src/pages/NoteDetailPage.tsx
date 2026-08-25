import { useEffect, useRef, useState, type ChangeEvent } from 'react'
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
import { CloseIcon, HelpCircleIcon, NumberedListIcon, TrashIcon } from '../components/icons'
import { PALETTE, colorForNote, colorNameKey } from '../lib/colors'

const AUTOSAVE_DELAY_MS = 800

export default function NoteDetailPage() {
  const { noteId } = useParams<{ noteId: string }>()
  const { user, profile } = useAuth()
  const { t } = useLanguage()
  const { showError } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const { note, members, isOwner, loading, error, refetch, updateNote } = useNoteDetail(noteId)

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [showMembers, setShowMembers] = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showNumberedHelp, setShowNumberedHelp] = useState(false)
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
  const bodyAreaRef = useRef<HTMLTextAreaElement>(null)
  // Tras numerar (o quitar la numeración), el textarea es controlado por
  // React así que no podemos tocar su selección directamente en el mismo
  // gesto — guardamos aquí dónde debe quedar el cursor y la aplicamos en el
  // useEffect de más abajo, una vez el nuevo valor ya está pintado.
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null)

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
    if (note && !bodyFocusedRef.current) setBody(note.body)
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

  const handleBodyChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setBody(value)
    scheduleSave({ body: value }, bodyTimerRef)
  }

  useEffect(() => {
    const pending = pendingSelectionRef.current
    if (!pending) return
    pendingSelectionRef.current = null
    const el = bodyAreaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(pending.start, pending.end)
  }, [body])

  // Numera (o, si ya estaban numeradas, quita la numeración de) solo las
  // líneas tocadas por la selección actual — o, si no hay nada seleccionado,
  // solo la línea donde está el cursor. A propósito no toca el resto de la
  // nota: pedir "numerar" no debe convertir toda la nota en una lista
  // obligatoria, solo el trozo que de verdad quieres numerar ahora mismo.
  const toggleNumberedList = () => {
    const el = bodyAreaRef.current
    if (!el) return
    const { selectionStart, selectionEnd, value } = el

    // Si la selección incluye el salto de línea final (por ejemplo, al
    // seleccionar arrastrando hasta el principio de la siguiente línea), no
    // contamos esa línea siguiente como parte del bloque a numerar.
    const effectiveEnd =
      selectionEnd > selectionStart && value[selectionEnd - 1] === '\n' ? selectionEnd - 1 : selectionEnd

    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
    const nextNewline = value.indexOf('\n', effectiveEnd)
    const lineEnd = nextNewline === -1 ? value.length : nextNewline

    const block = value.slice(lineStart, lineEnd)
    const lines = block.split('\n')
    const contentLines = lines.filter((line) => line.trim() !== '')
    const alreadyNumbered = contentLines.length > 0 && contentLines.every((line) => /^\d+\.\s/.test(line))

    let counter = 1
    const newLines = lines.map((line) => {
      if (line.trim() === '') return line
      if (alreadyNumbered) return line.replace(/^\d+\.\s/, '')
      return `${counter++}. ${line}`
    })
    const newBlock = newLines.join('\n')

    const newValue = value.slice(0, lineStart) + newBlock + value.slice(lineEnd)
    pendingSelectionRef.current = { start: lineStart, end: lineStart + newBlock.length }
    setBody(newValue)
    scheduleSave({ body: newValue }, bodyTimerRef)
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
          {isOwner && (
            <button
              onClick={() => setShowInvite(true)}
              className="shrink-0 rounded-full bg-white px-3 py-1.5 text-sm font-medium text-[var(--color-brand-700)] shadow-[0_8px_18px_-8px_rgba(20,21,26,0.4)]"
            >
              {t('list.inviteButton')}
            </button>
          )}
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
              onClick={() => setShowColorPicker((s) => !s)}
              aria-label={t('apuntes.changeColor')}
              title={t('apuntes.changeColor')}
              className="absolute left-6 top-0 h-2.5 w-14 rounded-b-md"
              style={{ backgroundColor: colorForNote(note) }}
            />
            {showColorPicker && (
              <>
                {/* Fondo invisible a pantalla completa, solo para poder
                    cerrar el selector tocando fuera — el resto de menús
                    contextuales de la app (ver ContextMenu.tsx) hacen lo
                    mismo. */}
                {createPortal(
                  <div className="fixed inset-0 z-[5]" onClick={() => setShowColorPicker(false)} />,
                  document.body,
                )}
                <div
                  className="glass-panel absolute left-4 top-4 z-10 flex flex-wrap gap-2 rounded-2xl p-3 shadow-[0_16px_40px_-16px_rgba(20,21,26,0.45)]"
                  style={{ width: '184px' }}
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
              </>
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
            {/* Numerar solo actúa sobre la línea del cursor, o sobre las
                líneas que tengas seleccionadas — nunca sobre toda la nota
                de golpe (ver toggleNumberedList). Pulsarlo otra vez sobre
                líneas ya numeradas quita la numeración. */}
            <div className="relative mb-2 flex items-center gap-1">
              <button
                type="button"
                onClick={toggleNumberedList}
                aria-label={t('apuntes.numberedList')}
                title={t('apuntes.numberedListHint')}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/5"
              >
                <NumberedListIcon className="h-4 w-4" />
                {t('apuntes.numberedList')}
              </button>
              <button
                type="button"
                onClick={() => setShowNumberedHelp((s) => !s)}
                aria-label={t('apuntes.numberedListHelpCta')}
                title={t('apuntes.numberedListHelpCta')}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-500 dark:text-slate-600 dark:hover:bg-white/5 dark:hover:text-slate-300"
              >
                <HelpCircleIcon className="h-4 w-4" />
              </button>
              {showNumberedHelp && (
                <>
                  {/* Mismo patrón que el selector de color de arriba: un
                      fondo invisible a pantalla completa solo para poder
                      cerrar tocando fuera. */}
                  {createPortal(
                    <div className="fixed inset-0 z-[5]" onClick={() => setShowNumberedHelp(false)} />,
                    document.body,
                  )}
                  <div
                    className="glass-panel absolute left-0 top-full z-10 mt-1 rounded-xl p-3 text-xs leading-relaxed text-slate-600 shadow-[0_16px_40px_-16px_rgba(20,21,26,0.45)] dark:text-slate-300"
                    style={{ width: '230px' }}
                  >
                    {t('apuntes.numberedListHelpText')}
                  </div>
                </>
              )}
            </div>
            <textarea
              ref={bodyAreaRef}
              value={body}
              onChange={handleBodyChange}
              onFocus={() => (bodyFocusedRef.current = true)}
              onBlur={() => {
                bodyFocusedRef.current = false
              }}
              placeholder={t('apuntes.bodyPlaceholder')}
              rows={16}
              className="w-full resize-none border-0 bg-transparent px-0 text-base leading-relaxed text-slate-800 focus:outline-none focus:ring-0 dark:text-slate-100"
            />
          </div>
        </div>
      </main>

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
