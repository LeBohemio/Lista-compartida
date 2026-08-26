// "245 KB", "3.1 MB"... para mostrar el peso de un archivo adjunto sin
// tener que descargarlo primero (el tamaño se guarda en la fila al
// subirlo). Compartido entre el chat (mensajes con archivo, ver
// migration_v31.sql) y los gastos (factura adjunta, ver migration_v44.sql)
// — antes vivía solo dentro de ChatPanel.tsx, duplicarlo para gastos no
// tenía sentido siendo exactamente la misma cuenta.
export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
