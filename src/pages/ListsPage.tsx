import { useMemo, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLists } from '../hooks/useLists'
import { supabase } from '../lib/supabaseClient'
import CreateListModal from '../components/CreateListModal'
import Logo from '../components/Logo'
import Avatar from '../components/Avatar'
import ProfileModal from '../components/ProfileModal'
import ConfirmDialog from '../components/ConfirmDialog'
import { colorForList } from '../lib/colors'
import type { ListWithMembership } from '../lib/types'

export default function ListsPage() {
  const { profile } = useAuth()
  const { lists, invitations, itemStats, memberAvatars, loading, error, refetch, togglePin } = useLists()
  const [showCreate, setShowCreate] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<{ listId: string; name: string; isOwner: boolean } | null>(null)
  const navigate = useNavigate()

  const activeLists = useMemo(() => lists.filter((l) => !l.archived_at), [lists])
  const archivedLists = useMemo(() => lists.filter((l) => l.archived_at), [lists])

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

  const requestDeleteOrLeave = (e: MouseEvent, listId: string, name: string, isOwner: boolean) => {
    e.stopPropagation()
    setActionError(null)
    setConfirmTarget({ listId, name, isOwner })
  }

  const confirmDeleteOrLeave = async () => {
    if (!confirmTarget) return
    const { listId, isOwner } = confirmTarget
    setConfirmTarget(null)
    if (isOwner) {
      const { error: err } = await supabase.from('lists').delete().eq('id', listId)
      if (err) {
        setActionError(`No se pudo eliminar la lista: ${err.message}`)
        return
      }
    } else {
      const { error: err } = await supabase
        .from('list_members')
        .delete()
        .eq('list_id', listId)
        .eq('user_id', profile!.id)
      if (err) {
        setActionError(`No se pudo salir de la lista: ${err.message}`)
        return
      }
    }
    refetch()
  }

  const duplicateList = async (e: MouseEvent, l: ListWithMembership) => {
    e.stopPropagation()
    setActionError(null)
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_list_with_owner', {
      p_name: `${l.name} (copia)`,
      p_expenses_enabled: l.expenses_enabled,
    })
    const newList = rpcData as { id: string } | null
    if (rpcErr || !newList) {
      setActionError(`No se pudo duplicar la lista: ${rpcErr?.message ?? 'error desconocido'}`)
      return
    }

    await supabase.from('lists').update({ color: l.color }).eq('id', newList.id)

    const { data: sourceItems } = await supabase.from('items').select('content').eq('list_id', l.id)
    if (sourceItems && sourceItems.length > 0 && profile) {
      const rows = sourceItems.map((it: { content: string }) => ({
        list_id: newList.id,
        content: it.content,
        created_by: profile.id,
      }))
      await supabase.from('items').insert(rows)
    }

    refetch()
    navigate(`/lists/${newList.id}`)
  }

  const renderListRow = (l: (typeof lists)[number]) => {
    const isOwner = l.owner_id === profile?.id
    const stats = itemStats[l.id]
    const avatars = memberAvatars[l.id] ?? []
    const progressPct = stats && stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : null

    return (
      <div
        key={l.id}
        onClick={() => navigate(`/lists/${l.id}`)}
        role="button"
        tabIndex={0}
        className="w-full rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-brand-300 dark:bg-slate-800 dark:ring-slate-700"
      >
        <div className="flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorForList(l) }}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900 dark:text-slate-100">{l.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isOwner ? 'Creador' : 'Miembro'}
                {l.expenses_enabled ? ' · Gastos activados' : ''}
                {l.archived_at ? ' · Archivada' : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {avatars.length > 1 && (
              <div className="mr-1 flex items-center">
                {avatars.slice(0, 4).map((p, idx) => (
                  <Avatar
                    key={p.id}
                    username={p.username}
                    avatarUrl={p.avatar_url}
                    size={22}
                    className={`ring-2 ring-white dark:ring-slate-800 ${idx > 0 ? '-ml-2' : ''}`}
                  />
                ))}
                {avatars.length > 4 && (
                  <span className="-ml-2 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-slate-200 px-1 text-[10px] font-semibold text-slate-600 ring-2 ring-white dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-800">
                    +{avatars.length - 4}
                  </span>
                )}
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                togglePin(l.id, !l.membership.pinned)
              }}
              aria-label={l.membership.pinned ? 'Quitar de fijadas' : 'Fijar lista'}
              title={l.membership.pinned ? 'Quitar de fijadas' : 'Fijar lista'}
              className={`rounded-lg p-1.5 ${
                l.membership.pinned
                  ? 'text-amber-500'
                  : 'text-slate-300 hover:bg-slate-100 hover:text-slate-500 dark:hover:bg-slate-700'
              }`}
            >
              📌
            </button>
            <button
              onClick={(e) => duplicateList(e, l)}
              aria-label="Duplicar lista"
              title="Duplicar lista"
              className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-500 dark:hover:bg-slate-700"
            >
              ⧉
            </button>
            <button
              onClick={(e) => requestDeleteOrLeave(e, l.id, l.name, isOwner)}
              aria-label={isOwner ? 'Eliminar lista' : 'Salir de la lista'}
              title={isOwner ? 'Eliminar lista' : 'Salir de la lista'}
              className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
            >
              🗑
            </button>
            <span className="text-slate-300 dark:text-slate-600">›</span>
          </div>
        </div>
        {progressPct !== null && (
          <div className="mt-3 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="shrink-0 text-[11px] text-slate-400">
              {stats!.done}/{stats!.total}
            </span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24 dark:bg-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-gradient-to-r from-white to-brand-50/50 px-4 py-3 backdrop-blur dark:border-slate-700 dark:from-slate-800 dark:to-slate-800">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Logo size={34} className="rounded-lg" />
            <div>
              <p className="text-xs text-slate-400">Hola,</p>
              <p className="font-semibold text-slate-900 dark:text-slate-100">{profile?.username ?? '…'}</p>
            </div>
          </div>
          <button onClick={() => setShowProfile(true)} className="relative rounded-full" aria-label="Tu perfil">
            <Avatar
              username={profile?.username ?? '?'}
              avatarUrl={profile?.avatar_url}
              size={38}
              className="ring-2 ring-white hover:ring-brand-200 dark:ring-slate-800"
            />
            {invitations.length > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-white dark:ring-slate-800">
                {invitations.length > 9 ? '9+' : invitations.length}
              </span>
            )}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950">{error}</p>}
        {actionError && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950">{actionError}</p>
        )}

        {invitations.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Invitaciones pendientes
            </h2>
            <div className="space-y-3">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:ring-amber-900"
                >
                  <div>
                    <p className="font-medium text-slate-900 dark:text-slate-100">{inv.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Te han invitado a esta lista</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respondInvitation(inv.id, false)}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-white dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
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
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Mis listas
            </h2>
          </div>

          {loading ? (
            <p className="text-sm text-slate-400">Cargando listas…</p>
          ) : activeLists.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-600">
              <p className="mb-4 text-slate-500 dark:text-slate-400">Todavía no tienes ninguna lista.</p>
              <button
                onClick={() => setShowCreate(true)}
                className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
              >
                Crear tu primera lista
              </button>
            </div>
          ) : (
            <div className="space-y-3">{activeLists.map(renderListRow)}</div>
          )}
        </section>

        {archivedLists.length > 0 && (
          <section className="mt-8">
            <button
              onClick={() => setShowArchived((s) => !s)}
              className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500 hover:text-brand-600 dark:text-slate-400"
            >
              {showArchived ? '▾' : '▸'} Archivadas ({archivedLists.length})
            </button>
            {showArchived && <div className="space-y-3 opacity-70">{archivedLists.map(renderListRow)}</div>}
          </section>
        )}
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

      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.isOwner ? 'Eliminar lista' : 'Salir de la lista'}
          message={
            confirmTarget.isOwner
              ? `¿Eliminar definitivamente la lista "${confirmTarget.name}"? Se borrará para todos los miembros, junto con sus notas, gastos y chat. Esta acción no se puede deshacer.`
              : `¿Salir de la lista "${confirmTarget.name}"? Dejarás de verla, pero seguirá existiendo para el resto.`
          }
          confirmLabel={confirmTarget.isOwner ? 'Eliminar' : 'Salir'}
          danger={confirmTarget.isOwner}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={confirmDeleteOrLeave}
        />
      )}
    </div>
  )
}
