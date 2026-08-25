-- ============================================================================
-- migration_v39.sql — protección básica contra fuerza bruta en el login y
-- contra "spam" de registros repetidos, sin depender de ningún servicio
-- externo (todo se resuelve con esta tabla + un par de funciones RPC).
--
-- Cómo funciona:
--   - "login": tras varios intentos de contraseña incorrecta seguidos con el
--     mismo email, se bloquea ese email un rato antes de dejar intentarlo de
--     nuevo (igual que hacen la mayoría de apps con inicio de sesión).
--   - "signup": si alguien (o un script) intenta crear cuentas o repetir el
--     registro muchas veces seguidas con el mismo email en poco tiempo, se
--     bloquea igual un rato.
--
-- Los dos casos comparten la misma tabla y las mismas funciones (con un
-- "kind" que distingue uno de otro) para no duplicar la misma lógica dos
-- veces. Las funciones son SECURITY DEFINER porque hace falta poder leerlas
-- y escribirlas ANTES de haber iniciado sesión (con el rol "anon" que usa
-- la app en las pantallas de entrar/registrarse), así que no tiene sentido
-- protegerlas con políticas de RLS normales — en su lugar, no se da ningún
-- permiso directo sobre la tabla y solo se puede tocar a través de estas
-- funciones, que llevan su propia lógica de límites incorporada.
-- ============================================================================

create table if not exists public.auth_rate_limits (
  kind text not null check (kind in ('login', 'signup')),
  email text not null,
  failed_count int not null default 0,
  last_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  primary key (kind, email)
);

alter table public.auth_rate_limits enable row level security;
-- A propósito, ninguna policy: nadie lee ni escribe esta tabla directamente
-- desde el cliente, solo a través de las funciones de abajo.

-- Consulta si un email está bloqueado ahora mismo para un tipo de acción
-- ("login" o "signup"), sin tocar ni sumar nada. Se llama ANTES de intentar
-- la acción de verdad, para no gastar ni un intento de Supabase Auth si ya
-- sabemos que está bloqueado.
create or replace function public.check_auth_rate_limit(p_kind text, p_email text)
returns table (locked boolean, seconds_remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_row public.auth_rate_limits%rowtype;
begin
  select * into v_row from public.auth_rate_limits where kind = p_kind and email = v_email;
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return query select true, greatest(1, ceil(extract(epoch from (v_row.locked_until - now())))::int);
  else
    return query select false, 0;
  end if;
end;
$$;

-- Registra un intento (login fallido, o intento de registro) y decide si
-- con este ya toca bloquear. p_max_attempts/p_window_minutes/p_lockout_minutes
-- los decide quien la llama, para poder usar límites distintos en login y en
-- signup sin tocar la función.
--
-- Ventana deslizante simple: si el último intento fue hace más de
-- p_window_minutes, se olvida lo anterior y se empieza a contar de cero en
-- vez de ir sumando sobre intentos ya muy antiguos.
create or replace function public.register_auth_attempt(
  p_kind text,
  p_email text,
  p_max_attempts int,
  p_window_minutes int,
  p_lockout_minutes int
)
returns table (locked boolean, seconds_remaining int, attempts_remaining int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_row public.auth_rate_limits%rowtype;
  v_next_count int;
begin
  select * into v_row from public.auth_rate_limits where kind = p_kind and email = v_email for update;

  if v_row.email is null then
    insert into public.auth_rate_limits (kind, email, failed_count, last_attempt_at)
    values (p_kind, v_email, 1, now());
    return query select false, 0, greatest(0, p_max_attempts - 1);
    return;
  end if;

  -- Ya estaba bloqueado y el bloqueo sigue vigente: no sumamos más (así un
  -- script que insiste no alarga el bloqueo indefinidamente) y devolvemos
  -- el tiempo que queda.
  if v_row.locked_until is not null and v_row.locked_until > now() then
    return query select true, greatest(1, ceil(extract(epoch from (v_row.locked_until - now())))::int), 0;
    return;
  end if;

  if v_row.last_attempt_at < now() - (p_window_minutes || ' minutes')::interval then
    v_next_count := 1;
  else
    v_next_count := v_row.failed_count + 1;
  end if;

  if v_next_count >= p_max_attempts then
    update public.auth_rate_limits
      set failed_count = v_next_count,
          last_attempt_at = now(),
          locked_until = now() + (p_lockout_minutes || ' minutes')::interval
      where kind = p_kind and email = v_email;
    return query select true, p_lockout_minutes * 60, 0;
    return;
  end if;

  update public.auth_rate_limits
    set failed_count = v_next_count, last_attempt_at = now(), locked_until = null
    where kind = p_kind and email = v_email;
  return query select false, 0, greatest(0, p_max_attempts - v_next_count);
end;
$$;

-- Se llama tras un login que sí ha funcionado, para que la siguiente vez
-- que falle algo empiece a contar de cero (si no, alguien que se equivoca
-- una vez de vez en cuando podría ir acumulando intentos "fallidos" viejos
-- para siempre).
create or replace function public.clear_auth_rate_limit(p_kind text, p_email text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.auth_rate_limits where kind = p_kind and email = lower(trim(p_email));
$$;

grant execute on function public.check_auth_rate_limit(text, text) to anon, authenticated;
grant execute on function public.register_auth_attempt(text, text, int, int, int) to anon, authenticated;
grant execute on function public.clear_auth_rate_limit(text, text) to anon, authenticated;
