import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { useDirectMessages } from '../hooks/useDirectMessages'
import { supabase } from '../lib/supabaseClient'
import ChatPanel from '../components/ChatPanel'
import Avatar from '../components/Avatar'
import ContextMenu from '../components/ContextMenu'
import ConfirmDialog from '../components/ConfirmDialog'
import MuteDurationMenu from '../components/MuteDurationMenu'
import { isCurrentlyMuted, muteUntilFor, type MuteDuration } from '../lib/mute'
import type { Contact } from '../lib/types'

export default function DirectChatPage() {
  const { userId: peerId } = useParams<{ userId: string }>()
  const { user, profile } = useAuth()
  const { t } = useLanguage()
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
      .then(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, user, peerId])

  const prevMessageCountRef = useRef(messages.length)
  const loadedForPeerRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (loadedForPeerRef.current !== peerId) {
      loadedForPeerRef.current = peerId
      prevMessageCountRef.current = messages.length
      return
    }
    if (messages.length > prevMessageCountRef.current) {
      const newOnes = messages.slice(prevMessageCountRef.current)
      const fromOther = newOnes.some((m) => m.sender_id !== user?.id)
      if (fromOther && navigator.vibrate) navigator.vibrate(60)
    }
    prevMessageCountRef.current = messages.length
  }, [messages, user, peerId])

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
    await supabase
      .from('contacts')
      .update(duration ? { muted: true, muted_until: muteUntilFor(duration) } : { muted: false, muted_until: null })
      .eq('user_id', user.id)
      .eq('contact_user_id', peerId)
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
        <p className="text-slate-400">{t('list.loading')}</p>
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
      <header className="sticky top-0 z-10 border-b bg-gradient-to-r from-white to-brand-50/50 px-4 py-3 backdrop-blur border-[var(--color-surface-border)] dark:from-[var(--color-surface)] dark:to-[var(--color-surface)]">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => navigate('/contacts')} className="text-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              ‹
            </button>
            <Avatar username={peerProfile.username} avatarUrl={peerProfile.avatar_url} size={32} enlargeOnClick={false} />
            <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{peerProfile.username}</p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {myContact && (
              <button
                onClick={toggleMuted}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-brand-600 dark:hover:text-brand-400"
              >
                {isCurrentlyMuted(myContact.muted, myContact.muted_until)
                  ? `🔕 ${t('chat.unmute')}`
                  : `🔔 ${t('chat.mute')}`}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowMenu(true)}
              aria-label={t('common.more')}
              className="text-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              ⋮
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
              icon: '🗑',
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
