-- ============================================================================
-- Lista Compartida — migración v8
-- Pega esto en Supabase → SQL Editor → "New query" y ejecútalo una sola vez.
--
-- Incluye:
--  1) "Listas completadas": reutiliza la columna lists.archived_at (ya
--     existía) como el estado de "completada". La novedad es que ahora se
--     hace cumplir también a nivel de base de datos: mientras una lista está
--     completada, nadie puede añadir ni editar notas, gastos o mensajes de
--     chat en ella (solo consultar). Se puede reactivar en cualquier momento
--     desde la app para volver a editarla con normalidad.
-- ============================================================================

create or replace function public.is_list_archived(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select l.archived_at is not null from public.lists l where l.id = p_list_id), false);
$$;

grant execute on function public.is_list_archived(uuid) to authenticated;

-- Notas (items): no se pueden crear ni editar mientras la lista esté
-- completada. Sí se pueden seguir borrando (por si alguien quiere limpiar
-- antes de reactivar) y desde luego consultando.
drop policy if exists "items_insert_member" on public.items;
create policy "items_insert_member" on public.items
  for insert to authenticated
  with check (
    public.is_list_member(list_id, true)
    and created_by = auth.uid()
    and not public.is_list_archived(list_id)
  );

drop policy if exists "items_update_member" on public.items;
create policy "items_update_member" on public.items
  for update to authenticated
  using (public.is_list_member(list_id, true) and not public.is_list_archived(list_id));

-- Gastos (expenses): misma idea.
drop policy if exists "expenses_insert_member" on public.expenses;
create policy "expenses_insert_member" on public.expenses
  for insert to authenticated
  with check (
    public.is_list_member(list_id, true)
    and public.list_has_expenses_enabled(list_id)
    and created_by = auth.uid()
    and not public.is_list_archived(list_id)
  );

drop policy if exists "expenses_update_member" on public.expenses;
create policy "expenses_update_member" on public.expenses
  for update to authenticated
  using (
    public.is_list_member(list_id, true)
    and created_by = auth.uid()
    and not public.is_list_archived(list_id)
  );

-- Pagos que saldan deuda (settlements): tampoco tiene sentido registrar
-- pagos nuevos en una lista congelada.
drop policy if exists "settlements_insert_member" on public.settlements;
create policy "settlements_insert_member" on public.settlements
  for insert to authenticated
  with check (
    public.is_list_member(list_id, true)
    and public.list_has_expenses_enabled(list_id)
    and created_by = auth.uid()
    and (created_by = from_user or created_by = to_user)
    and not public.is_list_archived(list_id)
  );

-- Chat (messages): se puede seguir leyendo el historial completo, pero no
-- escribir mensajes nuevos mientras la lista esté completada.
drop policy if exists "messages_insert_member" on public.messages;
create policy "messages_insert_member" on public.messages
  for insert to authenticated
  with check (
    public.is_list_member(list_id, true)
    and sender_id = auth.uid()
    and not public.is_list_archived(list_id)
  );

-- ============================================================================
-- Fin de la migración v8.
-- ============================================================================
