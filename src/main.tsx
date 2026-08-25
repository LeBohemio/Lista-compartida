import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'
import { AuthProvider } from './context/AuthContext.tsx'
import { ToastProvider } from './context/ToastContext.tsx'
import { LanguageProvider } from './lib/i18n.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* Fuera de todo lo demás a propósito — ver el comentario de
        ErrorBoundary.tsx: así cubre también un fallo dentro de los propios
        proveedores de abajo, no solo dentro de <App />. */}
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          {/* ToastProvider por encima de LanguageProvider a propósito: así
              setLanguage() (dentro de LanguageProvider) también puede avisar
              si falla al guardar el idioma en el perfil. */}
          <ToastProvider>
            <LanguageProvider>
              <App />
            </LanguageProvider>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
