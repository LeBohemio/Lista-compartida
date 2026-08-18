-- migration_v20: audios en el chat
--
-- Añade una tercera forma de mensaje además de texto/foto: una nota de voz.
-- Reutiliza la misma tabla "messages" y la misma convención de rutas
-- ("{list_id}/{archivo}" o "dm/{id_menor}_{id_mayor}/{archivo}") que ya usan
-- las fotos, así que reutiliza también la función que decide quién puede
-- leer/escribir en esa ruta (public.is_chat_image_participant, de
-- migration_v18.sql) en vez de duplicar esa lógica para un bucket nuevo.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

-- ----------------------------------------------------------------------------
-- 1. MESSAGES — columna para la ruta del audio y su duración (en segundos,
--    para poder mostrarla en la burbuja sin tener que descargar el archivo
--    primero).
-- ----------------------------------------------------------------------------
alter table public.messages add column if not exists audio_path text;
alter table public.messages add column if not exists audio_duration_seconds integer;

-- El "check" original ("content is not null or image_path is not null") se
-- creó sin nombre explícito, así que Postgres le puso uno autogenerado que
-- no podemos adivinar con seguridad. Buscamos y quitamos cualquier check
-- existente sobre esta tabla antes de poner el nuevo (que añade audio_path
-- a la condición) — si ya se había ejecutado esta migración antes, aquí
-- simplemente se quita y se vuelve a poner igual, sin efecto.
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
  check (content is not null or image_path is not null or audio_path is not null);

-- ----------------------------------------------------------------------------
-- 2. STORAGE — bucket privado para los audios, con las mismas políticas que
--    "chat-images" (mismo criterio de "quién participa en esta conversación",
--    mismo dueño puede borrar lo suyo).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-audio', 'chat-audio', false)
on conflict (id) do nothing;

drop policy if exists "chat_audio_insert_member" on storage.objects;
create policy "chat_audio_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-audio'
    and public.is_chat_image_participant(storage.foldername(name))
  );

drop policy if exists "chat_audio_select_member" on storage.objects;
create policy "chat_audio_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-audio'
    and public.is_chat_image_participant(storage.foldername(name))
  );

drop policy if exists "chat_audio_delete_owner" on storage.objects;
create policy "chat_audio_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-audio' and owner = auth.uid());
