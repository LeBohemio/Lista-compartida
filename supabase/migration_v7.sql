-- ============================================================================
-- Lista Compartida — migración v7
-- Pega esto en Supabase → SQL Editor → "New query" y ejecútalo una sola vez.
--
-- Incluye:
--  1) Arreglo de "borro algo y no desaparece hasta que refresco la página":
--     por defecto Postgres solo manda la clave primaria en los eventos de
--     borrado (DELETE) a Realtime. Si la política de seguridad (RLS) de la
--     tabla necesita otras columnas (como list_id) para decidir quién puede
--     ver ese evento, el DELETE puede no llegar a los demás dispositivos
--     conectados y su pantalla se queda "desactualizada" hasta que
--     recargan. Con REPLICA IDENTITY FULL, Postgres manda la fila completa
--     y el evento llega siempre.
--  2) profiles.background_color: color de fondo personalizado (aparte del
--     color de acento de los botones/burbujas).
--  3) profiles.language: idioma preferido de la app ('es' / 'en').
--  4) list_members.position / items.position: orden manual, para poder
--     arrastrar y reordenar tanto las listas como las notas.
-- ============================================================================

alter table public.lists replica identity full;
alter table public.list_members replica identity full;
alter table public.items replica identity full;
alter table public.expenses replica identity full;
alter table public.expense_shares replica identity full;
alter table public.settlements replica identity full;
alter table public.messages replica identity full;

alter table public.profiles add column if not exists background_color text;
alter table public.profiles add column if not exists language text not null default 'es' check (language in ('es', 'en'));

alter table public.list_members add column if not exists position integer;
alter table public.items add column if not exists position integer;

-- Backfill: asigna un orden inicial a lo ya existente, siguiendo el orden
-- que tenían hasta ahora (fijadas primero, luego por fecha de creación).
with ranked as (
  select list_id, user_id,
    row_number() over (partition by user_id order by pinned desc, created_at asc) as rn
  from public.list_members
  where position is null
)
update public.list_members lm
set position = ranked.rn
from ranked
where lm.list_id = ranked.list_id and lm.user_id = ranked.user_id;

with ranked_items as (
  select id, row_number() over (partition by list_id order by created_at asc) as rn
  from public.items
  where position is null
)
update public.items it
set position = ranked_items.rn
from ranked_items
where it.id = ranked_items.id;

-- ============================================================================
-- Fin de la migración v7.
-- ============================================================================
