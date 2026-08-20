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
  // Bug que arreglamos aquí: al entrar en una lista (o al cambiar de una
  // lista a otra), los mensajes se cargan de golpe de forma asíncrona — el
  // array pasa de [] a tener, digamos, 20 mensajes ya existentes. Eso NO es
  // un mensaje nuevo de verdad, es solo el historial cargándose, pero como
  // antes solo comparábamos "¿hay más mensajes que antes?", esa carga
  // inicial se contaba como "llegaron mensajes nuevos" y hacía vibrar el
  // móvil nada más entrar. loadedForListRef marca de qué lista es la carga
  // que ya hemos visto, para saber cuándo estamos ante esa primera carga
  // (de esta lista en concreto) y no vibrar en ese caso — solo a partir de
  // ahí, con mensajes que llegan de verdad mientras ya estás mirando la
  // lista, vibra.
  const prevMessageCountRef = useRef(messages.length)
  const loadedForListRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (loadedForListRef.current !== listId) {
      loadedForListRef.current = listId
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
  }, [messages, tab, user, listId])

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
  // nuevos, hasta que se vuelva a activar. Ver migration_v15.sql.
  const toggleMuted = async () => {
    if (!user || !myMembership) return
    await supabase
      .from('list_members')
      .update({ muted: !myMembership.muted })
      .eq('list_id', list.id)
      .eq('user_id', user.id)
    refetch()
  }

  return (
    <div
      className="min-h-screen pb-16 bg-[var(--color-surface-alt)]"
      style={profile?.background_color ? { backgroundColor: profile.background_color } : undefined}
    >
      <header
        className="sticky top-0 z-10 border-b bg-gradient-to-r from-white to-brand-50/50 px-4 py-3 backdrop-blur border-[var(--color-surface-border)] dark:from-[var(--color-surface)] dark:to-[var(--color-surface)]"
        style={{ borderTopColor: listColor, borderTopWidth: 3 }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/lists')} className="text-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
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
                  className="h-8 w-8 rounded-full object-cover ring-1 ring-[var(--color-surface-border)]"
                />
              ) : (
                <span className="block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: listColor }} />
              )}
            </button>
            <div>
              <div className="flex items-center gap-1.5">
                <p className="font-semibold text-slate-900 dark:text-slate-100">{list.name}</p>
                {isCompleted && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                    {t('lists.completedBadge')}
                  </span>
                )}
                {isOwner && (
                  <button
                    onClick={() => setShowRename(true)}
                    className="rounded-full border border-slate-200 px-2 py-0.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    aria-label={t('list.editTitle')}
                    title={t('list.editTitle')}
                  >
                    ✎
                  </button>
                )}
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
                  className="rounded-full border border-brand-200 px-2 py-0.5 text-sm font-semibold text-brand-600 hover:bg-brand-50 dark:border-brand-800 dark:text-brand-400 dark:hover:bg-brand-950/40"
                  aria-label={isCompleted ? t('menu.reactivate') : t('menu.complete')}
                  title={isCompleted ? t('menu.reactivate') : t('menu.complete')}
                >
                  {isCompleted ? '↩' : '✓'}
                </button>
              </div>
              <button onClick={() => setShowMembers((s) => !s)} className="text-xs text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
                {acceptedMembers.length} {acceptedMembers.length === 1 ? t('list.member') : t('list.membersPlural')}
              </button>
            </div>
          </div>
          {/* Invitar ahora está abierto a cualquier miembro, no solo al
              dueño (ver migration_v24.sql) — como esta pantalla solo se
              llega a pintar siendo ya miembro aceptado (si no, arriba se
              muestra la pantalla de invitación pendiente), no hace falta
              comprobación extra aquí. */}
          <button
            onClick={() => setShowInvite(true)}
            // En claro es un botón "outline" (texto de color sobre fondo
            // blanco/claro real, así que siempre hay contraste de sobra).
            // En oscuro NO usamos texto de color sobre el fondo de la
            // cabecera (--color-surface, calculado a partir del acento):
            // con acentos de tono claro/cálido (amarillo, por ejemplo)
            // ambos acaban pareciéndose y el botón se vuelve invisible.
            // En su lugar, en oscuro pintamos el botón relleno (blanco
            // sobre brand-600), el mismo patrón que ya usan el resto de
            // botones principales de la app — funciona bien pase lo que
            // pase con el acento elegido.
            className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:border-transparent dark:bg-brand-600 dark:text-white dark:hover:bg-brand-700"
          >
            {t('list.inviteButton')}
          </button>
        </div>

        {showMembers && (
          <div className="mx-auto mt-3 max-w-2xl rounded-lg p-3 text-sm bg-[var(--color-surface)]">
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
                        🗑
                      </button>
                    )}
                  </span>
                </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="mx-auto mt-3 flex max-w-2xl gap-1">
          <button
            onClick={() => setTab('notas')}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
              tab === 'notas' ? 'bg-brand-600 text-white' : 'text-slate-600 bg-[var(--color-surface)] dark:text-slate-300'
            }`}
          >
            {t('nav.notes')}
          </button>
          {list.expenses_enabled ? (
            <button
              onClick={() => setTab('gastos')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
                tab === 'gastos' ? 'bg-brand-600 text-white' : 'text-slate-600 bg-[var(--color-surface)] dark:text-slate-300'
              }`}
            >
              {t('nav.expenses')}
            </button>
          ) : (
            // Abierto a cualquier miembro (ver migration_v24.sql) — no
            // solo al dueño como antes.
            <button
              onClick={enableExpenses}
              className="flex-1 rounded-lg border border-dashed px-3 py-2 text-sm font-medium text-slate-500 hover:border-brand-300 hover:text-brand-600 border-[var(--color-surface-border)] dark:text-slate-400 dark:hover:border-brand-600 dark:hover:text-brand-400"
            >
              {t('list.enableExpensesShort')}
            </button>
          )}
          <button
            onClick={() => setTab('chat')}
            className={`relative flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
              tab === 'chat' ? 'bg-brand-600 text-white' : 'text-slate-600 bg-[var(--color-surface)] dark:text-slate-300'
            }`}
          >
            {t('nav.chat')}
            {unreadCount > 0 && tab !== 'chat' && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {isCompleted && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-600 bg-[var(--color-surface)] dark:text-slate-300">
            <span>🔒 {t('lists.readOnlyBanner')}</span>
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
                  {myMembership.muted ? `🔕 ${t('chat.unmute')}` : `🔔 ${t('chat.mute')}`}
                </button>
                <button
                  type="button"
                  onClick={() => setShowChatMenu(true)}
                  aria-label={t('common.more')}
                  className="text-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  ⋮
                </button>
              </div>
            )}
            <ChatPanel target={{ kind: 'list', listId: list.id }} messages={messages} readOnly={isCompleted} />
          </>
        )}

        {showChatMenu && (
          <ContextMenu
            onClose={() => setShowChatMenu(false)}
            actions={[
              {
                label: t('chat.clearChat'),
                icon: '🗑',
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
