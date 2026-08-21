import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { attachReplyPreviews, MESSAGES_SELECT_BASIC } from '../lib/messagesQuery'
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
        .select(MESSAGES_SELECT_BASIC)
        .is('list_id', null)
        .or(`and(sender_id.eq.${user.id},to_user_id.eq.${peerId}),and(sender_id.eq.${peerId},to_user_id.eq.${user.id})`)
        .order('created_at', { ascending: true }),
    ])

    // Igual que en useListData.ts: un fallo al cargar mensajes no bloquea
    // toda la conversación — solo se avisa en consola y se deja la lista
    // de mensajes vacía.
    if (peerRes.error) setError(peerRes.error.message)
    else if (messagesRes.error) console.warn('[useDirectMessages] No se pudieron cargar los mensajes:', messagesRes.error.message)

    const clearedAt = (myContactRes.data as { chat_cleared_at: string | null } | null)?.chat_cleared_at ?? null
    setChatClearedAt(clearedAt)
    setPeerProfile((peerRes.data as Profile) ?? null)
    const baseMessages = (messagesRes.data as unknown as Message[]) ?? []
    const allMessages = await attachReplyPreviews(baseMessages)
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
      // OJO: NO suscribirse aquí a la tabla "contacts" — a diferencia de
      // "messages", "contacts" no está añadida a la publicación de Realtime
      // de Supabase (ver schema.sql), y pedir un cambio de una tabla fuera
      // de esa publicación puede tumbar TODO el canal, incluidos los
      // listeners de "messages" de arriba que sí funcionan — eso rompía la
      // actualización en vivo del chat entero. clearChat() ya refresca a
      // mano con fetchAll() nada más borrar, así que no hace falta más.
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
