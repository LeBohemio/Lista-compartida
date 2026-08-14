-- ============================================================================
-- Migración v3: mensajes no leídos, agrupación de chat, editar/eliminar
-- gastos, eliminar miembros, renombrar listas, color por lista.
-- Pega este script completo en el SQL Editor de Supabase y ejecútalo una vez.
-- Es seguro volver a ejecutarlo si algo falla a medias.
-- ============================================================================

-- Para la burbuja de "mensajes sin leer" en la pestaña Chat.
alter table public.list_members add column if not exists last_read_message_at timestamptz;

-- Color identificativo de cada lista (hex, ej. "#6366f1"). Si es null, la app
-- calcula un color estable a partir del nombre.
alter table public.lists add column if not exists color text;

-- Faltaba poder actualizar un gasto propio (para el editor de gastos).
drop policy if exists "expenses_update_member" on public.expenses;
create policy "expenses_update_member" on public.expenses
  for update to authenticated
  using (public.is_list_member(list_id, true) and created_by = auth.uid());

-- Faltaba poder borrar el reparto de un gasto propio (para poder editarlo:
-- se borran las líneas de reparto antiguas y se insertan las nuevas).
drop policy if exists "expense_shares_delete_member" on public.expense_shares;
create policy "expense_shares_delete_member" on public.expense_shares
  for delete to authenticated
  using (
    exists (
      select 1 from public.expenses e
      where e.id = expense_id and public.is_list_member(e.list_id, true) and e.created_by = auth.uid()
    )
  );

-- ============================================================================
-- Fin de la migración.
-- ============================================================================
