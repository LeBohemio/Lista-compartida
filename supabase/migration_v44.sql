-- migration_v44: adjuntar un archivo (factura en PDF, Word…) a un gasto
--
-- Hasta ahora un gasto solo podía llevar una foto de ticket
-- (receipt_image_path, pensada para el OCR que rellena el importe solo).
-- Esto añade un adjunto general y aparte, para guardar por ejemplo la
-- factura en PDF de la luz o el gas junto al gasto, sin que tenga que
-- pasar por el OCR ni sustituir la foto del ticket.
--
-- Mismo patrón que el adjunto de archivo en el chat (migration_v31.sql):
-- columnas para la ruta, el nombre original, el tipo y el peso, más un
-- bucket propio de Storage con sus políticas.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

-- ----------------------------------------------------------------------------
-- 1. EXPENSES — columnas para el archivo adjunto.
-- ----------------------------------------------------------------------------
alter table public.expenses add column if not exists file_path text;
alter table public.expenses add column if not exists file_name text;
alter table public.expenses add column if not exists file_mime_type text;
alter table public.expenses add column if not exists file_size_bytes bigint;

-- ----------------------------------------------------------------------------
-- 2. STORAGE — bucket propio "expense-files" (no se reutiliza ninguno de
--    chat: un gasto no tiene conversación directa, siempre pertenece a una
--    lista, así que la comprobación es más simple — basta con mirar si la
--    persona es miembro de esa lista).
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('expense-files', 'expense-files', false)
on conflict (id) do nothing;

-- La ruta de cada archivo es "{list_id}/{archivo}" (un único segmento de
-- carpeta, igual que la convención de gastos/tickets) — esta función
-- comprueba que quien pide acceso es miembro aceptado de esa lista. El
-- cast a uuid va en su propio bloque con manejo de excepción por si el
-- primer segmento de la ruta no tuviera esa forma.
create or replace function public.is_expense_file_list_member(p_path_segments text[])
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_list_id uuid;
begin
  if p_path_segments is null or array_length(p_path_segments, 1) <> 1 then
    return false;
  end if;
  begin
    v_list_id := p_path_segments[1]::uuid;
  exception when others then
    return false;
  end;
  return public.is_list_member(v_list_id, true);
end;
$$;

drop policy if exists "expense_files_insert_member" on storage.objects;
create policy "expense_files_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expense-files'
    and public.is_expense_file_list_member(storage.foldername(name))
  );

drop policy if exists "expense_files_select_member" on storage.objects;
create policy "expense_files_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expense-files'
    and public.is_expense_file_list_member(storage.foldername(name))
  );

drop policy if exists "expense_files_delete_owner" on storage.objects;
create policy "expense_files_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'expense-files' and owner = auth.uid());
