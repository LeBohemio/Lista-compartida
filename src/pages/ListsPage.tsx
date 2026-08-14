import { useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLists } from '../hooks/useLists'
import { supabase } from '../lib/supabaseClient'
import CreateListModal from '../components/CreateListModal'
import Logo from '../components/Logo'
import Avatar from '../components/Avatar'
import ProfileModal from '../components/ProfileModal'
import { colorForList } from '../lib/colors'

export default function ListsPage() {
  const { profile } = useAuth()
  const { lists, invitations, loading, error, refetch } = useLists()
  const [showCreate, setShowCreate] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const navigate = useNavigate()

  const respondInvitation = async (listId: string, accept: boolean) => {
    if (accept) {
      await supabase
        .from('list_members')
        .update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('list_id', listId)
        .eq('user_id', profile!.id)
    } else {
      await supabase.from('list_members').delete().eq('list_id', listId).eq('user_id', profile!.id)
    }
    refetch()
  }

  const deleteOrLeaveList = async (e: MouseEvent, listId: string, name: string, isOwner: boolean) => {
    e.stopPropagation()
    if (isOwner) {
      if (
        !confirm(
          `¿Eliminar definitivamente la lista "${name}"? Se borrará para todos los miembros, junto con sus notas, gastos y chat. Esta acción no se puede deshacer.`,
        )
      )
        return
      const { error: err } = await supabase.from('lists').delete().eq('id', listId)
      if (err) {
        alert(`No se pudo eliminar la lista: ${err.message}`)
        return
      }
    } else {
      if (!confirm(`¿Salir de la lista "${name}"? Dejarás de verla, pero seguirá existiendo para el resto.`)) return
      const { error: err } = await supabase
        .from('list_members')
        .delete()
        .eq('list_id', listId)
        .eq('user_id', profile!.id)
      if (err) {
        alert(`No se pudo salir de la lista: ${err.message}`)
        return
      }
    }
    refetch()
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-gradient-to-r from-white to-brand-50/50 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={34} className="rounded-lg" />
            <div>
              <p className="text-xs text-slate-400">Hola,</p>
              <p className="font-semibold text-slate-900">{profile?.username ?? '…'}</p>
            </div>
          </div>
          <button onClick={() => setShowProfile(true)} className="relative rounded-full" aria-label="Tu perfil">
            <Avatar
              username={profile?.username ?? '?'}
              avatarUrl={profile?.avatar_url}
              size={38}
              className="ring-2 ring-white hover:ring-brand-200"
            />
            {invitations.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-white">
                {invitations.length > 9 ? '9+' : invitations.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        {invitations.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Invitaciones pendientes
            </h2>
            <div className="space-y-3">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200"
                >
                  <div>
                    <p className="font-medium text-slate-900">{inv.name}</p>
                    <p className="text-xs text-slate-500">Te han invitado a esta lista</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondInvitation(inv.id, false)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white"
                    >
                      Rechazar
                    </button>
                    <button
                      onClick={() => respondInvitation(inv.id, true)}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                    >
                      Aceptar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Mis listas</h2>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400">Cargando listas…</p>
          ) : lists.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
              <p className="mb-4 text-slate-500">Todavía no tienes ninguna lista.</p>
              <button
                onClick={() => setShowCreate(true)}
                className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
              >
                Crear tu primera lista
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {lists.map((l) => {
                const isOwner = l.owner_id === profile?.id
                return (
                  <div
                    key={l.id}
                    onClick={() => navigate(`/lists/${l.id}`)}
                    role="button"
                    tabIndex={0}
                    className="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-300"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colorForList(l) }}
                        aria-hidden="true"
                      />
                      <div>
                        <p className="font-medium text-slate-900">{l.name}</p>
                        <p className="text-xs text-slate-500">
                          {isOwner ? 'Creador' : 'Miembro'}
                          {l.expenses_enabled ? ' · Gastos activados' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => deleteOrLeaveList(e, l.id, l.name, isOwner)}
                        aria-label={isOwner ? 'Eliminar lista' : 'Salir de la lista'}
                        title={isOwner ? 'Eliminar lista' : 'Salir de la lista'}
                        className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                      >
                        🗑
                      </button>
                      <span className="text-slate-300">›</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </main>

      <button
        onClick={() => setShowCreate(true)}
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-2xl text-white shadow-lg hover:bg-brand-700"
        aria-label="Crear lista"
      >
        +
      </button>

      {showCreate && (
        <CreateListModal
          onClose={() => setShowCreate(false)}
          onCreated={(listId) => {
            setShowCreate(false)
            navigate(`/lists/${listId}`)
          }}
        />
      )}

      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  )
}
