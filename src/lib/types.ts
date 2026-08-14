export type Theme = 'light' | 'dark' | 'system'

export type Profile = {
  id: string
  username: string
  email: string
  avatar_url: string | null
  theme: Theme
  accent_color: string | null
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
  archived_at: string | null
  created_at: string
}

export type ListMember = {
  list_id: string
  user_id: string
  role: MemberRole
  status: MemberStatus
  invited_identifier: string
  created_at: string
  responded_at: string | null
  last_read_message_at: string | null
  // joined
  profile?: Profile
}

export type ListWithMembership = List & {
  membership: ListMember
}

export type Item = {
  id: string
  list_id: string
  content: string
  done: boolean
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

export type Message = {
  id: string
  list_id: string
  sender_id: string | null
  content: string | null
  image_path: string | null
  created_at: string
  // joined
  sender?: Profile
}
