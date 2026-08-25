-- migration_v31: adjuntar archivos (PDF, Word) en el chat
--
-- Añade una cuarta forma de mensaje además de texto/foto/audio: un archivo
-- adjunto (documento), igual que en WhatsApp. Reutiliza la misma tabla
-- "messages" y la misma convención de rutas ("{list_id}/{archivo}" o
-- "dm/{id_menor}_{id_mayor}/{archivo}") que ya usan fotos y audios, así que
-- reutiliza también la función que decide quién puede leer/escribir en esa
-- ruta (public.is_chat_image_participant, de migration_v18.sql) en vez de
-- duplicar esa lógica para un bucket nuevo.
--
-- A diferencia de la foto/el audio (donde el nombre real del archivo no
-- importaba), aquí sí hace falta guardar el nombre original ("factura
-- agosto.pdf") porque el nombre que se usa en Storage es uno generado
-- (timestamp + aleatorio) — sin esta columna, la burbuja del chat no podría
-- mostrar un nombre legible.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

-- ----------------------------------------------------------------------------
-- 1. MESSAGES — columnas para la ruta del archivo, su nombre original, su
--    tipo (mime) y su tamaño (para mostrarlo en la burbuja sin descargarlo).
-- ----------------------------------------------------------------------------
alter table public.messages add column if not exists file_path text;
alter table public.messages add column if not exists file_name text;
alter table public.messages add column if not exists file_mime_type text;
alter table public.messages add column if not exists file_size_bytes bigint;

-- El "check" de contenido se creó sin nombre explícito la primera vez, así
-- que Postgres le puso uno autogenerado que no podemos adivinar con
-- seguridad. Buscamos y quitamos cualquier check existente sobre esta tabla
-- antes de poner el nuevo (que añade file_path a la condición) — si ya se
-- había ejecutado esta migración antes, aquí simplemente se quita y se
-- vuelve a poner igual, sin efecto.
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'messages' and rel.relnamespace = 'public'::regnamespace and con.contype = 'c'
  loop
    execute format('alter table public.messages drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.messages
  add constraint messages_has_content
  check (
    content is not null
    or image_path is not null
    or audio_path is not null
    or file_path is not null
  );

-- Un archivo ya subido tampoco se puede "editar" (sustituir), igual que pasa
-- hoy con foto y audio (ver migration_v30.sql) — se actualiza la misma
-- política para excluir también los mensajes con file_path.
drop policy if exists "messages_update_own_recent" on public.messages;
create policy "messages_update_own_recent" on public.messages
  for update to authenticated
  using (
    sender_id = auth.uid()
    and image_path is null
    and audio_path is null
    and file_path is null
    and created_at > now() - interval '15 minutes'
    and not public.is_list_archived(list_id)
  )
  with check (
    sender_id = auth.uid()
    and image_path is null
    and audio_path is null
    and file_path is null
    and created_at > now() - interval '15 minutes'
  );

-- ----------------------------------------------------------------------------
-- 2. STORAGE — bucket privado para los archivos, con las mismas políticas
--    que "chat-images"/"chat-audio" (mismo criterio de "quién participa en
--    esta conversación", mismo dueño puede borrar lo suyo).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', false)
on conflict (id) do nothing;

drop policy if exists "chat_files_insert_member" on storage.objects;
create policy "chat_files_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-files'
    and public.is_chat_image_participant(storage.foldername(name))
  );

drop policy if exists "chat_files_select_member" on storage.objects;
create policy "chat_files_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-files'
    and public.is_chat_image_participant(storage.foldername(name))
  );

drop policy if exists "chat_files_delete_owner" on storage.objects;
create policy "chat_files_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-files' and owner = auth.uid());
