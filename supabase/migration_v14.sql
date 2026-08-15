-- migration_v14: notificaciones push de verdad
--
-- Dos partes:
--
-- 1) public.push_subscriptions: una fila por cada "suscripción" del
--    navegador (Service Worker) de cada persona en cada dispositivo donde
--    ha activado las notificaciones. Puede haber varias filas por usuario
--    (móvil + escritorio, por ejemplo) — cada endpoint es su propio
--    dispositivo. La Edge Function que manda los avisos lee de aquí.
--
-- 2) Columnas en public.profiles para las preferencias: un interruptor
--    general (notify_push_enabled) y uno por tipo de aviso (chat, gastos,
--    invitaciones, pagos pendientes de confirmar). Por defecto todo
--    desactivado — se activan la primera vez que la persona da a "activar
--    notificaciones" en Ajustes, y a partir de ahí los 4 tipos empiezan
--    todos en "sí" (puede apagar los que no quiera individualmente).
--
-- Seguro de ejecutar más de una vez y sobre una base de datos ya en uso.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

-- Cada persona ve y gestiona solo sus propias suscripciones (sus propios
-- dispositivos). La Edge Function que manda los avisos no pasa por RLS: usa
-- la service_role key, así que puede leer las de todo el mundo para
-- mandarles su aviso.
drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own" on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

alter table public.profiles
  add column if not exists notify_push_enabled boolean not null default false,
  add column if not exists notify_chat boolean not null default true,
  add column if not exists notify_expenses boolean not null default true,
  add column if not exists notify_invites boolean not null default true,
  add column if not exists notify_settlements boolean not null default true;
