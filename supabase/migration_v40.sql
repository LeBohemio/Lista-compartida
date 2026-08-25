-- migration_v40: aviso push al invitar a una nota + invitar a una nota
-- abierto a cualquier miembro (como ya pasaba en listas) + límites de tamaño
-- y tipo de archivo en los buckets de almacenamiento.
--
-- Segura de ejecutar más de una vez.

-- ----------------------------------------------------------------------------
-- 1. Aviso push al invitar a una nota compartida.
--
-- La función notify_send_push() (ver migration_v19.sql) ya existe y ya la
-- usan los triggers de "messages", "expenses", "list_members" y
-- "settlements" — aquí solo hace falta un trigger más, sobre "note_members",
-- para que también dispare un aviso cuando se invita a alguien a una nota.
-- No se toca la función en sí, así que esto no afecta a ningún aviso que ya
-- funcionaba antes.
--
-- El lado que decide QUÉ dice el aviso (título, texto, a quién) vive en la
-- función send-push (ver supabase/functions/send-push/index.ts,
-- handleNoteMembers) — este trigger solo dispara la llamada.
-- ----------------------------------------------------------------------------
drop trigger if exists note_members_notify_push on public.note_members;
create trigger note_members_notify_push
  after insert on public.note_members
  for each row execute function public.notify_send_push();

-- ----------------------------------------------------------------------------
-- 2. Invitar a una nota: abrirlo a cualquier miembro aceptado, no solo al
-- dueño — mismo cambio que migration_v24.sql ya hizo para listas
-- (list_members_insert_member). Hasta ahora note_members_insert_owner
-- (migration_v23.sql / migration_v26.sql) solo dejaba insertar la fila de
-- invitación al dueño de la nota; con este cambio, cualquier miembro ya
-- aceptado también puede invitar a alguien más.
-- ----------------------------------------------------------------------------
drop policy if exists "note_members_insert_owner" on public.note_members;
create policy "note_members_insert_owner" on public.note_members
  for insert to authenticated
  with check (
    (
      public.is_note_owner(note_id)
      or (user_id = auth.uid() and role = 'owner')
      or (role = 'member' and public.is_note_member(note_id, true))
    )
    and (invited_by is null or not public.contacts_blocked(user_id, invited_by))
  );

-- ----------------------------------------------------------------------------
-- 3. Límites de tamaño y tipo de archivo en los buckets de almacenamiento.
--
-- Hasta ahora ningún bucket tenía límite: cualquiera con la app modificada
-- (saltándose los "accept" del formulario, que solo filtran en el propio
-- navegador) podía subir un archivo de cualquier tipo y tamaño. Esto pone un
-- límite de verdad, comprobado por Supabase antes de guardar el archivo, a
-- juego con lo que cada pantalla ya deja elegir hoy.
-- ----------------------------------------------------------------------------
update storage.buckets
set file_size_limit = 5242880, -- 5 MB (las fotos de perfil/lista se recortan a 480x480 antes de subir)
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('avatars', 'list-photos');

update storage.buckets
set file_size_limit = 8388608, -- 8 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'receipts';

update storage.buckets
set file_size_limit = 8388608, -- 8 MB
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'chat-images';

update storage.buckets
set file_size_limit = 15728640, -- 15 MB
    allowed_mime_types = array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg']
where id = 'chat-audio';

update storage.buckets
set file_size_limit = 20971520, -- 20 MB (a juego con el "accept" del selector de archivos del chat)
    allowed_mime_types = array[
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
where id = 'chat-files';
