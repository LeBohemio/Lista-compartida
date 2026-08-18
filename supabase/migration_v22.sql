-- migration_v22: borrar chat (solo para mí)
--
-- Añade una columna "chat_cleared_at" tanto a list_members (chat de una
-- lista/grupo) como a contacts (chat directo con una persona). Al "borrar
-- un chat", en vez de borrar mensajes de verdad, se guarda la fecha de
-- ahora en tu propia fila — la app deja de mostrarte los mensajes de antes
-- de esa fecha, pero no le cambia nada a la otra persona (o al resto de
-- miembros de la lista), igual que "vaciar el chat" en WhatsApp. Si llega
-- un mensaje nuevo después, el chat vuelve a verse con normalidad.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.list_members add column if not exists chat_cleared_at timestamptz;
alter table public.contacts add column if not exists chat_cleared_at timestamptz;
