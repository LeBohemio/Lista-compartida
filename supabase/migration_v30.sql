-- migration_v30: editar mensajes del chat (ventana de 15 minutos)
--
-- Permite editar el texto de un mensaje propio hasta 15 minutos después de
-- enviarlo — igual que WhatsApp. Añade "edited_at" (se rellena la primera
-- vez que se edita, para poder mostrar la etiqueta "editado" junto a la
-- hora) y la política de UPDATE que faltaba en "messages" (antes solo se
-- podía borrar, nunca editar).
--
-- Solo mensajes de puro texto son editables (sin foto ni nota de voz): una
-- foto o un audio ya subidos no se pueden sustituir, así que ni el cliente
-- ofrece "editar" en esos casos ni la política lo permite.
--
-- La ventana de 15 minutos y el dueño del mensaje se comprueban EN EL
-- SERVIDOR (using/with check), no solo en la interfaz — así nadie puede
-- editar un mensaje ajeno o ya viejo saltándose la app. Y como RLS no puede
-- por sí sola impedir que una fila reescriba OTRAS columnas (sender_id,
-- list_id, reply_to_message_id…), el permiso de UPDATE se concede solo
-- sobre "content" y "edited_at" — mismo patrón que "contacts_update_own"
-- en migration_v18.sql.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.messages
  add column if not exists edited_at timestamptz;

drop policy if exists "messages_update_own_recent" on public.messages;
create policy "messages_update_own_recent" on public.messages
  for update to authenticated
  using (
    sender_id = auth.uid()
    and image_path is null
    and audio_path is null
    and created_at > now() - interval '15 minutes'
    and not public.is_list_archived(list_id)
  )
  with check (
    sender_id = auth.uid()
    and image_path is null
    and audio_path is null
    and created_at > now() - interval '15 minutes'
  );

revoke update on public.messages from authenticated;
grant update (content, edited_at) on public.messages to authenticated;
