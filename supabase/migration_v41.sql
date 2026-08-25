-- migration_v41: rota el secreto del webhook de notificaciones push.
--
-- El secreto que se puso en migration_v19.sql quedó escrito a mano, en
-- texto plano, en un archivo .sql que probablemente ya está guardado en
-- GitHub — cualquiera con acceso al repositorio (o a su historial) podía
-- leerlo. Con este cambio, el valor viejo deja de servir para nada: la
-- función de abajo es la única que decide qué secreto se manda, y a partir
-- de aquí es este.
--
-- IMPORTANTE — orden de los pasos, si no las notificaciones push dejan de
-- funcionar (todas: chat, gastos, invitaciones y pagos, no solo notas):
--   1. PRIMERO: en el panel de Supabase, actualiza el secreto
--      WEBHOOK_SECRET de la función send-push a este mismo valor de aquí
--      abajo (Project Settings → Edge Functions → Secrets).
--   2. DESPUÉS de guardar eso, ejecuta esta migración en el editor SQL.
--
-- Segura de ejecutar más de una vez (mientras el valor de abajo siga
-- siendo el mismo que hayas puesto en el paso 1).

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
        'x-webhook-secret', '5fa880d57ccbfd23e19b9221b9fa08479c26d66b53c646faf0bfd37bc63cb131'
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

-- No hace falta volver a crear los triggers (messages_notify_push,
-- expenses_notify_push, list_members_notify_push, settlements_notify_push,
-- note_members_notify_push de migration_v40.sql): todos apuntan a esta
-- misma función por su nombre, así que en cuanto se reemplaza aquí, los
-- cinco pasan a usar el secreto nuevo automáticamente.
