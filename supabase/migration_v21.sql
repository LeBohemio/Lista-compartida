-- migration_v21: foto de la lista/grupo (como el icono de grupo de WhatsApp)
--
-- Añade una foto opcional por lista: se ve en "Mis listas", en la cabecera
-- de la lista (sustituyendo al punto de color) y en el icono de la
-- notificación push de esa lista. Solo quien creó la lista (el "owner")
-- puede ponerla o cambiarla — mismo criterio que ya se usa para el nombre y
-- el color de la lista.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

alter table public.lists add column if not exists photo_url text;

-- Bucket público (como "avatars"): la foto de una lista no es sensible y así
-- se puede mostrar con una URL pública simple, sin generar "signed URLs"
-- cada vez, tanto dentro de la app como en el icono de una notificación.
insert into storage.buckets (id, name, public)
values ('list-photos', 'list-photos', true)
on conflict (id) do update set public = true;

-- Convención de rutas: {list_id}/{archivo}. Solo el owner de esa lista
-- puede escribir dentro de su carpeta.
drop policy if exists "list_photos_insert_owner" on storage.objects;
create policy "list_photos_insert_owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'list-photos'
    and public.is_list_owner(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "list_photos_update_owner" on storage.objects;
create policy "list_photos_update_owner" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'list-photos'
    and public.is_list_owner(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "list_photos_delete_owner" on storage.objects;
create policy "list_photos_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'list-photos'
    and public.is_list_owner(((storage.foldername(name))[1])::uuid)
  );

-- Lectura pública (igual que "avatars" — necesaria para que las URLs
-- públicas del bucket funcionen también dentro de la política RLS, no solo
-- por el flag "public" del bucket).
drop policy if exists "list_photos_select_public" on storage.objects;
create policy "list_photos_select_public" on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'list-photos');
