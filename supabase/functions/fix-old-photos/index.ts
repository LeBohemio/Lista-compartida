// Edge Function de UN SOLO USO — arregla las fotos de perfil y de lista que
// ya estaban subidas ANTES de que AvatarCropper empezara a exportar en PNG
// (ver AvatarCropper.tsx): hasta ese cambio, el recorte circular se hacía
// bien pero se exportaba en JPEG, que no tiene transparencia — así que las
// esquinas de fuera del círculo quedaban rellenas de un color sólido DENTRO
// del propio archivo. En la app no se nota (el CSS ya recorta en círculo
// igualmente) pero sí se notaba en el icono de las notificaciones del
// móvil, que no aplica ningún recorte propio.
//
// Qué hace: para cada perfil y cada lista con foto puesta, si esa foto
// todavía es un .jpg de nuestro Storage, la descarga, le aplica el mismo
// recorte circular con transparencia real (sin mirar de qué color estaban
// rellenas las esquinas: todo lo de fuera del círculo se descarta y punto),
// sube el resultado en PNG, actualiza la base de datos para que apunte a
// la nueva foto, y borra el .jpg viejo.
//
// Cómo usarla:
//   1. Pegar este archivo en Supabase → Edge Functions → crear función
//      nueva (nombre sugerido: fix-old-photos) → Deploy.
//   2. Visitar UNA SOLA VEZ, desde el navegador del móvil o de donde sea:
//        https://TU-PROYECTO.supabase.co/functions/v1/fix-old-photos?secret=EL_MISMO_WEBHOOK_SECRET_DE_SEND-PUSH
//      (el mismo secreto que ya tienes puesto como "WEBHOOK_SECRET" en los
//      secrets del proyecto — no hace falta inventar uno nuevo).
//   3. La propia página mostrará un resumen en texto de qué se arregló y
//      qué se saltó. Si algo falla, también sale ahí el motivo.
//   4. Después de usarla, borrar esta función del panel — es de usar y
//      tirar, no hace falta dejarla puesta permanentemente como las demás.
// Es segura de visitar más de una vez por error: las fotos que ya son PNG
// se saltan solas (no se vuelven a procesar).

import { createClient } from 'npm:@supabase/supabase-js@2'
import jpeg from 'npm:jpeg-js@0.4.4'
import { PNG } from 'npm:pngjs@7.0.0'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const webhookSecret = Deno.env.get('WEBHOOK_SECRET')

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

// Todo lo que quede fuera de un círculo centrado (mismo radio que la mitad
// del lado menor de la imagen) se vuelve transparente. A propósito NO se
// mira de qué color rellenó el navegador esas esquinas al exportar en JPEG
// (podría ser negro, blanco... según el navegador) — da igual, se descarta
// sin comprobarlo: geométricamente, todo lo de fuera del círculo es
// relleno, nunca foto de verdad.
function applyCircularMask(width: number, height: number, data: Uint8Array) {
  const cx = width / 2
  const cy = height / 2
  const r = Math.min(width, height) / 2
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      if (dx * dx + dy * dy > r * r) {
        data[(y * width + x) * 4 + 3] = 0
      }
    }
  }
}

type FixResult = { ok: boolean; skipped?: boolean; newUrl?: string; reason?: string }

async function fixOne(bucket: string, publicUrl: string): Promise<FixResult> {
  // Solo tocamos fotos guardadas en NUESTRO Storage (esto descarta los
  // avatares prediseñados, que son archivos propios de la app servidos
  // desde /avatars/... del propio dominio, no de Supabase Storage, y ya
  // están bien) y que todavía sean JPEG.
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = publicUrl.indexOf(marker)
  if (idx === -1) return { ok: true, skipped: true, reason: 'no es de este bucket (probablemente un avatar prediseñado)' }
  const path = decodeURIComponent(publicUrl.slice(idx + marker.length))
  if (!/\.jpe?g$/i.test(path)) return { ok: true, skipped: true, reason: 'ya no es .jpg' }

  const { data: fileBlob, error: downloadErr } = await supabaseAdmin.storage.from(bucket).download(path)
  if (downloadErr || !fileBlob) return { ok: false, reason: `no se pudo descargar: ${downloadErr?.message}` }

  let raw: { width: number; height: number; data: Uint8Array }
  try {
    const bytes = new Uint8Array(await fileBlob.arrayBuffer())
    raw = jpeg.decode(bytes, { useTArray: true }) as typeof raw
  } catch (err) {
    return { ok: false, reason: `no se pudo decodificar el jpg: ${(err as Error)?.message}` }
  }

  applyCircularMask(raw.width, raw.height, raw.data)

  const png = new PNG({ width: raw.width, height: raw.height })
  png.data = Buffer.from(raw.data)
  const pngBytes = PNG.sync.write(png)

  const newPath = path.replace(/\.jpe?g$/i, '.png')
  const { error: uploadErr } = await supabaseAdmin.storage
    .from(bucket)
    .upload(newPath, pngBytes, { contentType: 'image/png', upsert: true })
  if (uploadErr) return { ok: false, reason: `no se pudo subir la versión arreglada: ${uploadErr.message}` }

  const { data: publicData } = supabaseAdmin.storage.from(bucket).getPublicUrl(newPath)

  // Borrar el .jpg viejo es lo último, después de que la nueva foto ya esté
  // subida y la base de datos actualizada (ver Deno.serve más abajo) — así,
  // si algo falla a mitad, en el peor de los casos se queda un archivo
  // viejo sin usar en vez de perder la foto de alguien.
  await supabaseAdmin.storage.from(bucket).remove([path])

  return { ok: true, newUrl: publicData.publicUrl }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  if (!webhookSecret || url.searchParams.get('secret') !== webhookSecret) {
    return new Response('unauthorized', { status: 401 })
  }

  const lines: string[] = []
  let fixed = 0
  let skipped = 0
  let failed = 0

  const { data: profiles, error: profilesErr } = await supabaseAdmin
    .from('profiles')
    .select('id, username, avatar_url')
    .not('avatar_url', 'is', null)
  if (profilesErr) lines.push(`ERROR leyendo perfiles: ${profilesErr.message}`)

  for (const p of profiles ?? []) {
    const result = await fixOne('avatars', p.avatar_url as string)
    if (result.skipped) {
      skipped++
      continue
    }
    if (!result.ok) {
      failed++
      lines.push(`❌ perfil "${p.username}": ${result.reason}`)
      continue
    }
    const { error: updateErr } = await supabaseAdmin.from('profiles').update({ avatar_url: result.newUrl }).eq('id', p.id)
    if (updateErr) {
      failed++
      lines.push(`❌ perfil "${p.username}": foto arreglada pero no se pudo guardar en el perfil: ${updateErr.message}`)
      continue
    }
    fixed++
    lines.push(`✅ perfil "${p.username}" arreglado`)
  }

  const { data: lists, error: listsErr } = await supabaseAdmin.from('lists').select('id, name, photo_url').not('photo_url', 'is', null)
  if (listsErr) lines.push(`ERROR leyendo listas: ${listsErr.message}`)

  for (const l of lists ?? []) {
    const result = await fixOne('list-photos', l.photo_url as string)
    if (result.skipped) {
      skipped++
      continue
    }
    if (!result.ok) {
      failed++
      lines.push(`❌ lista "${l.name}": ${result.reason}`)
      continue
    }
    const { error: updateErr } = await supabaseAdmin.from('lists').update({ photo_url: result.newUrl }).eq('id', l.id)
    if (updateErr) {
      failed++
      lines.push(`❌ lista "${l.name}": foto arreglada pero no se pudo guardar en la lista: ${updateErr.message}`)
      continue
    }
    fixed++
    lines.push(`✅ lista "${l.name}" arreglada`)
  }

  const summary = `Arregladas: ${fixed} — Saltadas (ya estaban bien): ${skipped} — Fallidas: ${failed}\n\n${lines.join('\n')}`
  console.log(`[fix-old-photos] ${summary}`)
  return new Response(summary, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
})
