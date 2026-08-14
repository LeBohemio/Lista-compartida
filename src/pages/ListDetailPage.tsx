import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useListData } from '../hooks/useListData'
import { supabase } from '../lib/supabaseClient'
import ItemsPanel from '../components/ItemsPanel'
import ExpensesPanel from '../components/ExpensesPanel'
import InviteMemberModal from '../components/InviteMemberModal'

type Tab = 'notas' | 'gastos'

export default function ListDetailPage() {
  const { listId } = useParams<{ listId: string }>()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const { list, members, acceptedMembers, myMembership, items, expenses, settlements, loading, error, refetch } =
    useListData(listId)
  const [tab, setTab] = useState<Tab>('notas')
  const [showInvite, setShowInvite] = useState(false)
  const [showMembers, setShowMembers] = useState(false)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-400">Cargando lista…</p>
      </div>
    )
  }

  if (error || !list) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <p className="text-slate-600">No se pudo cargar la lista. Puede que ya no tengas acceso.</p>
        <button onClick={() => navigate('/lists')} className="text-brand-600 underline">
          Volver a mis listas
        </button>
      </div>
    )
  }

  if (!myMembership || myMembership.status !== 'accepted') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <p className="text-slate-600">Tienes una invitación pendiente para "{list.name}". Acéptala desde tus listas.</p>
        <button onClick={() => navigate('/lists')} className="text-brand-600 underline">
          Ir a mis listas
        </button>
      </div>
    )
  }

  const isOwner = list.owner_id === user?.id

  const enableExpenses = async () => {
    await supabase.from('lists').update({ expenses_enabled: true }).eq('id', list.id)
    refetch()
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/lists')} className="text-xl text-slate-400 hover:text-slate-600">
              ‹
            </button>
            <div>
              <p className="font-semibold text-slate-900">{list.name}</p>
              <button onClick={() => setShowMembers((s) => !s)} className="text-xs text-slate-400 hover:text-brand-600">
                {acceptedMembers.length} miembro{acceptedMembers.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
          {isOwner && (
            <button
              onClick={() => setShowInvite(true)}
              className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
            >
              + Invitar
            </button>
          )}
        </div>

        {showMembers && (
          <div className="mx-auto mt-3 max-w-2xl rounded-lg bg-slate-50 p-3 text-sm">
            <ul className="space-y-1">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between">
                  <span className="text-slate-700">
                    {m.profile?.username ?? m.user_id}
                    {m.user_id === profile?.id ? ' (tú)' : ''}
                    {m.role === 'owner' ? ' · creador' : ''}
                  </span>
                  <span className={`text-xs ${m.status === 'accepted' ? 'text-green-600' : 'text-amber-600'}`}>
                    {m.status === 'accepted' ? 'Activo' : 'Invitación pendiente'}
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
              tab === 'notas' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            Notas
          </button>
          {list.expenses_enabled ? (
            <button
              onClick={() => setTab('gastos')}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
                tab === 'gastos' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              Gastos
            </button>
          ) : isOwner ? (
            <button
              onClick={enableExpenses}
              className="flex-1 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-500 hover:border-brand-300 hover:text-brand-600"
            >
              Activar gastos
            </button>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {tab === 'notas' && <ItemsPanel listId={list.id} items={items} />}
        {tab === 'gastos' && list.expenses_enabled && (
          <ExpensesPanel listId={list.id} members={members} expenses={expenses} settlements={settlements} />
        )}
      </main>

      {showInvite && (
        <InviteMemberModal listId={list.id} onClose={() => setShowInvite(false)} onInvited={() => refetch()} />
      )}
    </div>
  )
}
