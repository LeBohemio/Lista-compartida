import type { CurrencyCode } from './currencies'

export type Theme = 'light' | 'dark' | 'system'
export type Language = 'es' | 'en'

export type Profile = {
  id: string
  username: string
  email: string
  avatar_url: string | null
  theme: Theme
  accent_color: string | null
  background_color: string | null
  language: Language
  currency: CurrencyCode
  created_at: string
  // Fecha de corte personal para "Mis gastos" (MyExpensesModal): si tiene
  // valor, esa vista solo cuenta gastos/liquidaciones desde esta fecha en
  // adelante. No borra nada ni afecta al balance compartido de las listas —
  // solo filtra lo que ve esta persona en su propio resumen. Ver
  // migration_v13.sql.
  expenses_reset_at: string | null
  // Preferencias de notificaciones push (ver migration_v14.sql).
  // notify_push_enabled es el interruptor general: si está en false, no se
  // manda nada aunque los 4 de abajo estén en true. Se activa la primera
  // vez que la persona pulsa "activar notificaciones" en Ajustes.
  notify_push_enabled: boolean
  notify_chat: boolean
  notify_expenses: boolean
  notify_invites: boolean
  notify_settlements: boolean
}

// Una fila por cada dispositivo/navegador donde una persona ha activado las
// notificaciones (puede tener varias). Ver migration_v14.sql.
export type PushSubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  created_at: string
}

export type MemberStatus = 'invited' | 'accepted'
export type MemberRole = 'owner' | 'member'

export type List = {
  id: string
  name: string
  owner_id: string
  expenses_enabled: boolean
  color: string | null
  photo_url: string | null
  currency: CurrencyCode
  archived_at: string | null
  last_activity_at: string
  created_at: string
}

export type ListMember = {
  list_id: string
  user_id: string
  role: MemberRole
  status: MemberStatus
  invited_identifier: string
  pinned: boolean
  position: number | null
  created_at: string
  responded_at: string | null
  last_read_message_at: string | null
  // Silenciar el chat de ESTA lista (no afecta a otras listas ni a otros
  // tipos de aviso). Ver migration_v15.sql.
  muted: boolean
  // Quién mandó la invitación — hace falta para saber con quién os hacéis
  // contactos automáticamente en cuanto se acepta. null en invitaciones
  // antiguas (de antes de esto) o en la fila del propio dueño al crear la
  // lista. Ver migration_v16.sql.
  invited_by: string | null
  // "Borrar chat" (solo para mí): oculta los mensajes de antes de esta
  // fecha en el chat de esta lista, solo en mi vista — a los demás
  // miembros no les cambia nada. Si llega un mensaje nuevo después, el
  // chat vuelve a verse con normalidad, como en WhatsApp. Ver
  // migration_v22.sql.
  chat_cleared_at: string | null
  // joined
  profile?: Profile
}

// Contactos: gente con la que ya has compartido alguna lista (se hacen
// contactos automáticamente en cuanto aceptan tu invitación) — se pueden
// añadir directamente a otras listas sin volver a escribir su email. Cada
// fila es de una sola dirección (ver migration_v16.sql); borrar un contacto
// es mutuo y pasa siempre por la función remove_contact, nunca por un
// delete directo sobre esta tabla.
export type Contact = {
  user_id: string
  contact_user_id: string
  created_at: string
  // Fijar arriba, silenciar avisos del chat directo, y hasta cuándo has
  // leído esa conversación — todo por tu propia fila (no compartido con la
  // otra persona). Ver migration_v18.sql.
  pinned: boolean
  muted: boolean
  last_read_message_at: string | null
  // "Borrar chat" (solo para mí): igual que chat_cleared_at en
  // ListMember, pero para la conversación directa con esta persona. Ver
  // migration_v22.sql.
  chat_cleared_at: string | null
  // joined
  contact?: Profile
}

export type ContactRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled'

// Petición de contacto directa (sin pasar por invitar a una lista) — ver
// migration_v17.sql. from_user_id la manda, to_user_id la recibe.
export type ContactRequest = {
  id: string
  from_user_id: string
  to_user_id: string
  status: ContactRequestStatus
  created_at: string
  responded_at: string | null
  // joined
  from_profile?: Profile
  to_profile?: Profile
}

export type ListWithMembership = List & {
  membership: ListMember
}

export type Item = {
  id: string
  list_id: string
  content: string
  done: boolean
  due_date: string | null
  position: number | null
  created_by: string | null
  created_at: string
  done_at: string | null
  // joined
  creator?: Profile
}

export type ExpenseCategory = 'comida' | 'transporte' | 'alojamiento' | 'ocio' | 'compras' | 'otros'

export type Expense = {
  id: string
  list_id: string
  description: string | null
  total_amount: number
  receipt_image_path: string | null
  ocr_confidence: number | null
  category: ExpenseCategory
  paid_by: string | null
  created_by: string | null
  created_at: string
  // true cuando el reparto no suma el total (importes personalizados o
  // porcentajes incompletos) — se guardó igualmente al salir del
  // formulario, como borrador, para no perder lo ya escrito.
  is_draft: boolean
  // true cuando cada persona pagó su propia parte directamente — el gasto
  // cuenta igual en el historial y en los totales, pero no genera deuda
  // entre nadie (paid_by va a null, y los "shares" son solo un registro de
  // cuánto puso cada uno, no una deuda). Ver migration_v12.sql.
  no_debt: boolean
  // joined
  payer?: Profile
  shares?: ExpenseShare[]
}

export type ExpenseShare = {
  id: string
  expense_id: string
  user_id: string | null
  amount: number
  // joined
  profile?: Profile
}

export type Settlement = {
  id: string
  list_id: string
  from_user: string | null
  to_user: string | null
  amount: number
  note: string | null
  created_by: string | null
  created_at: string
  // null = pendiente de que to_user lo confirme; con fecha = ya confirmado
  // (y cuenta en el balance). Ver migration_v11.sql.
  confirmed_at: string | null
  // joined
  from_profile?: Profile
  to_profile?: Profile
}

export type LedgerEntry =
  | { kind: 'expense'; data: Expense }
  | { kind: 'settlement'; data: Settlement }

export type NetBalance = Record<string, number> // user_id -> net (positive = le deben, negativo = debe)

export type SuggestedDebt = {
  from: string // debe
  to: string // le deben
  amount: number
}

export type ItemSuggestion = {
  id: string
  list_id: string
  content: string
  normalized: string
  use_count: number
  updated_at: string
}

// Un mensaje es de una lista (list_id lleno, to_user_id vacío) O de un chat
// directo entre dos personas (list_id vacío, to_user_id lleno) — nunca las
// dos cosas a la vez. Ver migration_v18.sql.
export type Message = {
  id: string
  list_id: string | null
  sender_id: string | null
  to_user_id: string | null
  content: string | null
  image_path: string | null
  audio_path: string | null
  audio_duration_seconds: number | null
  created_at: string
  // joined
  sender?: Profile
}
