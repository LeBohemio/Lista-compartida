// Este componente se usa DENTRO de la app (cabecera de Mis listas,
// pantallas de acceso/registro), donde sí cabe el logo completo con el
// texto "NoteUs" debajo. Es distinto del icono de la app en el móvil
// (public/icons/icon-192.png / icon-512.png), que se queda solo con el
// símbolo "NU" sin texto porque ese icono se ve muchísimo más pequeño
// (pantalla de inicio, pestaña del navegador) y el texto ahí no se leería.
export default function Logo({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <img
      src="/icons/logo-full.png"
      width={size}
      height={size}
      alt="NoteUs"
      className={className}
      style={{ width: size, height: size }}
    />
  )
}
