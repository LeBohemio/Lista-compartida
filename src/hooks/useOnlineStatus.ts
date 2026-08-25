import { useEffect, useState } from 'react'

// navigator.onLine solo detecta si el dispositivo tiene ALGUNA conexión de
// red (por ejemplo, sigue en 'true' conectado a un wifi sin salida a
// internet de verdad), no si Supabase es alcanzable — pero es la señal
// estándar del navegador y sirve de sobra para el caso común (modo avión,
// sin cobertura, wifi desconectado), que es el que de verdad confunde a
// quien usa la app sin darse cuenta de que sus cambios no se están guardando.
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
