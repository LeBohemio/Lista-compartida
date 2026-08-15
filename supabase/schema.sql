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
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  accent_color text,
  background_color text,
  language text not null default 'es' check (language in ('es', 'en')),
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
  color text,
  archived_at timestamptz,
  last_activity_at timestamptz not null default now(),
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
  pinned boolean not null default false,
  position integer,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  last_read_message_at timestamptz,
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

-- Una lista "completada" (archived_at no nulo) queda en modo consulta: se
-- puede seguir leyendo todo (notas, gastos, chat) pero no añadir ni editar
-- nada nuevo hasta que se reactive.
create or replace function public.is_list_archived(p_list_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select l.archived_at is not null from public.lists l where l.id = p_list_id), false);
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
  due_date date,
  position integer,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

alter table public.items enable row level security;

create policy "items_select_member" on public.items
  for select to authenticated using (public.is_list_member(list_id, true));

create policy "items_insert_member" on public.items
  for insert to authenticated
  with check (
    public.is_list_member(list_id, true)
    and created_by = auth.uid()
    and not public.is_list_archived(list_id)
  );

create policy "items_update_member" on public.items
  for update to authenticated
  using (public.is_list_member(list_id, true) and not public.is_list_archived(list_id));

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
  category text not null default 'otros'
    check (category in ('comida', 'transporte', 'alojamiento', 'ocio', 'compras', 'otros')),
  paid_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
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
    and not public.is_list_archived(list_id)
  );

create policy "expenses_delete_member" on public.expenses
  for delete to authenticated using (public.is_list_member(list_id, true) and created_by = auth.uid());

create policy "expenses_update_member" on public.expenses
  for update to authenticated
  using (
    public.is_list_member(list_id, true)
    and created_by = auth.uid()
    and not public.is_list_archived(list_id)
  );

-- ----------------------------------------------------------------------------
-- 6. EXPENSE_SHARES (reparto de cada gasto)
-- ----------------------------------------------------------------------------
create table if not exists public.expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
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

create policy "expense_shares_delete_member" on public.expense_shares
  for delete to authenticated using (
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
  from_user uuid references public.profiles (id) on delete set null,
  to_user uuid references public.profiles (id) on delete set null,
  amount numeric(10, 2) not null check (amount > 0),
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (from_user is distinct from to_user)
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
    and not public.is_list_archived(list_id)
  );

-- ----------------------------------------------------------------------------
-- 7bis. MESSAGES (chat de texto/fotos por lista)
-- ----------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
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
  with check (
    public.is_list_member(list_id, true)
    and sender_id = auth.uid()
    and not public.is_list_archived(list_id)
  );

create policy "messages_delete_own" on public.messages
  for delete to authenticated using (sender_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 7ter. ITEM_SUGGESTIONS — recuerda qué notas sueles añadir en cada lista
-- (por lista, no globales) para poder sugerírtelas con un toque más adelante,
-- incluso si ya borraste la nota original.
-- ----------------------------------------------------------------------------
create table if not exists public.item_suggestions (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.lists (id) on delete cascade,
  content text not null,
  normalized text not null,
  use_count integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (list_id, normalized)
);

alter table public.item_suggestions enable row level security;

create policy "item_suggestions_select_member" on public.item_suggestions
  for select to authenticated using (public.is_list_member(list_id, true));

create policy "item_suggestions_insert_member" on public.item_suggestions
  for insert to authenticated with check (public.is_list_member(list_id, true));

create policy "item_suggestions_update_member" on public.item_suggestions
  for update to authenticated using (public.is_list_member(list_id, true));

create or replace function public.bump_item_suggestion(p_list_id uuid, p_content text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_normalized text := lower(trim(p_content));
begin
  if v_normalized = '' then
    return;
  end if;

  insert into public.item_suggestions (list_id, content, normalized, use_count, updated_at)
  values (p_list_id, trim(p_content), v_normalized, 1, now())
  on conflict (list_id, normalized)
  do update set
    use_count = public.item_suggestions.use_count + 1,
    updated_at = now(),
    content = excluded.content;
end;
$$;

grant execute on function public.bump_item_suggestion(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 7quater. ACTIVIDAD RECIENTE — lists.last_activity_at se actualiza sola con
-- cada nota, gasto, mensaje o pago, para poder ordenar "Mis listas" por
-- actividad reciente.
-- ----------------------------------------------------------------------------
create or replace function public.touch_list_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lists set last_activity_at = now() where id = coalesce(new.list_id, old.list_id);
  return coalesce(new, old);
end;
$$;

create trigger items_touch_activity
  after insert or update on public.items
  for each row execute function public.touch_list_activity();

create trigger expenses_touch_activity
  after insert on public.expenses
  for each row execute function public.touch_list_activity();

create trigger messages_touch_activity
  after insert on public.messages
  for each row execute function public.touch_list_activity();

create trigger settlements_touch_activity
  after insert on public.settlements
  for each row execute function public.touch_list_activity();

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

do $$
begin
  alter publication supabase_realtime add table public.item_suggestions;
exception when duplicate_object then null;
end $$;

-- REPLICA IDENTITY FULL: para que los eventos de borrado (DELETE) lleguen
-- siempre a los demás miembros conectados aunque la política de RLS
-- necesite columnas fuera de la clave primaria (p.ej. list_id) para decidir
-- quién puede recibir el evento. Sin esto, un borrado puede no reflejarse
-- en otros dispositivos hasta que recargan la página.
alter table public.lists replica identity full;
alter table public.list_members replica identity full;
alter table public.items replica identity full;
alter table public.expenses replica identity full;
alter table public.expense_shares replica identity full;
alter table public.settlements replica identity full;
alter table public.messages replica identity full;

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

-- ----------------------------------------------------------------------------
-- 12. ELIMINAR CUENTA — función que el propio usuario ejecuta para borrarse.
-- Si es creador de alguna lista con más miembros, transfiere la propiedad
-- al más antiguo antes de borrarse; si estaba solo, esa lista se borra con
-- él (por la cascada de lists.owner_id).
-- ----------------------------------------------------------------------------
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rec record;
  new_owner uuid;
begin
  if uid is null then
    raise exception 'No autenticado';
  end if;

  for rec in select id from public.lists where owner_id = uid loop
    select user_id into new_owner
    from public.list_members
    where list_id = rec.id and user_id <> uid and status = 'accepted'
    order by created_at asc
    limit 1;

    if new_owner is not null then
      update public.lists set owner_id = new_owner where id = rec.id;
      update public.list_members set role = 'owner' where list_id = rec.id and user_id = new_owner;
      update public.list_members set role = 'member' where list_id = rec.id and user_id = uid;
    end if;
  end loop;

  delete from auth.users where id = uid;
end;
$$;

grant execute on function public.delete_own_account() to authenticated;

-- ============================================================================
-- Fin del script. Ya puedes conectar la app con la URL y la anon key
-- de este proyecto (Project Settings → API).
-- ============================================================================
