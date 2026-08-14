-- Función segura para crear una lista + la membresía del creador como owner,
-- en un único paso atómico, derivando el propietario de auth.uid() en el
-- propio servidor (en vez de depender de que el cliente mande el valor
-- correcto y de la política RLS de INSERT directo sobre "lists").
create or replace function public.create_list_with_owner(p_name text, p_expenses_enabled boolean default false)
returns public.lists
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list public.lists;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  insert into public.lists (name, owner_id, expenses_enabled)
  values (p_name, auth.uid(), coalesce(p_expenses_enabled, false))
  returning * into v_list;

  select email into v_email from auth.users where id = auth.uid();

  insert into public.list_members (list_id, user_id, role, status, invited_identifier, responded_at)
  values (v_list.id, auth.uid(), 'owner', 'accepted', coalesce(v_email, ''), now());

  return v_list;
end;
$$;

grant execute on function public.create_list_with_owner(text, boolean) to authenticated;
