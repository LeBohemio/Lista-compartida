import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { NoteWithMembership } from '../lib/types'
import { useAuth } from '../context/AuthContext'

/**
 * Carga las notas comunes del usuario actual (ver migration_v23.sql),
 * separadas en aceptadas e invitaciones pendientes — mismo patrón que
 * useLists.ts, pero sin progreso de items ni avatares de miembros (no hacen
 * falta aquí).
 */
export function useNotes() {
  const { user } = useAuth()
  const [notes, setNotes] = useState<NoteWithMembership[]>([])
  const [invitations, setInvitations] = useState<NoteWithMembership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchNotes = useCallback(async () => {
    if (!user) return
    setError(null)
    const { data, error: err } = await supabase
      .from('note_members')
      .select('*, note:notes(*)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    const accepted: NoteWithMembership[] = []
    const invited: NoteWithMembership[] = []
    for (const row of (data ?? []) as any[]) {
      const noteRow = row.note
      if (!noteRow) continue
      const { note: _omit, ...membership } = row
      const withMembership: NoteWithMembership = { ...noteRow, membership }
      if (row.status === 'accepted') accepted.push(withMembership)
      else invited.push(withMembership)
    }

    accepted.sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())

    setNotes(accepted)
    setInvitations(invited)
    setLoading(false)
  }, [user])

  useEffect(() => {
    setLoading(true)
    fetchNotes()
  }, [fetchNotes])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`user-notes-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'note_members', filter: `user_id=eq.${user.id}` },
        () => fetchNotes(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes' }, () => fetchNotes())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, fetchNotes])

  return { notes, invitations, loading, error, refetch: fetchNotes }
}
