-- migration_v45: salir de una lista sin perder tu contabilidad personal
--
-- Hasta ahora, borrar una lista de la que eras dueño la borraba de golpe
-- para TODO el mundo (cascada: sus gastos y liquidaciones desaparecían de
-- la contabilidad de cualquiera que hubiera pagado algo ahí, sin avisar a
-- nadie). Esto añade tres piezas para arreglarlo:
--
-- 1. transfer_list_ownership_and_leave(): si una lista tiene más gente,
--    quien la borraba ahora en realidad SALE de ella, cediendo antes el
--    mando a otro miembro que elige — la lista y los gastos de todo el
--    mundo se quedan exactamente igual, nadie más se ve afectado.
--
-- 2. personal_expense_exclusions: al salir de una lista (o ceder el mando y
--    salir) donde habías pagado algo, puedes elegir que esos gastos dejen
--    de contar en TU "Mis gastos" — sin tocar ni un dato de la lista real,
--    que sigue intacta para quien se queda en ella.
--
-- 3. personal_expense_carryover: al borrar de verdad una lista donde estás
--    tú solo (sin nadie más dentro, así que sí desaparece del todo por la
--    cascada de siempre), puedes elegir guardar un resumen de lo tuyo antes
--    de que se borre, para que tu "Mis gastos" lo siga contando aunque la
--    lista ya no exista.
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

-- ----------------------------------------------------------------------------
-- 1. CEDER EL MANDO Y SALIR — mismo patrón que delete_own_account() (ver
--    schema.sql), pero con la persona destino elegida a mano en vez de
--    escogida en automático, y ejecutada por quien sigue siendo dueño de la
--    lista (no por quien se está borrando la cuenta entera).
--
--    SECURITY DEFINER hace falta porque la política de "lists" solo deja
--    actualizar una fila si owner_id sigue siendo auth.uid() incluso
--    DESPUÉS del cambio (no hay un "with check" propio, así que reutiliza
--    el mismo "using") — cambiar el dueño a otra persona nunca pasaría esa
--    comprobación desde el propio cliente.
-- ----------------------------------------------------------------------------
create or replace function public.transfer_list_ownership_and_leave(p_list_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'No autenticado';
  end if;

  if not exists (select 1 from public.lists where id = p_list_id and owner_id = uid) then
    raise exception 'Solo quien es dueño de la lista puede ceder el mando.';
  end if;

  if p_new_owner = uid then
    raise exception 'Elige a otra persona distinta de ti.';
  end if;

  if not exists (
    select 1 from public.list_members
    where list_id = p_list_id and user_id = p_new_owner and status = 'accepted'
  ) then
    raise exception 'Esa persona no es miembro de la lista.';
  end if;

  update public.lists set owner_id = p_new_owner where id = p_list_id;
  update public.list_members set role = 'owner' where list_id = p_list_id and user_id = p_new_owner;
  delete from public.list_members where list_id = p_list_id and user_id = uid;
end;
$$;

grant execute on function public.transfer_list_ownership_and_leave(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. PERSONAL_EXPENSE_EXCLUSIONS — "deja de contar los gastos de esta lista
--    en mi Mis Gastos", sin borrar ni tocar nada de la lista real. Se
--    consulta desde MyExpensesModal.tsx junto con expenses/settlements.
-- ----------------------------------------------------------------------------
create table if not exists public.personal_expense_exclusions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, list_id)
);

alter table public.personal_expense_exclusions enable row level security;

drop policy if exists "expense_exclusions_select_own" on public.personal_expense_exclusions;
create policy "expense_exclusions_select_own" on public.personal_expense_exclusions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "expense_exclusions_insert_own" on public.personal_expense_exclusions;
create policy "expense_exclusions_insert_own" on public.personal_expense_exclusions
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "expense_exclusions_delete_own" on public.personal_expense_exclusions;
create policy "expense_exclusions_delete_own" on public.personal_expense_exclusions
  for delete to authenticated using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. PERSONAL_EXPENSE_CARRYOVER — resumen mes a mes de lo tuyo en una lista
--    que se ha borrado del todo (solo tú dentro), para que tu Mis Gastos lo
--    siga contando aunque los gastos originales ya no existan. Es un
--    registro histórico: no se edita ni se borra después de crearse (aparte
--    de por el "reiniciar mi contabilidad" de siempre, que filtra por
--    fecha, igual que ya hace con expenses/settlements).
-- ----------------------------------------------------------------------------
create table if not exists public.personal_expense_carryover (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  list_name text not null,
  list_color text,
  currency text not null,
  period_start date not null,
  paid_directly numeric(10, 2) not null default 0,
  paid_to_settle numeric(10, 2) not null default 0,
  collected numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.personal_expense_carryover enable row level security;

drop policy if exists "carryover_select_own" on public.personal_expense_carryover;
create policy "carryover_select_own" on public.personal_expense_carryover
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "carryover_insert_own" on public.personal_expense_carryover;
create policy "carryover_insert_own" on public.personal_expense_carryover
  for insert to authenticated with check (user_id = auth.uid());
