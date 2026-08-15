import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useListData } from '../hooks/useListData'
import { supabase } from '../lib/supabaseClient'
import { colorForList } from '../lib/colors'
import ItemsPanel from '../components/ItemsPanel'
import ExpensesPanel from '../components/ExpensesPanel'
import InviteMemberModal from '../components/InviteMemberModal'
import ChatPanel from '../components/ChatPanel'
import RenameListModal from '../components/RenameListModal'
import ConfirmDialog from '../components/ConfirmDialog'
import Avatar from '../components/Avatar'

type Tab = 'notas' | 'gastos' | 'chat'

export default function ListDetailPage() {
  const { listId } = useParams<{ listId: string }>()
  const { user, profile } = useAuth()
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
  } = useListData(listId)
  const [tab, setTab] = useState<Tab>('notas')
  const [showInvite, setShowInvite] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; username: string } | null>(null)

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
  const prevMessageCountRef = useRef(messages.length)
  useEffect(() => {
    if (messages.length > prevMessageCountRef.current) {
      const newOnes = messages.slice(prevMessageCountRef.current)
      const fromOthers = newOnes.some((m) => m.sender_id !== user?.id)
      if (fromOthers && tab !== 'chat' && navigator.vibrate) {
        navigator.vibrate(60)
      }
    }
    prevMessageCountRef.current = messages.length
  }, [messages, tab, user])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-900">
        <p className="text-slate-400">Cargando lista…</p>
      </div>
    )
  }

  if (error || !list) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center dark:bg-slate-900">
        <p className="text-slate-600 dark:text-slate-300">No se pudo cargar la lista. Puede que ya no tengas acceso.</p>
        <button onClick={() => navigate('/lists')} className="text-brand-600 underline dark:text-brand-400">
          Volver a mis listas
        </button>
      </div>
    )
  }

  if (!myMembership || myMembership.status !== 'accepted') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center dark:bg-slate-900">
        <p className="text-slate-600 dark:text-slate-300">
          Tienes una invitación pendiente para "{list.name}". Acéptala desde tus listas.
        </p>
        <button onClick={() => navigate('/lists')} className="text-brand-600 underline dark:text-brand-400">
          Ir a mis listas
        </button>
      </div>
    )
  }

  const isOwner = list.owner_id === user?.id
  const soloList = acceptedMembers.length <= 1
  const listColor = colorForList(list)

  const enableExpenses = async () => {
    await supabase.from('lists').update({ expenses_enabled: true }).eq('id', list.id)
    refetch()
  }

  const removeMember = async () => {
    if (!confirmRemove) return
    await supabase.from('list_members').delete().eq('list_id', list.id).eq('user_id', confirmRemove.userId)
    setConfirmRemove(null)
    refetch()
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16 dark:bg-slate-900">
      <header
        className="sticky top-0 z-10 border-b border-slate-200 bg-gradient-to-r from-white to-brand-50/50 px-4 py-3 backdrop-blur dark:border-slate-700 dark:from-slate-800 dark:to-slate-800"
        style={{ borderTopColor: listColor, borderTopWidth: 3 }}
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/lists')} className="text-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              ‹
            </button>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: listColor }} />
            <div>
              <div className="flex items-center gap-1.5">
                <p className="font-semibold text-slate-900 dark:text-slate-100">{list.name}</p>
                {list.archived_at && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-700 dark:text-slate-300">
                    Archivada
                  </span>
                )}
                {isOwner && (
                  <button
                    onClick={() => setShowRename(true)}
                    className="text-xs text-slate-300 hover:text-brand-600 dark:text-slate-500 dark:hover:text-brand-400"
                    aria-label="Editar lista"
                    title="Editar lista"
                  >
                    ✎
                  </button>
                )}
              </div>
              <button onClick={() => setShowMembers((s) => !s)} className="text-xs text-slate-400 hover:text-brand-600 dark:hover:text-brand-400">
                {acceptedMembers.length} miembro{acceptedMembers.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
          {isOwner && (
            <button
              onClick={() => setShowInvite(true)}
              className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:border-brand-700 dark:text-brand-400 dark:hover:bg-brand-950/40"
            >
              + Invitar
            </button>
          )}
        </div>

        {showMembers && (
          <div className="mx-auto mt-3 max-w-2xl rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200">
                    <Avatar username={m.profile?.username ?? '?'} avatarUrl={m.profile?.avatar_url} size={24} />
                    {m.profile?.username ?? m.user_id}
                    {m.user_id === profile?.id ? ' (tú)' : ''}
                    {m.role === 'owner' ? ' · creador' : ''}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`text-xs ${m.status === 'accepted' ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                      {m.status === 'accepted' ? 'Activo' : 'Invitación pendiente'}
                    </span>
                    {isOwner && m.role !== 'owner' && (
                      <button
                        onClick={() =>
                          setConfirmRemove({ userId: m.user_id, username: m.profile?.username ?? 'este usuario' })
                        }
                        className="rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-500 dark:text-slate-500 dark:hover:bg-red-950/40"
                        aria-label="Eliminar miembro"
                        title="Eliminar miembro"
                      >
                        🗑
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mx-auto mt-3 flex max-w-2xl gap-1">
          <button
            onClick={() => setTab('notas')}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
              tab === 'notas' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Notas
          </button>
          {list.expenses_enabled ? (
            <button
              onClick={() => setTab('gastos')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
                tab === 'gastos' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              Gastos
            </button>
          ) : isOwner ? (
            <button
              onClick={enableExpenses}
              className="flex-1 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-500 hover:border-brand-300 hover:text-brand-600 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-600 dark:hover:text-brand-400"
            >
              Activar gastos
            </button>
          ) : null}
          <button
            onClick={() => setTab('chat')}
            className={`relative flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
              tab === 'chat' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Chat
            {unreadCount > 0 && tab !== 'chat' && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {tab === 'notas' && <ItemsPanel listId={list.id} items={items} soloList={soloList} />}
        {tab === 'gastos' && list.expenses_enabled && (
          <ExpensesPanel listId={list.id} members={members} expenses={expenses} settlements={settlements} soloList={soloList} />
        )}
        {tab === 'chat' && <ChatPanel listId={list.id} messages={messages} />}
      </main>

      {showInvite && (
        <InviteMemberModal listId={list.id} onClose={() => setShowInvite(false)} onInvited={() => refetch()} />
      )}

      {showRename && (
        <RenameListModal
          listId={list.id}
          currentName={list.name}
          currentColor={list.color}
          isArchived={!!list.archived_at}
          onClose={() => setShowRename(false)}
          onSaved={() => {
            setShowRename(false)
            refetch()
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Eliminar miembro"
          message={`¿Eliminar a ${confirmRemove.username} de esta lista? Dejará de tener acceso a las notas, gastos y chat.`}
          confirmLabel="Eliminar"
          danger
          onCancel={() => setConfirmRemove(null)}
          onConfirm={removeMember}
        />
      )}
    </div>
  )
}
