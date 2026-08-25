import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { ListWithMembership, Profile } from '../lib/types'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../lib/i18n'

export type ItemStats = { done: number; total: number }

/**
 * Carga las listas del usuario actual, separadas en:
 *  - lists: listas donde ya es miembro aceptado (ordenadas: fijadas primero,
 *    luego por actividad reciente)
 *  - invitations: invitaciones pendientes de aceptar/rechazar
 * También trae, por lista, el progreso de notas (hechas/total) y los
 * avatares de sus miembros, para pintarlos en la vista de "Mis listas".
 * Se suscribe a cambios relevantes para refrescar automáticamente.
 */
export function useLists() {
  const { user } = useAuth()
  const { showError } = useToast()
  const { t } = useLanguage()
  const [lists, setLists] = useState<ListWithMembership[]>([])
  const [invitations, setInvitations] = useState<ListWithMembership[]>([])
  const [itemStats, setItemStats] = useState<Record<string, ItemStats>>({})
  const [memberAvatars, setMemberAvatars] = useState<Record<string, Profile[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchLists = useCallback(async () => {
    if (!user) return
    setError(null)
    const { data, error: err } = await supabase
      .from('list_members')
      .select('*, list:lists(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    const accepted: ListWithMembership[] = []
    const invited: ListWithMembership[] = []
    for (const row of (data ?? []) as any[]) {
      const listRow = row.list
      if (!listRow) continue
      const { list: _omit, ...membership } = row
      const withMembership: ListWithMembership = { ...listRow, membership }
      if (row.status === 'accepted') accepted.push(withMembership)
      else invited.push(withMembership)
    }

    accepted.sort((a, b) => {
      if (a.membership.pinned !== b.membership.pinned) return a.membership.pinned ? -1 : 1
      const pa = a.membership.position
      const pb = b.membership.position
      if (pa != null && pb != null && pa !== pb) return pa - pb
      if (pa != null && pb == null) return -1
      if (pa == null && pb != null) return 1
      // "Recientes" para TI: se ordena por cuándo entraste tú por última
      // vez (last_opened_at, tu propia fila) y NO por last_activity_at
      // (compartida, sube con cualquier cambio de cualquier miembro) — así
      // que otra persona editando o escribiendo al chat no te reordena la
      // lista a ti. Ver migration_v38.sql. Una lista que nunca has abierto
      // (recién invitada y aceptada, por ejemplo) cae al final de este
      // grupo usando su fecha de creación como respaldo.
      const oa = a.membership.last_opened_at
        ? new Date(a.membership.last_opened_at).getTime()
        : new Date(a.membership.created_at).getTime()
      const ob = b.membership.last_opened_at
        ? new Date(b.membership.last_opened_at).getTime()
        : new Date(b.membership.created_at).getTime()
      return ob - oa
    })

    setLists(accepted)
    setInvitations(invited)

    const listIds = accepted.map((l) => l.id)
    if (listIds.length === 0) {
      setItemStats({})
      setMemberAvatars({})
      setLoading(false)
      return
    }

    const [itemsRes, membersRes] = await Promise.all([
      supabase.from('items').select('list_id, done').in('list_id', listIds),
      supabase
        .from('list_members')
        .select('list_id, user_id, profile:profiles!list_members_user_id_fkey(*)')
        .in('list_id', listIds)
        .eq('status', 'accepted'),
    ])

    const stats: Record<string, ItemStats> = {}
    for (const row of (itemsRes.data as { list_id: string; done: boolean }[]) ?? []) {
      const cur = stats[row.list_id] ?? { done: 0, total: 0 }
      cur.total += 1
      if (row.done) cur.done += 1
      stats[row.list_id] = cur
    }
    setItemStats(stats)

    const avatars: Record<string, Profile[]> = {}
    for (const row of (membersRes.data as unknown as { list_id: string; profile: Profile }[]) ?? []) {
      if (!row.profile) continue
      const cur = avatars[row.list_id] ?? []
      cur.push(row.profile)
      avatars[row.list_id] = cur
    }
    setMemberAvatars(avatars)

    setLoading(false)
  }, [user])

  useEffect(() => {
    setLoading(true)
    fetchLists()
  }, [fetchLists])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`user-lists-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'list_members', filter: `user_id=eq.${user.id}` },
        () => fetchLists(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lists' }, () => fetchLists())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => fetchLists())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, fetchLists])

  const togglePin = useCallback(
    async (listId: string, pinned: boolean) => {
      if (!user) return
      const { error } = await supabase.from('list_members').update({ pinned }).eq('list_id', listId).eq('user_id', user.id)
      if (error) showError(t('common.saveError'))
      fetchLists()
    },
    [user, fetchLists, showError, t],
  )

  const reorderLists = useCallback(
    async (orderedListIds: string[]) => {
      if (!user) return
      const results = await Promise.all(
        orderedListIds.map((listId, idx) =>
          supabase.from('list_members').update({ position: idx }).eq('list_id', listId).eq('user_id', user.id),
        ),
      )
      if (results.some((r) => r.error)) showError(t('common.saveError'))
      fetchLists()
    },
    [user, fetchLists, showError, t],
  )

  return {
    lists,
    invitations,
    itemStats,
    memberAvatars,
    loading,
    error,
    refetch: fetchLists,
    togglePin,
    reorderLists,
  }
}
