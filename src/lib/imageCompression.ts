// Comprime una foto antes de subirla, sin recortarla (a diferencia de
// AvatarCropper.tsx, que sí recorta a un cuadrado fijo — aquí interesa
// conservar el encuadre completo: para un ticket de gasto porque el OCR
// necesita verlo entero, y para una foto de chat porque recortarla a un
// cuadrado se cargaría fotos apaisadas o verticales sin que nadie lo pida).
//
// Los móviles actuales hacen fotos de varios MB; casi ninguna necesita ese
// tamaño para verse bien en una pantalla ni para que el OCR lea un ticket, así
// que esto reduce el peso de subida (y de descarga, para quien la vea
// después) sin que se note la diferencia a simple vista.
const MAX_DIMENSION = 1600
const JPEG_QUALITY = 0.82

/** Cambia el tamaño de una imagen (si hace falta) y la comprime a JPEG.
 *  Si algo falla (formato no soportado, navegador antiguo sin
 *  canvas.toBlob, etc.) devuelve el archivo original tal cual, para que
 *  subir la foto nunca se rompa por culpa de esta optimización. */
export async function compressImage(file: File): Promise<File> {
  // No merece la pena tocar archivos ya pequeños (evita, por ejemplo,
  // recomprimir un GIF animado a costa de perder la animación).
  if (file.size <= 400 * 1024 || file.type === 'image/gif') return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) return file

    const newName = file.name.replace(/\.[^./\\]+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}
