// Selección de mensajes con la cita del mensaje al que se responde (ver
// migration_v28.sql: reply_to_message_id). Si por lo que sea ese join falla
// (por ejemplo, si la caché de PostgREST tarda en enterarse de la relación
// nueva justo después de aplicar la migración, o cualquier otro fallo
// puntual de ese "select" concreto), MESSAGES_SELECT_BASIC sirve de
// respaldo: los mismos mensajes, sin la cita — así un problema aislado en
// esa parte del chat no se lleva por delante la carga de TODA la lista o
// del chat directo con un contacto (bug real visto en producción: al fallar
// el join, useListData.ts/useDirectMessages.ts marcaban error general y la
// pantalla entera decía "no se pudo cargar la lista").
export const MESSAGES_SELECT_WITH_REPLY =
  '*, sender:profiles!messages_sender_id_fkey(*), reply_to:messages!messages_reply_to_message_id_fkey(id, content, image_path, audio_path, sender_id, sender:profiles!messages_sender_id_fkey(username))'

export const MESSAGES_SELECT_BASIC = '*, sender:profiles!messages_sender_id_fkey(*)'

/**
 * Ejecuta una consulta de mensajes intentando primero traer la cita de
 * "responder a" y, si esa consulta concreta falla, reintenta sin ella en
 * vez de propagar el error hacia arriba. `runQuery` recibe el texto del
 * `select(...)` a usar y debe devolver la consulta ya construida (sin haber
 * hecho todavía el `await`), para poder repetirla con el select de
 * respaldo.
 */
export async function fetchMessagesResilient<T>(
  runQuery: (selectClause: string) => PromiseLike<{ data: T | null; error: { message: string } | null }>,
) {
  const withReply = await runQuery(MESSAGES_SELECT_WITH_REPLY)
  if (!withReply.error) return withReply

  console.warn(
    '[messages] Falló el join de "responder a" (reply_to) — reintentando sin la cita para no bloquear el chat:',
    withReply.error.message,
  )
  return runQuery(MESSAGES_SELECT_BASIC)
}
