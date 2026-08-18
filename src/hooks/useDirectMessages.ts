import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { Message, Profile } from '../lib/types'

/**
 * Carga la conversación directa (sin lista de por medio) entre el usuario
 * actual y "peerId", y el perfil de esa persona. Ver migration_v18.sql.
 *
 * El filtro de postgres_changes de Supabase Realtime solo admite una
 * comparación simple por columna, así que nos suscribimos dos veces (una
 * por "to_user_id=eq.mí" y otra por "sender_id=eq.mí") y refrescamos la
 * conversación completa con la consulta .or() de abajo, que sí filtra bien
 * por el par de personas — el mismo patrón que ya usa useListData.ts.
 */
export function useDirectMessages(peerId: string | undefined) {
  const { user } = useAuth()
  const [peerProfile, setPeerProfile] = useState<Profile | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [chatClearedAt, setChatClearedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!peerId || !user) return
    setError(null)

    const [peerRes, myContactRes, messagesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', peerId).maybeSingle(),
      supabase
        .from('contacts')
        .select('chat_cleared_at')
        .eq('user_id', user.id)
        .eq('contact_user_id', peerId)
        .maybeSingle(),
      supabase
        .from('messages')
        .select('*, sender:profiles!messages_sender_id_fkey(*)')
        .is('list_id', null)
        .or(`and(sender_id.eq.${user.id},to_user_id.eq.${peerId}),and(sender_id.eq.${peerId},to_user_id.eq.${user.id})`)
        .order('created_at', { ascending: true }),
    ])

    if (peerRes.error) setError(peerRes.error.message)
    else if (messagesRes.error) setError(messagesRes.error.message)

    const clearedAt = (myContactRes.data as { chat_cleared_at: string | null } | null)?.chat_cleared_at ?? null
    setChatClearedAt(clearedAt)
    setPeerProfile((peerRes.data as Profile) ?? null)
    const allMessages = (messagesRes.data as unknown as Message[]) ?? []
    setMessages(clearedAt ? allMessages.filter((m) => m.created_at > clearedAt) : allMessages)
    setLoading(false)
  }, [peerId, user])

  useEffect(() => {
    setLoading(true)
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (!peerId || !user) return
    const channel = supabase
      .channel(`direct-messages-${user.id}-${peerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `to_user_id=eq.${user.id}` },
        () => fetchAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `sender_id=eq.${user.id}` },
        () => fetchAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts', filter: `user_id=eq.${user.id}` },
        () => fetchAll(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [peerId, user, fetchAll])

  const clearChat = useCallback(async () => {
    if (!peerId || !user) return
    await supabase
      .from('contacts')
      .update({ chat_cleared_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('contact_user_id', peerId)
    await fetchAll()
  }, [peerId, user, fetchAll])

  return { peerProfile, messages, chatClearedAt, loading, error, refetch: fetchAll, clearChat }
}
