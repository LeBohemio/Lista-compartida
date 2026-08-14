import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { ListWithMembership } from '../lib/types'
import { useAuth } from '../context/AuthContext'

/**
 * Carga las listas del usuario actual, separadas en:
 *  - lists: listas donde ya es miembro aceptado
 *  - invitations: invitaciones pendientes de aceptar/rechazar
 * Se suscribe a cambios en list_members para refrescar automáticamente.
 */
export function useLists() {
  const { user } = useAuth()
  const [lists, setLists] = useState<ListWithMembership[]>([])
  const [invitations, setInvitations] = useState<ListWithMembership[]>([])
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
    setLists(accepted)
    setInvitations(invited)
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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, fetchLists])

  return { lists, invitations, loading, error, refetch: fetchLists }
}
