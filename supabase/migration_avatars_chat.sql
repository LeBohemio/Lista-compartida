-- ============================================================================
-- Migración: fotos de perfil (avatares) + chat por lista
-- Pega este script completo en el SQL Editor de Supabase y ejecútalo una vez.
-- Es seguro volver a ejecutarlo (usa "if not exists" / "on conflict" / drops
-- previos) si algo falla a medias.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. AVATARES — columna en profiles + bucket público de Storage
-- ----------------------------------------------------------------------------
alter table public.profiles add column if not exists avatar_url text;

-- Bucket público: las fotos de perfil no son sensibles y así se pueden
-- mostrar con una URL pública simple (sin generar "signed URLs" cada vez)
-- en cualquier sitio de la app (miembros, ítems, gastos, chat...).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Convención de rutas: {user_id}/{archivo}. Cada usuario solo puede escribir
-- dentro de su propia carpeta.
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1]) = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1]) = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1]) = auth.uid()::text);

-- Lectura pública (necesaria para que las URLs públicas del bucket funcionen
-- también dentro de la política RLS de storage.objects, no solo por el flag
-- "public" del bucket).
drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public" on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'avatars');

-- ----------------------------------------------------------------------------
-- 2. MESSAGES — chat de texto/fotos por lista
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  content text,
  image_path text,
  created_at timestamptz not null default now(),
  check (content is not null or image_path is not null)
);

alter table public.messages enable row level security;

drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member" on public.messages
  for select to authenticated using (public.is_list_member(list_id, true));

drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member" on public.messages
  for insert to authenticated
  with check (public.is_list_member(list_id, true) and sender_id = auth.uid());

drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own" on public.messages
  for delete to authenticated using (sender_id = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 3. STORAGE — bucket privado para las fotos del chat (igual que "receipts":
--    solo visibles para los miembros aceptados de la lista correspondiente)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', false)
on conflict (id) do nothing;

-- Convención de rutas: {list_id}/{archivo}.
drop policy if exists "chat_images_insert_member" on storage.objects;
create policy "chat_images_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and public.is_list_member(((storage.foldername(name))[1])::uuid, true)
  );

drop policy if exists "chat_images_select_member" on storage.objects;
create policy "chat_images_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-images'
    and public.is_list_member(((storage.foldername(name))[1])::uuid, true)
  );

drop policy if exists "chat_images_delete_owner" on storage.objects;
create policy "chat_images_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-images' and owner = auth.uid());

-- ============================================================================
-- Fin de la migración.
-- ============================================================================
