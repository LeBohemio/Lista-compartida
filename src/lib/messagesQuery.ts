import { supabase } from './supabaseClient'
import type { Message } from './types'

// Antes se pedía la cita del mensaje al que se responde (reply_to) con un
// JOIN de PostgREST sobre la propia tabla "messages"
// (reply_to:messages!messages_reply_to_message_id_fkey(...)). En
// producción eso daba siempre "Could not find a relationship between
// 'messages' and 'messages' in the schema cache" — comprobado que la
// clave foránea existe de verdad en la base de datos (select sobre
// pg_constraint) y que forzar un reload de la caché del esquema (NOTIFY
// pgrst, 'reload schema') no lo arregla — así que sea lo que sea lo que le
// pasa a ese proyecto en concreto con este tipo de relación (una tabla
// referenciándose a sí misma), lo más seguro es no depender de que
// PostgREST la reconozca.
//
// Por eso ahora los mensajes se piden SIN esa cita (MESSAGES_SELECT_BASIC,
// un select normal, sin autorreferencia) y attachReplyPreviews() añade la
// cita aparte, con una segunda consulta sencilla por ids (un IN(...), sin
// ningún JOIN sobre la propia tabla) — funciona pase lo que pase con la
// caché de relaciones de PostgREST.
export const MESSAGES_SELECT_BASIC = '*, sender:profiles!messages_sender_id_fkey(*)'

const REPLY_PREVIEW_SELECT =
  'id, content, image_path, audio_path, file_path, file_name, sender_id, sender:profiles!messages_sender_id_fkey(username)'

/**
 * Rellena el campo "reply_to" de una lista de mensajes ya cargados (los
 * que tengan reply_to_message_id) con una consulta aparte. No hace falta
 * ninguna policy RLS nueva: solo se puede citar un mensaje de la MISMA
 * conversación (lista o chat directo), así que si ya podías ver los
 * mensajes de la lista, también puedes ver el que citan — las mismas
 * políticas que dejan ver messagesRes ya dejan ver esto.
 */
export async function attachReplyPreviews(messages: Message[]): Promise<Message[]> {
  const ids = Array.from(
    new Set(messages.map((m) => m.reply_to_message_id).filter((id): id is string => Boolean(id))),
  )
  if (ids.length === 0) return messages

  const { data, error } = await supabase.from('messages').select(REPLY_PREVIEW_SELECT).in('id', ids)
  if (error || !data) {
    console.warn('[messages] No se pudieron cargar las citas de "responder a":', error?.message)
    return messages
  }

  const byId = new Map((data as unknown as NonNullable<Message['reply_to']>[]).map((row) => [row.id, row]))
  return messages.map((m) =>
    m.reply_to_message_id ? { ...m, reply_to: byId.get(m.reply_to_message_id) ?? null } : m,
  )
}
