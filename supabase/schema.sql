-- ============================================================================
-- Lista Compartida — esquema completo para Supabase (Postgres)
-- Pega este script completo en el SQL Editor de tu proyecto de Supabase
-- (Project → SQL Editor → New query) y ejecútalo una sola vez.
-- ============================================================================

-- Extensión para gen_random_uuid()
create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. PROFILES — perfil público de cada usuario registrado
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  email text not null unique,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cualquier usuario autenticado puede ver perfiles básicos (necesario para
-- buscar a quién invitar por email/usuario y para mostrar nombres de
-- miembros). No se exponen contraseñas ni datos sensibles, solo username/email.
create policy "profiles_select_authenticated" on public.profiles
  for select to authenticated using (true);

create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid());

-- Crea automáticamente el perfil cuando alguien se registra en Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2. LISTS
-- ----------------------------------------------------------------------------
create table if not exists public.lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  expenses_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.lists enable row level security;

-- ----------------------------------------------------------------------------
-- 3. LIST_MEMBERS
-- ----------------------------------------------------------------------------
create table if not exists public.list_members (
  list_id uuid not null references public.lists (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'invited' check (status in ('invited', 'accepted')),
  invited_identifier text not null default '',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (list_id, user_id)
);

alter table public.list_members enable row level security;

-- Funciones auxiliares SECURITY DEFINER: evitan recursión infinita en las
-- políticas RLS de list_members (una policy de list_members no puede
-- consultar list_members directamente sin recursión) y centralizan la
-- comprobación de pertenencia.
create or replace function public.is_list_member(p_list_id uuid, p_require_accepted boolean default true)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.list_members lm
    where lm.list_id = p_list_id
      and lm.user_id = auth.uid()
      and (not p_require_accepted or lm.status = 'accepted')
  );
$$;

create or replace function public.is_list_owner(p_list_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.lists l
    where l.id = p_list_id and l.owner_id = auth.uid()
  );
$$;

create or replace function public.list_has_expenses_enabled(p_list_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select l.expenses_enabled from public.lists l where l.id = p_list_id), false);
$$;

-- Políticas de LISTS (definidas aquí porque dependen de las funciones anteriores)
create policy "lists_select_member" on public.lists
  for select to authenticated
  using (public.is_list_member(id, false));

create policy "lists_insert_owner" on public.lists
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy "lists_update_owner" on public.lists
  for update to authenticated
  using (owner_id = auth.uid());

create policy "lists_delete_owner" on public.lists
  for delete to authenticated
  using (owner_id = auth.uid());

-- Políticas de LIST_MEMBERS
create policy "list_members_select" on public.list_members
  for select to authenticated
  using (user_id = auth.uid() or public.is_list_member(list_id, true) or public.is_list_owner(list_id));

create policy "list_members_insert_owner" on public.list_members
  for insert to authenticated
  with check (public.is_list_owner(list_id) or (user_id = auth.uid() and role = 'owner'));

create policy "list_members_update" on public.list_members
  for update to authenticated
  using (user_id = auth.uid() or public.is_list_owner(list_id));

create policy "list_members_delete" on public.list_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_list_owner(list_id));

-- ----------------------------------------------------------------------------
-- 4. ITEMS (notas / tareas de cada lista)
-- ----------------------------------------------------------------------------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  content text not null,
  done boolean not null default false,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  done_at timestamptz
);

alter table public.items enable row level security;

create policy "items_select_member" on public.items
  for select to authenticated using (public.is_list_member(list_id, true));

create policy "items_insert_member" on public.items
  for insert to authenticated with check (public.is_list_member(list_id, true) and created_by = auth.uid());

create policy "items_update_member" on public.items
  for update to authenticated using (public.is_list_member(list_id, true));

create policy "items_delete_member" on public.items
  for delete to authenticated using (public.is_list_member(list_id, true));

-- ----------------------------------------------------------------------------
-- 5. EXPENSES (gastos con ticket)
-- ----------------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  description text,
  total_amount numeric(10, 2) not null check (total_amount > 0),
  receipt_image_path text,
  ocr_confidence numeric(5, 2),
  paid_by uuid not null references public.profiles (id),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

alter table public.expenses enable row level security;

create policy "expenses_select_member" on public.expenses
  for select to authenticated using (public.is_list_member(list_id, true));

create policy "expenses_insert_member" on public.expenses
  for insert to authenticated
  with check (
    public.is_list_member(list_id, true)
    and public.list_has_expenses_enabled(list_id)
    and created_by = auth.uid()
  );

create policy "expenses_delete_member" on public.expenses
  for delete to authenticated using (public.is_list_member(list_id, true) and created_by = auth.uid());

-- ----------------------------------------------------------------------------
-- 6. EXPENSE_SHARES (reparto de cada gasto)
-- ----------------------------------------------------------------------------
create table if not exists public.expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  amount numeric(10, 2) not null check (amount >= 0),
  unique (expense_id, user_id)
);

alter table public.expense_shares enable row level security;

create policy "expense_shares_select_member" on public.expense_shares
  for select to authenticated using (
    exists (
      select 1 from public.expenses e
      where e.id = expense_id and public.is_list_member(e.list_id, true)
    )
  );

create policy "expense_shares_insert_member" on public.expense_shares
  for insert to authenticated with check (
    exists (
      select 1 from public.expenses e
      where e.id = expense_id and public.is_list_member(e.list_id, true) and e.created_by = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 7. SETTLEMENTS (pagos que saldan deuda entre dos miembros)
-- ----------------------------------------------------------------------------
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  from_user uuid not null references public.profiles (id),
  to_user uuid not null references public.profiles (id),
  amount numeric(10, 2) not null check (amount > 0),
  note text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);

alter table public.settlements enable row level security;

create policy "settlements_select_member" on public.settlements
  for select to authenticated using (public.is_list_member(list_id, true));

create policy "settlements_insert_member" on public.settlements
  for insert to authenticated with check (
    public.is_list_member(list_id, true)
    and public.list_has_expenses_enabled(list_id)
    and created_by = auth.uid()
    and (created_by = from_user or created_by = to_user)
  );

-- ----------------------------------------------------------------------------
-- 7bis. MESSAGES (chat de texto/fotos por lista)
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

create policy "messages_select_member" on public.messages
  for select to authenticated using (public.is_list_member(list_id, true));

create policy "messages_insert_member" on public.messages
  for insert to authenticated
  with check (public.is_list_member(list_id, true) and sender_id = auth.uid());

create policy "messages_delete_own" on public.messages
  for delete to authenticated using (sender_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 8. REALTIME — publica los cambios para que otros miembros los reciban
--    automáticamente sin recargar.
-- ----------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.list_members;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.expenses;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.expense_shares;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.settlements;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.lists;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 9. STORAGE — bucket privado para las fotos de tickets
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Convención de rutas: {list_id}/{archivo}. storage.foldername(name) devuelve
-- un array con los segmentos de carpeta, así que (storage.foldername(name))[1]
-- es el list_id.
create policy "receipts_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and public.is_list_member(((storage.foldername(name))[1])::uuid, true)
  );

create policy "receipts_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and public.is_list_member(((storage.foldername(name))[1])::uuid, true)
  );

create policy "receipts_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and owner = auth.uid());

-- ----------------------------------------------------------------------------
-- 10. STORAGE — bucket público para las fotos de perfil (avatares)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Convención de rutas: {user_id}/{archivo}.
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and ((storage.foldername(name))[1]) = auth.uid()::text);

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1]) = auth.uid()::text);

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and ((storage.foldername(name))[1]) = auth.uid()::text);

create policy "avatars_select_public" on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'avatars');

-- ----------------------------------------------------------------------------
-- 11. STORAGE — bucket privado para las fotos del chat
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', false)
on conflict (id) do nothing;

-- Convención de rutas: {list_id}/{archivo}.
create policy "chat_images_insert_member" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-images'
    and public.is_list_member(((storage.foldername(name))[1])::uuid, true)
  );

create policy "chat_images_select_member" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-images'
    and public.is_list_member(((storage.foldername(name))[1])::uuid, true)
  );

create policy "chat_images_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-images' and owner = auth.uid());

-- ============================================================================
-- Fin del script. Ya puedes conectar la app con la URL y la anon key
-- de este proyecto (Project Settings → API).
-- ============================================================================
