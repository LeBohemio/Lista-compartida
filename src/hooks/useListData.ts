import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import type { Expense, Item, List, ListMember, Message, Settlement } from '../lib/types'
import { useAuth } from '../context/AuthContext'
import { attachReplyPreviews, MESSAGES_SELECT_BASIC } from '../lib/messagesQuery'

export function useListData(listId: string | undefined) {
  const { user } = useAuth()
  const [list, setList] = useState<List | null>(null)
  const [members, setMembers] = useState<ListMember[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    if (!listId) return
    setError(null)

    const [listRes, membersRes, itemsRes, expensesRes, settlementsRes, messagesRes] = await Promise.all([
      supabase.from('lists').select('*').eq('id', listId).maybeSingle(),
      supabase
        .from('list_members')
        .select('*, profile:profiles!list_members_user_id_fkey(*)')
        .eq('list_id', listId)
        .order('created_at', { ascending: true }),
      supabase
        .from('items')
        .select('*, creator:profiles!items_created_by_fkey(*)')
        .eq('list_id', listId)
        .order('created_at', { ascending: true }),
      supabase
        .from('expenses')
        .select(
          '*, payer:profiles!expenses_paid_by_fkey(*), shares:expense_shares(*, profile:profiles!expense_shares_user_id_fkey(*))',
        )
        .eq('list_id', listId)
        .order('created_at', { ascending: false }),
      supabase
        .from('settlements')
        .select(
          '*, from_profile:profiles!settlements_from_user_fkey(*), to_profile:profiles!settlements_to_user_fkey(*)',
        )
        .eq('list_id', listId)
        .order('created_at', { ascending: false }),
      supabase
        .from('messages')
        .select(MESSAGES_SELECT_BASIC)
        .eq('list_id', listId)
        .order('created_at', { ascending: true }),
    ])

    // OJO: el error de "messages" queda fuera de este bloqueo a propósito.
    // Antes, si esa consulta fallaba, la lista ENTERA dejaba de cargar con
    // un "no se pudo cargar la lista" — aunque notas y gastos estuvieran
    // perfectamente disponibles. Ahora, si de verdad no se pueden traer
    // los mensajes, el chat se queda vacío pero el resto de la lista
    // funciona con normalidad.
    const firstError = listRes.error || membersRes.error || itemsRes.error || expensesRes.error || settlementsRes.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }
    if (messagesRes.error) {
      console.warn('[useListData] No se pudieron cargar los mensajes del chat:', messagesRes.error.message)
    }

    setList((listRes.data as List) ?? null)
    setMembers((membersRes.data as unknown as ListMember[]) ?? [])
    setItems((itemsRes.data as unknown as Item[]) ?? [])
    setExpenses((expensesRes.data as unknown as Expense[]) ?? [])
    setSettlements((settlementsRes.data as unknown as Settlement[]) ?? [])
    const baseMessages = (messagesRes.data as unknown as Message[]) ?? []
    setMessages(await attachReplyPreviews(baseMessages))
    setLoading(false)
  }, [listId])

  useEffect(() => {
    setLoading(true)
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    if (!listId || !user) return
    const channel = supabase
      .channel(`list-data-${listId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lists', filter: `id=eq.${listId}` }, fetchAll)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'list_members', filter: `list_id=eq.${listId}` },
        fetchAll,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `list_id=eq.${listId}` }, fetchAll)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: `list_id=eq.${listId}` },
        fetchAll,
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_shares' }, fetchAll)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settlements', filter: `list_id=eq.${listId}` },
        fetchAll,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `list_id=eq.${listId}` },
        fetchAll,
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [listId, user, fetchAll])

  const myMembership = members.find((m) => m.user_id === user?.id) ?? null
  const acceptedMembers = members.filter((m) => m.status === 'accepted')

  // "Borrar chat" (solo para mí): oculta los mensajes de antes de la fecha
  // guardada en mi propia fila de list_members. Ver migration_v22.sql.
  const chatClearedAt = myMembership?.chat_cleared_at ?? null
  const visibleMessages = chatClearedAt ? messages.filter((m) => m.created_at > chatClearedAt) : messages

  const clearChat = useCallback(async () => {
    if (!listId || !user) return
    await supabase
      .from('list_members')
      .update({ chat_cleared_at: new Date().toISOString() })
      .eq('list_id', listId)
      .eq('user_id', user.id)
    await fetchAll()
  }, [listId, user, fetchAll])

  return {
    list,
    members,
    acceptedMembers,
    myMembership,
    items,
    expenses,
    settlements,
    messages: visibleMessages,
    chatClearedAt,
    loading,
    error,
    refetch: fetchAll,
    clearChat,
  }
}
