-- migration_v28: responder citando un mensaje del chat
--
-- Añade "reply_to_message_id" a messages: al responder a un mensaje
-- concreto (en vez de escribir uno suelto), se guarda a cuál responde, para
-- poder mostrar la cita encima del mensaje nuevo (como en WhatsApp).
--
-- Si el mensaje citado se borra más tarde, "reply_to_message_id" pasa a
-- null solo (on delete set null) — el mensaje que respondía sigue
-- existiendo con normalidad, solo deja de poder mostrar la cita.
--
-- No hace falta ninguna policy nueva: es una columna más de una fila que ya
-- se inserta con las políticas existentes (messages_insert_member, ver
-- migration_v18.sql/migration_v26.sql) — nadie puede citar un mensaje que
-- no pudiera ver igualmente, porque solo se puede citar un mensaje de la
-- MISMA conversación (eso lo garantiza el cliente al elegir de qué
-- responder; no hace falta duplicarlo en SQL porque no da ningún permiso
-- nuevo: como mucho, un id que apunta a un mensaje de otra conversación
-- simplemente no se podría leer luego al pedirlo con el join, y no expone
-- nada).
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.messages
  add column if not exists reply_to_message_id uuid references public.messages (id) on delete set null;

create index if not exists messages_reply_to_idx on public.messages (reply_to_message_id) where reply_to_message_id is not null;
