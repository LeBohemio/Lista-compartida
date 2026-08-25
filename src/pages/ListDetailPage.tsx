import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useListData } from '../hooks/useListData'
import { supabase } from '../lib/supabaseClient'
import { colorForList } from '../lib/colors'
import ItemsPanel from '../components/ItemsPanel'
import ExpensesPanel from '../components/ExpensesPanel'
import InviteMemberModal from '../components/InviteMemberModal'
import ChatPanel from '../components/ChatPanel'
import RenameListModal from '../components/RenameListModal'
import ChangeListPhotoModal from '../components/ChangeListPhotoModal'
import ConfirmDialog from '../components/ConfirmDialog'
import ContextMenu from '../components/ContextMenu'
import Toast from '../components/Toast'
import Avatar from '../components/Avatar'
import ContactCardSheet from '../components/ContactCardSheet'
import MuteDurationMenu from '../components/MuteDurationMenu'
import { BellIcon, BellOffIcon, CheckIcon, EditIcon, LockIcon, MoreIcon, TrashIcon, UndoIcon } from '../components/icons'
import { isCurrentlyMuted, muteUntilFor, type MuteDuration } from '../lib/mute'
import type { Profile } from '../lib/types'

type Tab = 'notas' | 'gastos' | 'chat'

export default function ListDetailPage() {
  const { listId } = useParams<{ listId: string }>()
  const { user, profile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const {
    list,
    members,
    acceptedMembers,
    myMembership,
    items,
    expenses,
    settlements,
    messages,
    loading,
    error,
    refetch,
    clearChat,
  } = useListData(listId)
  // Al tocar un aviso de notificación push (?tab=chat, por ejemplo) hay que
  // aterrizar directamente en esa pestaña, no siempre en "notas". Solo se
  // mira al arrancar la página — search param se ignora si vuelves a
  // cambiar de pestaña a mano.
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab')
  const [tab, setTab] = useState<Tab>(
    initialTab === 'gastos' || initialTab === 'chat' ? initialTab : 'notas',
  )
  const [showInvite, setShowInvite] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [showChangePhoto, setShowChangePhoto] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; username: string } | null>(null)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [cardTarget, setCardTarget] = useState<Profile | null>(null)
  const [showChatMenu, setShowChatMenu] = useState(false)
  const [showMuteMenu, setShowMuteMenu] = useState(false)
  const [confirmClearChat, setConfirmClearChat] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Las acciones que se quedan solo para quien creó la lista (eliminar
  // miembros, marcar como completada/reactivar) ya no ocultan el botón al
  // resto de miembros — lo ven, pero al tocarlo les sale este aviso en vez
  // de hacer el cambio. Ver migration_v24.sql para lo que sí se abrió a
  // cualquier miembro (foto, invitar, activar gastos).
  const showOwnerOnlyToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMessage(message)
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 2500)
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  const unreadCount = useMemo(() => {
    if (!user || !myMembership) return 0
    const lastRead = myMembership.last_read_message_at ? new Date(myMembership.last_read_message_at).getTime() : 0
    return messages.filter((m) => m.sender_id !== user.id && new Date(m.created_at).getTime() > lastRead).length
  }, [messages, myMembership, user])

  useEffect(() => {
    if (tab !== 'chat' || !user || !listId || messages.length === 0) return
    supabase
      .from('list_members')
      .update({ last_read_message_at: new Date().toISOString() })
      .eq('list_id', listId)
      .eq('user_id', user.id)
      .then(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, messages.length, user, listId])

  // Vibración sutil cuando llega un mensaje nuevo de otra persona mientras no
  // estás mirando la pestaña de chat, para enterarte sin tener que comprobarlo.
  //
  // Bug (reportado de nuevo — el guard anterior no bastaba): al entrar en
  // una lista, los mensajes se cargan de golpe de forma asíncrona — el
  // array pasa de [] a tener, digamos, 20 mensajes ya existentes. Eso NO es
  // un mensaje nuevo de verdad, es solo el historial cargándose. El guard
  // anterior (loadedForListRef) solo se saltaba la vibración en la PRIMERA
  // ejecución de este efecto — pero mientras "loading" sigue en true esa
  // primera ejecución todavía ve el array vacío ([]), y la carga real de
  // mensajes llega en una ejecución POSTERIOR del efecto, que ya no
  // coincidía con "primera ejecución" y sí contaba como "llegaron mensajes
  // nuevos" → vibraba nada más abrir la lista. Ahora el guard se basa en
  // "loading" de verdad: no se arma la vibración hasta que useListData
  // termina de cargar esta lista por primera vez, venga la carga en una o
  // en varias ejecuciones del efecto.
  const prevMessageCountRef = useRef(messages.length)
  const armedForListRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (loading || armedForListRef.current !== listId) {
      if (!loading) armedForListRef.current = listId
      prevMessageCountRef.current = messages.length
      return
    }
    if (messages.length > prevMessageCountRef.current) {
      const newOnes = messages.slice(prevMessageCountRef.current)
      const fromOthers = newOnes.some((m) => m.sender_id !== user?.id)
      if (fromOthers && tab !== 'chat' && navigator.vibrate) {
        navigator.vibrate(60)
      }
    }
    prevMessageCountRef.current = messages.length
  }, [messages, tab, user, listId, loading])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-alt)]">
        <p className="text-slate-400">{t('list.loading')}</p>
      </div>
    )
  }

  if (error || !list) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center bg-[var(--color-surface-alt)]">
        <p className="text-slate-600 dark:text-slate-300">{t('list.errorLoad')}</p>
        <button onClick={() => navigate('/lists')} className="text-brand-600 underline dark:text-brand-400">
          {t('list.backToMyLists')}
        </button>
      </div>
    )
  }

  if (!myMembership || myMembership.status !== 'accepted') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center bg-[var(--color-surface-alt)]">
        <p className="text-slate-600 dark:text-slate-300">{t('list.pendingInviteBody', { name: list.name })}</p>
        <button onClick={() => navigate('/lists')} className="text-brand-600 underline dark:text-brand-400">
          {t('list.goToMyLists')}
        </button>
      </div>
    )
  }

  const isOwner = list.owner_id === user?.id
  const soloList = acceptedMembers.length <= 1
  const listColor = colorForList(list)
  const isCompleted = !!list.archived_at
  const showTabsRow = tab !== 'chat'
  // TypeScript reduce el tipo de "tab" a 'notas' | 'gastos' dentro del
  // bloque "showTabsRow &&" de abajo (siempre es cierto ahí), así que la
  // comparación "tab === 'chat'" del propio botón "Chat" da error de
  // compilación aunque en tiempo de ejecución sea perfectamente válida.
  // Truco: una copia con el tipo "Tab" escrito a mano, para que TypeScript
  // no la reduzca y podamos seguir comparando con 'chat' ahí dentro.
  const activeTab: Tab = tab

  // Activar gastos: abierto a cualquier miembro (antes solo al dueño) — va
  // por una función RPC en vez de un update directo a "lists" para no tener
  // que abrir el resto de columnas de la tabla a nadie más que al dueño.
  // Ver migration_v24.sql.
  const enableExpenses = async () => {
    const { error: err } = await supabase.rpc('enable_list_expenses', { p_list_id: list.id })
    if (err) {
      showOwnerOnlyToast(err.message)
      return
    }
    refetch()
  }

  const completeList = async () => {
    setConfirmComplete(false)
    await supabase.from('lists').update({ archived_at: new Date().toISOString() }).eq('id', list.id)
    refetch()
  }

  const reactivateList = async () => {
    await supabase.from('lists').update({ archived_at: null }).eq('id', list.id)
    refetch()
  }

  const removeMember = async () => {
    if (!confirmRemove) return
    await supabase.from('list_members').delete().eq('list_id', list.id).eq('user_id', confirmRemove.userId)
    setConfirmRemove(null)
    refetch()
  }

  // Silenciar SOLO el chat de esta lista (no toca las demás listas ni otros
  // tipos de aviso) — deja de sonar/avisar por push aunque lleguen mensajes
  // nuevos, hasta que se vuelva a activar (o hasta que pase la duración
  // elegida). Ver migration_v15.sql y, para la duración, migration_v27.sql.
  const toggleMuted = () => {
    if (!user || !myMembership) return
    if (isCurrentlyMuted(myMembership.muted, myMembership.muted_until)) {
      void applyMute(null)
    } else {
      setShowMuteMenu(true)
    }
  }

  const applyMute = async (duration: MuteDuration | null) => {
    if (!user || !myMembership) return
    await supabase
      .from('list_members')
      .update(duration ? { muted: true, muted_until: muteUntilFor(duration) } : { muted: false, muted_until: null })
      .eq('list_id', list.id)
      .eq('user_id', user.id)
    refetch()
  }

  return (
    <div
      className="min-h-screen pb-16"
      style={profile?.background_color ? { backgroundColor: profile.background_color } : undefined}
    >
      {/* Cabecera pegada de verdad al borde de arriba (antes era una
          "burbuja" de cristal flotante, separada del borde con top-3+mx-3
          — pedido explícito: que no lo parezca). Solo el borde inferior se
          queda redondeado; el resto va a bordes vivos, a todo el ancho. */}
      {/* HEADER_ACCENT_FLOAT: mismo patrón que en el resto de cabeceras — ver
          el comentario completo en SettingsPage.tsx. El color propio de la
          lista se queda solo en el punto (o la miniatura) de al lado del
          nombre, como distintivo — la cabecera en sí ya lleva el acento del
          usuario, no el de la lista. */}
      <header
        className="sticky top-0 z-10 overflow-hidden bg-[var(--color-brand-700)] px-4 pb-3.5"
        style={{ paddingTop: 'calc(0.9rem + env(safe-area-inset-top))' }}
      >
        <span className="pointer-events-none absolute -right-8 -top-16 h-36 w-36 rounded-full bg-[var(--color-brand-400)] opacity-50 blur-2xl" />
        <span className="pointer-events-none absolute -bottom-10 right-14 h-24 w-24 rounded-full bg-[var(--color-brand-300)] opacity-30 blur-xl" />
        {/* Fila superior a prueba de nombres largos: el bloque de la
            izquierda (foto + nombre + editar + completar) es el que se
            encoge y trunca el nombre con "…" cuando falta sitio — el botón
            "Invitar" lleva shrink-0 y nunca se mueve ni se aprieta. Antes,
            sin min-w-0/truncate en el nombre ni shrink-0 en Invitar, un
            nombre de lista largo podía apretar tanto la fila que "Editar" y
            "Completar" acababan cayendo debajo de "Invitar" — bug real
            reportado, arreglado con esta estructura en vez de con un ajuste
            visual suelto. */}
        <div className="relative mx-auto flex max-w-2xl items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {/* Dentro del chat no se ve la fila de pestañas (Tareas /
                Gastos / Chat) — así que la flecha de atrás pasa a ser la
                única forma de volver a Tareas, en vez de salir de la lista
                del todo. Fuera del chat sigue llevando a "Mis listas" como
                siempre. */}
            <button
              onClick={() => (tab === 'chat' ? setTab('notas') : navigate('/lists'))}
              className="shrink-0 text-xl text-white/80 hover:text-white"
            >
              ‹
            </button>
            {/* La foto de la lista ahora la puede cambiar cualquier
                miembro, no solo el dueño (ver migration_v24.sql) — por eso
                es un botón para todos, a diferencia del ✎ de más abajo
                (nombre/color/moneda), que sigue siendo solo del dueño. */}
            <button
              type="button"
              onClick={() => setShowChangePhoto(true)}
              className="shrink-0"
              aria-label={t('list.changePhoto')}
              title={t('list.changePhoto')}
            >
              {list.photo_url ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <img
                  src={list.photo_url}
                  alt={list.name}
                  className="h-8 w-8 rounded-full object-cover ring-2 ring-white/50"
                />
              ) : (
                // Antes era un puntito de 10px, casi invisible — se pedía
                // agrandarlo al mismo tamaño (32px) que ya usa la foto real
                // de la lista un poco más arriba y el avatar del chat
                // directo (ver DirectChatPage.tsx), para que invite a
                // tocarlo igual que cualquier otra foto de la app.
                <span
                  className="block h-8 w-8 rounded-full ring-2 ring-white/50"
                  style={{ backgroundColor: listColor }}
                />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="min-w-0 truncate font-display font-medium text-white">{list.name}</p>
                {isCompleted && (
                  <span className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium text-white">
                    {t('lists.completedBadge')}
                  </span>
                )}
                {isOwner && (
                  <button
                    onClick={() => setShowRename(true)}
                    className="flex shrink-0 items-center rounded-full border border-white/40 p-1 text-white hover:bg-white/10"
                    aria-label={t('list.editTitle')}
                    title={t('list.editTitle')}
                  >
                    <EditIcon className="h-3.5 w-3.5" />
                  </button>
                )}
                {/* En el chat la cabecera se queda solo con foto, nombre,
                    editar, miembros e invitar — el botón de completar se
                    esconde con el resto de acciones de "Tareas". */}
                {tab !== 'chat' && (
                  <button
                    onClick={() => {
                      if (!isOwner) {
                        showOwnerOnlyToast(t('list.ownerOnlyComplete'))
                        return
                      }
                      if (isCompleted) {
                        reactivateList()
                      } else {
                        setConfirmComplete(true)
                      }
                    }}
                    className="flex shrink-0 items-center rounded-full border border-white/40 p-1 text-white hover:bg-white/10"
                    aria-label={isCompleted ? t('menu.reactivate') : t('menu.complete')}
                    title={isCompleted ? t('menu.reactivate') : t('menu.complete')}
                  >
                    {isCompleted ? <UndoIcon className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
              <button onClick={() => setShowMembers((s) => !s)} className="text-xs text-white/75 hover:text-white">
                {acceptedMembers.length} {acceptedMembers.length === 1 ? t('list.member') : t('list.membersPlural')}
              </button>
            </div>
          </div>
          {/* Invitar ahora está abierto a cualquier miembro, no solo al
              dueño (ver migration_v24.sql) — como esta pantalla solo se
              llega a pintar siendo ya miembro aceptado (si no, arriba se
              muestra la pantalla de invitación pendiente), no hace falta
              comprobación extra aquí. Botón siempre relleno con degradado
              (antes era "outline" en claro y relleno en oscuro) — un solo
              tratamiento que funciona con cualquier acento elegido. shrink-0
              para que nunca sea él quien ceda espacio (ver comentario de
              arriba). */}
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
                const isSelf = m.user_id === profile?.id
                return (
                <li key={m.user_id} className="flex items-center justify-between">
                  {isSelf || !m.profile ? (
                    <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                      <Avatar username={m.profile?.username ?? '?'} avatarUrl={m.profile?.avatar_url} size={24} />
                      {m.profile?.username ?? m.user_id}
                      {isSelf ? ` ${t('expenses.you')}` : ''}
                      {m.role === 'owner' ? t('list.ownerSuffix') : ''}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCardTarget(m.profile!)}
                      className="flex items-center gap-2 rounded text-left text-slate-700 hover:text-brand-600 dark:text-slate-200 dark:hover:text-brand-400"
                    >
                      <Avatar username={m.profile.username} avatarUrl={m.profile.avatar_url} size={24} enlargeOnClick={false} />
                      {m.profile.username}
                      {m.role === 'owner' ? t('list.ownerSuffix') : ''}
                    </button>
                  )}
                  <span className="flex items-center gap-2">
                    <span className={`text-xs ${m.status === 'accepted' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {m.status === 'accepted' ? t('member.statusActive') : t('member.statusPending')}
                    </span>
                    {m.role !== 'owner' && (
                      <button
                        onClick={() =>
                          isOwner
                            ? setConfirmRemove({ userId: m.user_id, username: m.profile?.username ?? t('list.thisUser') })
                            : showOwnerOnlyToast(t('list.ownerOnlyRemoveMember'))
                        }
                        className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-950/40"
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

        {/* Pedido explícito: dentro del chat no se ve este selector de
            Tareas/Gastos/Chat — la flecha de atrás (arriba) es la que
            saca de la conversación. */}
        {showTabsRow && (
        <div className="relative mx-auto mt-3 flex max-w-2xl gap-1 rounded-full bg-white/10 p-1">
          <button
            onClick={() => setTab('notas')}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${
              tab === 'notas'
                ? 'bg-white text-[var(--color-brand-700)] shadow-[0_8px_16px_-8px_rgba(20,21,26,0.4)]'
                : 'text-white/75'
            }`}
          >
            {t('nav.notes')}
          </button>
          {list.expenses_enabled ? (
            <button
              onClick={() => setTab('gastos')}
              className={`flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${
                tab === 'gastos'
                  ? 'bg-white text-[var(--color-brand-700)] shadow-[0_8px_16px_-8px_rgba(20,21,26,0.4)]'
                  : 'text-white/75'
              }`}
            >
              {t('nav.expenses')}
            </button>
          ) : (
            // Abierto a cualquier miembro (ver migration_v24.sql) — no
            // solo al dueño como antes.
            <button
              onClick={enableExpenses}
              className="flex-1 rounded-full border border-dashed border-white/40 px-3 py-2 text-sm font-medium text-white/75 hover:border-white hover:text-white"
            >
              {t('list.enableExpensesShort')}
            </button>
          )}
          <button
            onClick={() => setTab('chat')}
            className={`relative flex-1 rounded-full px-3 py-2 text-sm font-medium transition ${
              activeTab === 'chat'
                ? 'bg-white text-[var(--color-brand-700)] shadow-[0_8px_16px_-8px_rgba(20,21,26,0.4)]'
                : 'text-white/75'
            }`}
          >
            {t('nav.chat')}
            {unreadCount > 0 && activeTab !== 'chat' && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-[var(--color-brand-700)]">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
        )}
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {isCompleted && (
          <div className="glass-panel mb-4 flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 dark:text-slate-300">
            <span className="flex items-center gap-1.5">
              <LockIcon className="h-4 w-4 shrink-0" />
              {t('lists.readOnlyBanner')}
            </span>
            <button
              onClick={() => (isOwner ? reactivateList() : showOwnerOnlyToast(t('list.ownerOnlyComplete')))}
              className="shrink-0 font-semibold text-brand-600 hover:underline dark:text-brand-400"
            >
              {t('menu.reactivate')}
            </button>
          </div>
        )}
        {tab === 'notas' && (
          <ItemsPanel
            listId={list.id}
            items={items}
            soloList={soloList}
            readOnly={isCompleted}
            currency={list.currency}
            members={members}
            expensesEnabled={list.expenses_enabled}
            onCompleteList={isOwner && !isCompleted ? () => setConfirmComplete(true) : undefined}
          />
        )}
        {tab === 'gastos' && list.expenses_enabled && (
          <ExpensesPanel
            listId={list.id}
            currency={list.currency}
            members={members}
            expenses={expenses}
            settlements={settlements}
            soloList={soloList}
            readOnly={isCompleted}
          />
        )}
        {tab === 'chat' && (
          <>
            {myMembership && (
              <div className="mb-3 flex items-center justify-end gap-3">
                <button
                  onClick={toggleMuted}
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-brand-600 dark:hover:text-brand-400"
                >
                  {isCurrentlyMuted(myMembership.muted, myMembership.muted_until) ? (
                    <BellOffIcon className="h-3.5 w-3.5" />
                  ) : (
                    <BellIcon className="h-3.5 w-3.5" />
                  )}
                  {isCurrentlyMuted(myMembership.muted, myMembership.muted_until) ? t('chat.unmute') : t('chat.mute')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowChatMenu(true)}
                  aria-label={t('common.more')}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <MoreIcon className="h-5 w-5" />
                </button>
              </div>
            )}
            <ChatPanel target={{ kind: 'list', listId: list.id }} messages={messages} readOnly={isCompleted} />
          </>
        )}

        {showMuteMenu && (
          <MuteDurationMenu
            onClose={() => setShowMuteMenu(false)}
            onPick={(duration) => {
              setShowMuteMenu(false)
              void applyMute(duration)
            }}
          />
        )}

        {showChatMenu && (
          <ContextMenu
            onClose={() => setShowChatMenu(false)}
            actions={[
              {
                label: t('chat.clearChat'),
                icon: <TrashIcon className="h-5 w-5" />,
                danger: true,
                onSelect: () => setConfirmClearChat(true),
              },
            ]}
          />
        )}

        {confirmClearChat && (
          <ConfirmDialog
            title={t('chat.clearChatTitle')}
            message={t('chat.clearChatConfirm')}
            confirmLabel={t('chat.clearChat')}
            danger
            onConfirm={async () => {
              setConfirmClearChat(false)
              await clearChat()
            }}
            onCancel={() => setConfirmClearChat(false)}
          />
        )}
      </main>

      {showInvite && (
        <InviteMemberModal
          listId={list.id}
          existingMemberIds={members.map((m) => m.user_id)}
          onClose={() => setShowInvite(false)}
          onInvited={() => refetch()}
        />
      )}

      {showRename && (
        <RenameListModal
          listId={list.id}
          currentName={list.name}
          currentColor={list.color}
          currentCurrency={list.currency}
          currentPhotoUrl={list.photo_url}
          onClose={() => setShowRename(false)}
          onSaved={() => {
            setShowRename(false)
            refetch()
          }}
        />
      )}

      {confirmComplete && (
        <ConfirmDialog
          title={t('dialogs.completeTitle')}
          message={t('dialogs.completeMessage')}
          confirmLabel={t('dialogs.completeConfirm')}
          onCancel={() => setConfirmComplete(false)}
          onConfirm={completeList}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title={t('list.removeMember')}
          message={t('list.removeMemberConfirm', { name: confirmRemove.username })}
          confirmLabel={t('menu.delete')}
          danger
          onCancel={() => setConfirmRemove(null)}
          onConfirm={removeMember}
        />
      )}

      {cardTarget && <ContactCardSheet targetProfile={cardTarget} onClose={() => setCardTarget(null)} />}

      {showChangePhoto && (
        <ChangeListPhotoModal
          listId={list.id}
          listName={list.name}
          currentPhotoUrl={list.photo_url}
          onClose={() => setShowChangePhoto(false)}
          onSaved={() => {
            setShowChangePhoto(false)
            refetch()
          }}
        />
      )}

      {toastMessage && <Toast message={toastMessage} />}
    </div>
  )
}
