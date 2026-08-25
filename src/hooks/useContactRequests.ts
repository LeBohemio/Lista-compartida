import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { Contact, ContactRequest } from '../lib/types'

/**
 * Carga los contactos del usuario actual y sus peticiones de contacto
 * pendientes (tanto las que ha recibido como las que ha mandado). Se
 * suscribe a cambios relevantes para refrescar automáticamente, igual que
 * useLists.ts hace con las listas.
 */
export function useContactRequests() {
  const { user } = useAuth()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [incoming, setIncoming] = useState<ContactRequest[]>([])
  const [outgoing, setOutgoing] = useState<ContactRequest[]>([])
  // Cuántos mensajes directos sin leer tienes de cada contacto (clave =
  // contact_user_id de quien te escribió), para pintar el numerito en
  // Contactos — igual que el aviso de la pestaña Chat dentro de una lista
  // (ver ListDetailPage.tsx), pero por persona en vez de por lista.
  const [unreadByContact, setUnreadByContact] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!user) return
    setError(null)
    const [contactsRes, requestsRes, dmRes] = await Promise.all([
      supabase.from('contacts').select('*, contact:profiles!contacts_contact_user_id_fkey(*)').eq('user_id', user.id),
      supabase
        .from('contact_requests')
        .select(
          '*, from_profile:profiles!contact_requests_from_user_id_fkey(*), to_profile:profiles!contact_requests_to_user_id_fkey(*)',
        )
        .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
        .eq('status', 'pending'),
      // Solo el remitente y la fecha — lo justo para contar, nunca hace
      // falta el contenido del mensaje aquí.
      supabase.from('messages').select('sender_id, created_at').is('list_id', null).eq('to_user_id', user.id),
    ])

    if (contactsRes.error) setError(contactsRes.error.message)
    else if (requestsRes.error) setError(requestsRes.error.message)

    const contactRows = (contactsRes.data as unknown as Contact[]) ?? []
    setContacts(contactRows)
    const requests = (requestsRes.data as unknown as ContactRequest[]) ?? []
    setIncoming(requests.filter((r) => r.to_user_id === user.id))
    setOutgoing(requests.filter((r) => r.from_user_id === user.id))

    // Un mensaje cuenta como "sin leer" si es más reciente que la última vez
    // que abriste esa conversación directa (contacts.last_read_message_at,
    // que DirectChatPage.tsx actualiza al entrar) — nunca se ha abierto ⇒
    // todo lo que haya de esa persona cuenta.
    const dmRows = (dmRes.data as unknown as { sender_id: string; created_at: string }[] | null) ?? []
    const counts: Record<string, number> = {}
    for (const row of dmRows) {
      const contactRow = contactRows.find((c) => c.contact_user_id === row.sender_id)
      const lastRead = contactRow?.last_read_message_at ? new Date(contactRow.last_read_message_at).getTime() : 0
      if (new Date(row.created_at).getTime() > lastRead) {
        counts[row.sender_id] = (counts[row.sender_id] ?? 0) + 1
      }
    }
    setUnreadByContact(counts)

    setLoading(false)
  }, [user])

  useEffect(() => {
    setLoading(true)
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`user-contact-requests-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts', filter: `user_id=eq.${user.id}` },
        () => fetchAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contact_requests', filter: `to_user_id=eq.${user.id}` },
        () => fetchAll(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contact_requests', filter: `from_user_id=eq.${user.id}` },
        () => fetchAll(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, fetchAll])

  // Canal APARTE solo para "messages", a propósito — no metido en el canal
  // de arriba junto con "contacts". Ver el comentario de
  // useDirectMessages.ts: mezclar en un mismo canal una tabla que no esté
  // en la publicación de Realtime de Supabase con otra que sí lo está puede
  // tumbar el canal entero, incluidos los avisos de peticiones de contacto
  // que ya funcionan arriba. "messages" sí está en la publicación (y con
  // replica identity full — ver schema.sql), así que aislarlo en su propio
  // canal es lo más seguro: si algo fallara aquí, no se llevaría por delante
  // el resto.
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`user-contact-unread-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `to_user_id=eq.${user.id}` },
        () => fetchAll(),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, fetchAll])

  return { contacts, incoming, outgoing, unreadByContact, loading, error, refetch: fetchAll }
}

export type ContactRequestsData = ReturnType<typeof useContactRequests>
