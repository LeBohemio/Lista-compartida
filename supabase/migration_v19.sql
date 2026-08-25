-- migration_v19: conecta de verdad los avisos push a lo que pasa en la app.
--
-- OJO: el secreto que aparece más abajo, escrito a mano, quedó expuesto en
-- el repositorio (cualquiera con acceso a él podía leerlo) y se rotó en
-- migration_v41.sql — ese valor ya NO es el que usa la función de verdad,
-- este archivo se deja tal cual solo como historial de cómo se hizo.
--
-- Hasta ahora la función "send-push" existía y funcionaba, pero nada la
-- llamaba nunca — el panel de "Database Webhooks" de Supabase no está
-- disponible en este proyecto (lo comprobamos a fondo: ni apareciendo en
-- el menú, ni activando pg_net aparecía la opción). Esto hace exactamente
-- lo mismo que habría hecho ese Webhook, pero mediante un trigger de base
-- de datos que llama directamente a pg_net — es el patrón que la propia
-- documentación de Supabase recomienda cuando se define un webhook "a
-- mano" en una migración en vez de por el panel.
--
-- Cada vez que se inserta una fila en "messages" (chat), "expenses"
-- (gasto nuevo), "list_members" (invitación) o "settlements" (pago
-- pendiente de confirmar), este trigger avisa a la función send-push, que
-- decide a quién mandarle un aviso push de verdad según sus preferencias.
--
-- Requiere:
--   1. La extensión pg_net ya activada (Database → Extensions) — ya lo
--      hicimos.
--   2. La función send-push desplegada con la opción --no-verify-jwt (ver
--      LEEME_PRIMERO.md) — si no, Supabase rechaza la llamada con un 401
--      antes de que la función llegue siquiera a mirar el aviso.
--
-- Segura de ejecutar más de una vez.

create or replace function public.notify_send_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url := 'https://gkznxjlsvcequoypkfcw.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', '5d185c35167c18eb6e47b175002513d3929c63dc3033d035'
      ),
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', TG_TABLE_NAME,
        'record', to_jsonb(NEW)
      )
    );
  exception when others then
    -- Si el aviso fallara por lo que sea (red, función caída un instante,
    -- etc.) NO debe impedir que el mensaje/gasto/invitación/pago se guarde
    -- con normalidad — solo se pierde ese aviso puntual.
    raise warning 'notify_send_push: %', sqlerrm;
  end;
  return NEW;
end;
$$;

drop trigger if exists messages_notify_push on public.messages;
create trigger messages_notify_push
  after insert on public.messages
  for each row execute function public.notify_send_push();

drop trigger if exists expenses_notify_push on public.expenses;
create trigger expenses_notify_push
  after insert on public.expenses
  for each row execute function public.notify_send_push();

drop trigger if exists list_members_notify_push on public.list_members;
create trigger list_members_notify_push
  after insert on public.list_members
  for each row execute function public.notify_send_push();

drop trigger if exists settlements_notify_push on public.settlements;
create trigger settlements_notify_push
  after insert on public.settlements
  for each row execute function public.notify_send_push();
