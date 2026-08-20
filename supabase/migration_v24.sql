-- migration_v24: abrir 3 acciones a cualquier miembro de la lista
--
-- Hasta ahora "cambiar foto de la lista", "invitar" y "activar la pestaña
-- de gastos" solo los podía hacer quien creó la lista (el "owner"). A
-- partir de aquí puede hacerlos cualquier miembro aceptado. El resto
-- (nombre/color/moneda, eliminar miembros, marcar completada/reactivar,
-- borrar la lista) se queda exactamente igual que antes, solo para el
-- owner — eso lo sigue filtrando la política "lists_update_owner", que NO
-- se toca en esta migración.
--
-- Para "foto" y "gastos" (que tocan la tabla lists) usamos dos funciones
-- RPC en vez de abrir la política UPDATE general de "lists" a cualquier
-- miembro: así el resto de columnas (nombre, color, moneda, archived_at)
-- se quedan protegidas exactamente igual que antes, sin depender de un
-- trigger que filtre columna a columna.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

create or replace function public.set_list_photo(p_list_id uuid, p_photo_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_list_member(p_list_id, true) then
    raise exception 'No eres miembro de esta lista.';
  end if;
  update public.lists set photo_url = p_photo_url where id = p_list_id;
end;
$$;

create or replace function public.enable_list_expenses(p_list_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_list_member(p_list_id, true) then
    raise exception 'No eres miembro de esta lista.';
  end if;
  if public.is_list_archived(p_list_id) then
    raise exception 'Esta lista está completada.';
  end if;
  -- Solo permite ACTIVAR, nunca desactivar — desactivar gastos no es (ni
  -- era antes de esta migración) algo que exista en la app.
  update public.lists set expenses_enabled = true where id = p_list_id;
end;
$$;

grant execute on function public.set_list_photo(uuid, text) to authenticated;
grant execute on function public.enable_list_expenses(uuid) to authenticated;

-- Invitar: cualquier miembro aceptado puede añadir nuevos miembros con rol
-- "member". Insertar como "owner" se sigue reservando a quien ya es owner
-- (o al alta inicial de una lista vía create_list_with_owner).
drop policy if exists "list_members_insert_owner" on public.list_members;
drop policy if exists "list_members_insert_member" on public.list_members;
create policy "list_members_insert_member" on public.list_members
  for insert to authenticated
  with check (
    public.is_list_owner(list_id)
    or (user_id = auth.uid() and role = 'owner')
    or (role = 'member' and public.is_list_member(list_id, true))
  );

-- Foto de la lista: el bucket de storage también tiene que dejar subir,
-- reemplazar y quitar la foto a cualquier miembro, no solo al owner — si
-- no, subir la imagen fallaría en este paso aunque la función de arriba lo
-- permitiera.
drop policy if exists "list_photos_insert_owner" on storage.objects;
drop policy if exists "list_photos_insert_member" on storage.objects;
create policy "list_photos_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'list-photos'
    and public.is_list_member(((storage.foldername(name))[1])::uuid, true)
  );

drop policy if exists "list_photos_update_owner" on storage.objects;
drop policy if exists "list_photos_update_member" on storage.objects;
create policy "list_photos_update_member" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'list-photos'
    and public.is_list_member(((storage.foldername(name))[1])::uuid, true)
  );

drop policy if exists "list_photos_delete_owner" on storage.objects;
drop policy if exists "list_photos_delete_member" on storage.objects;
create policy "list_photos_delete_member" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'list-photos'
    and public.is_list_member(((storage.foldername(name))[1])::uuid, true)
  );
