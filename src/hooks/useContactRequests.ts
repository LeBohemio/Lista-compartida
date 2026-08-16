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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!user) return
    setError(null)
    const [contactsRes, requestsRes] = await Promise.all([
      supabase.from('contacts').select('*, contact:profiles!contacts_contact_user_id_fkey(*)').eq('user_id', user.id),
      supabase
        .from('contact_requests')
        .select(
          '*, from_profile:profiles!contact_requests_from_user_id_fkey(*), to_profile:profiles!contact_requests_to_user_id_fkey(*)',
        )
        .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
        .eq('status', 'pending'),
    ])

    if (contactsRes.error) setError(contactsRes.error.message)
    else if (requestsRes.error) setError(requestsRes.error.message)

    setContacts((contactsRes.data as unknown as Contact[]) ?? [])
    const requests = (requestsRes.data as unknown as ContactRequest[]) ?? []
    setIncoming(requests.filter((r) => r.to_user_id === user.id))
    setOutgoing(requests.filter((r) => r.from_user_id === user.id))
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

  return { contacts, incoming, outgoing, loading, error, refetch: fetchAll }
}

export type ContactRequestsData = ReturnType<typeof useContactRequests>
