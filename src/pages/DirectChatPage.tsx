import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useToast } from '../context/ToastContext'
import { useDirectMessages } from '../hooks/useDirectMessages'
import { supabase } from '../lib/supabaseClient'
import ChatPanel from '../components/ChatPanel'
import Avatar from '../components/Avatar'
import ContextMenu from '../components/ContextMenu'
import ConfirmDialog from '../components/ConfirmDialog'
import MuteDurationMenu from '../components/MuteDurationMenu'
import { BellIcon, BellOffIcon, MoreIcon, TrashIcon } from '../components/icons'
import { isCurrentlyMuted, muteUntilFor, type MuteDuration } from '../lib/mute'
import type { Contact } from '../lib/types'

export default function DirectChatPage() {
  const { userId: peerId } = useParams<{ userId: string }>()
  const { user, profile } = useAuth()
  const { t } = useLanguage()
  const { showError } = useToast()
  const navigate = useNavigate()
  const { peerProfile, messages, loading, error, clearChat } = useDirectMessages(peerId)
  const [myContact, setMyContact] = useState<Contact | null>(null)
  const [showMenu, setShowMenu] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [showMuteMenu, setShowMuteMenu] = useState(false)

  const fetchMyContact = useCallback(async () => {
    if (!user || !peerId) return
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user.id)
      .eq('contact_user_id', peerId)
      .maybeSingle()
    setMyContact((data as Contact) ?? null)
  }, [user, peerId])

  useEffect(() => {
    fetchMyContact()
  }, [fetchMyContact])

  // Marca la conversación como leída (igual que ListDetailPage hace con
  // list_members.last_read_message_at, pero aquí sobre tu propia fila de
  // contacts — ver migration_v18.sql).
  useEffect(() => {
    if (!user || !peerId || messages.length === 0) return
    supabase
      .from('contacts')
      .update({ last_read_message_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('contact_user_id', peerId)
      .then(({ error: err }) => {
        // Igual que en ListDetailPage.tsx: detalle de fondo, solo consola.
        if (err) console.error('[contacts] no se pudo marcar como leído:', err)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, user, peerId])

  // Mismo guard que ListDetailPage.tsx (ver el comentario allí): no se arma
  // la vibración hasta que useDirectMessages termina de cargar esta
  // conversación por primera vez, para no confundir el historial cargándose
  // con mensajes nuevos de verdad.
  const prevMessageCountRef = useRef(messages.length)
  const armedForPeerRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (loading || armedForPeerRef.current !== peerId) {
      if (!loading) armedForPeerRef.current = peerId
      prevMessageCountRef.current = messages.length
      return
    }
    if (messages.length > prevMessageCountRef.current) {
      const newOnes = messages.slice(prevMessageCountRef.current)
      const fromOther = newOnes.some((m) => m.sender_id !== user?.id)
      if (fromOther && navigator.vibrate) navigator.vibrate(60)
    }
    prevMessageCountRef.current = messages.length
  }, [messages, user, peerId, loading])

  const toggleMuted = () => {
    if (!user || !peerId || !myContact) return
    if (isCurrentlyMuted(myContact.muted, myContact.muted_until)) {
      void applyMute(null)
    } else {
      setShowMuteMenu(true)
    }
  }

  const applyMute = async (duration: MuteDuration | null) => {
    if (!user || !peerId || !myContact) return
    const { error: err } = await supabase
      .from('contacts')
      .update(duration ? { muted: true, muted_until: muteUntilFor(duration) } : { muted: false, muted_until: null })
      .eq('user_id', user.id)
      .eq('contact_user_id', peerId)
    if (err) showError(t('common.saveError'))
    fetchMyContact()
  }

  const handleClearChat = async () => {
    setConfirmClear(false)
    await clearChat()
  }

  if (!peerId) return null

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-surface-alt)]">
        <p className="text-slate-500 dark:text-slate-400">{t('list.loading')}</p>
      </div>
    )
  }

  if (error || !peerProfile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center bg-[var(--color-surface-alt)]">
        <p className="text-slate-600 dark:text-slate-300">{t('list.errorLoad')}</p>
        <button onClick={() => navigate('/contacts')} className="text-brand-600 underline dark:text-brand-400">
          {t('nav.tabContacts')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen bg-[var(--color-surface-alt)]"
      style={profile?.background_color ? { backgroundColor: profile.background_color } : undefined}
    >
      {/* HEADER_ACCENT_FLOAT: mismo patrón que en el resto de cabeceras — ver
          el comentario completo en SettingsPage.tsx. */}
      <header
        className="sticky top-0 z-10 overflow-hidden bg-[var(--color-brand-700)] px-4 pb-3"
        style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}
      >
        <span className="pointer-events-none absolute -right-8 -top-16 h-36 w-36 rounded-full bg-[var(--color-brand-400)] opacity-50 blur-2xl" />
        <span className="pointer-events-none absolute -bottom-10 right-14 h-24 w-24 rounded-full bg-[var(--color-brand-300)] opacity-30 blur-xl" />
        <div className="relative mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => navigate('/contacts')}
              aria-label={t('common.back')}
              className="text-xl text-white/80 hover:text-white"
            >
              ‹
            </button>
            <Avatar
              username={peerProfile.username}
              avatarUrl={peerProfile.avatar_url}
              size={32}
              className="ring-2 ring-white/50"
              enlargeOnClick={false}
            />
            <p className="truncate font-semibold text-white">{peerProfile.username}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {myContact && (
              <button
                onClick={toggleMuted}
                className="flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white"
              >
                {isCurrentlyMuted(myContact.muted, myContact.muted_until) ? (
                  <BellOffIcon className="h-3.5 w-3.5" />
                ) : (
                  <BellIcon className="h-3.5 w-3.5" />
                )}
                {isCurrentlyMuted(myContact.muted, myContact.muted_until) ? t('chat.unmute') : t('chat.mute')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowMenu(true)}
              aria-label={t('common.more')}
              className="text-white/80 hover:text-white"
            >
              <MoreIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-6">
        <ChatPanel target={{ kind: 'direct', peerId }} messages={messages} />
      </main>

      {showMuteMenu && (
        <MuteDurationMenu
          onClose={() => setShowMuteMenu(false)}
          onPick={(duration) => {
            setShowMuteMenu(false)
            void applyMute(duration)
          }}
        />
      )}

      {showMenu && (
        <ContextMenu
          onClose={() => setShowMenu(false)}
          actions={[
            {
              label: t('chat.clearChat'),
              icon: <TrashIcon className="h-5 w-5" />,
              danger: true,
              onSelect: () => setConfirmClear(true),
            },
          ]}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title={t('chat.clearChatTitle')}
          message={t('chat.clearChatConfirm')}
          confirmLabel={t('chat.clearChat')}
          danger
          onConfirm={handleClearChat}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  )
}
