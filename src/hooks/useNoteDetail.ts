import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Note, NoteMember } from '../lib/types'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useLanguage } from '../lib/i18n'

/**
 * Carga una nota común concreta y sus miembros (ver migration_v23.sql).
 * updateNote hace un PATCH directo, sin más — el autoguardado (esperar a
 * que la persona deje de escribir un momento) lo decide quien use este
 * hook, no la propia función.
 */
export function useNoteDetail(noteId: string | undefined) {
  const { user } = useAuth()
  const { showError } = useToast()
  const { t } = useLanguage()
  const [note, setNote] = useState<Note | null>(null)
  const [members, setMembers] = useState<NoteMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!noteId) return
    setError(null)
    const [noteRes, membersRes] = await Promise.all([
      supabase.from('notes').select('*').eq('id', noteId).maybeSingle(),
      supabase
        .from('note_members')
        .select('*, profile:profiles!note_members_user_id_fkey(*)')
        .eq('note_id', noteId)
        .order('created_at', { ascending: true }),
    ])

    if (noteRes.error) setError(noteRes.error.message)
    else if (membersRes.error) setError(membersRes.error.message)

    setNote((noteRes.data as Note) ?? null)
    setMembers((membersRes.data as unknown as NoteMember[]) ?? [])
    setLoading(false)
  }, [noteId])

  useEffect(() => {
    setLoading(true)
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (!noteId || !user) return
    const channel = supabase
      .channel(`note-detail-${noteId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `id=eq.${noteId}` }, fetchAll)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'note_members', filter: `note_id=eq.${noteId}` },
        fetchAll,
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [noteId, user, fetchAll])

  const updateNote = useCallback(
    async (patch: { title?: string; body?: string; color?: string | null }) => {
      if (!noteId) return
      const { error } = await supabase
        .from('notes')
        .update({ ...patch, last_activity_at: new Date().toISOString() })
        .eq('id', noteId)
      if (error) showError(t('common.saveError'))
    },
    [noteId, showError, t],
  )

  const myMembership = members.find((m) => m.user_id === user?.id) ?? null
  const isOwner = note?.owner_id === user?.id

  return { note, members, myMembership, isOwner, loading, error, refetch: fetchAll, updateNote }
}
