import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import Avatar from './Avatar'
import ConfirmDialog from './ConfirmDialog'
import CreateListModal from './CreateListModal'
import MuteDurationMenu from './MuteDurationMenu'
import { BellIcon, BellOffIcon, BlockIcon, ChatBubbleIcon, ListsIcon, PinIcon, TrashIcon } from './icons'
import { formatMuteUntil, isCurrentlyMuted, muteUntilFor, type MuteDuration } from '../lib/mute'
import type { Contact, ContactRequest, Profile } from '../lib/types'

type CardState =
  | { kind: 'loading' }
  | { kind: 'contact'; contact: Contact }
  | { kind: 'pendingOutgoing'; request: ContactRequest }
  | { kind: 'pendingIncoming'; request: ContactRequest }
  | { kind: 'none' }

/**
 * La "ficha" de una persona: foto grande, nombre, y las acciones que tocan
 * según si ya es tu contacto, si hay una petición pendiente entre
 * vosotros, o si no tenéis ninguna relación todavía. Se abre igual desde
 * la pantalla de Contactos que desde el panel de participantes de una
 * lista (ahí la mayoría de las veces todavía no seréis contactos, así que
 * el estado "pedir contacto" es el que más se ve desde ahí). Ver
 * migration_v18.sql.
 */
export default function ContactCardSheet({
  targetProfile,
  onClose,
  onChanged,
}: {
  targetProfile: Profile
  onClose: () => void
  // Avisa al padre de que algo cambió (se aceptó/canceló una petición, se
  // fijó/silenció/eliminó un contacto) por si tiene su propia lista que
  // refrescar. Las pantallas con useContactRequests() ya se refrescan solas
  // vía realtime, así que esto es opcional.
  onChanged?: () => void
}) {
  const { user } = useAuth()
  const { t, language } = useLanguage()
  const navigate = useNavigate()

  const [state, setState] = useState<CardState>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const [showCreateList, setShowCreateList] = useState(false)
  const [showMuteMenu, setShowMuteMenu] = useState(false)

  const fetchState = useCallback(async () => {
    if (!user) return
    setError(null)
    const [contactRes, requestRes] = await Promise.all([
      supabase
        .from('contacts')
        .select('*')
        .eq('user_id', user.id)
        .eq('contact_user_id', targetProfile.id)
        .maybeSingle(),
      supabase
        .from('contact_requests')
        .select(
          '*, from_profile:profiles!contact_requests_from_user_id_fkey(*), to_profile:profiles!contact_requests_to_user_id_fkey(*)',
        )
        .or(
          `and(from_user_id.eq.${user.id},to_user_id.eq.${targetProfile.id}),and(from_user_id.eq.${targetProfile.id},to_user_id.eq.${user.id})`,
        )
        .eq('status', 'pending')
        .maybeSingle(),
    ])

    if (contactRes.data) {
      setState({ kind: 'contact', contact: contactRes.data as Contact })
      return
    }
    const req = requestRes.data as ContactRequest | null
    if (req && req.from_user_id === user.id) {
      setState({ kind: 'pendingOutgoing', request: req })
    } else if (req) {
      setState({ kind: 'pendingIncoming', request: req })
    } else {
      setState({ kind: 'none' })
    }
  }, [user, targetProfile.id])

  useEffect(() => {
    setState({ kind: 'loading' })
    fetchState()
  }, [fetchState])

  const notify = () => onChanged?.()

  const openChat = () => {
    navigate(`/contacts/${targetProfile.id}/chat`)
    onClose()
  }

  const togglePinned = async () => {
    if (state.kind !== 'contact' || !user) return
    setBusy(true)
    await supabase
      .from('contacts')
      .update({ pinned: !state.contact.pinned })
      .eq('user_id', user.id)
      .eq('contact_user_id', targetProfile.id)
    setBusy(false)
    fetchState()
    notify()
  }

  // Si ya está silenciado (aunque fuera con fecha de caducidad), pulsar el
  // botón lo reactiva directamente. Si no lo está, abre el menú para elegir
  // cuánto tiempo (ver applyMute).
  const toggleMuted = () => {
    if (state.kind !== 'contact' || !user) return
    if (isCurrentlyMuted(state.contact.muted, state.contact.muted_until)) {
      void applyMute(null)
    } else {
      setShowMuteMenu(true)
    }
  }

  // duration=null desilencia. Cualquier otro valor silencia con esa
  // duración (o para siempre, si es "always").
  const applyMute = async (duration: MuteDuration | null) => {
    if (state.kind !== 'contact' || !user) return
    setBusy(true)
    await supabase
      .from('contacts')
      .update(duration ? { muted: true, muted_until: muteUntilFor(duration) } : { muted: false, muted_until: null })
      .eq('user_id', user.id)
      .eq('contact_user_id', targetProfile.id)
    setBusy(false)
    fetchState()
    notify()
  }

  const confirmBlockContact = async () => {
    if (state.kind !== 'contact' || !user) return
    setBusy(true)
    setError(null)
    const { error: updErr } = await supabase
      .from('contacts')
      .update({ blocked_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('contact_user_id', targetProfile.id)
    setBusy(false)
    setConfirmBlock(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    fetchState()
    notify()
  }

  const unblockContact = async () => {
    if (state.kind !== 'contact' || !user) return
    setBusy(true)
    setError(null)
    const { error: updErr } = await supabase
      .from('contacts')
      .update({ blocked_at: null })
      .eq('user_id', user.id)
      .eq('contact_user_id', targetProfile.id)
    setBusy(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    fetchState()
    notify()
  }

  const confirmRemoveContact = async () => {
    setBusy(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('remove_contact', { p_contact_user_id: targetProfile.id })
    setBusy(false)
    setConfirmRemove(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    notify()
    onClose()
  }

  const sendRequest = async () => {
    if (!user) return
    setBusy(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('send_contact_request', { p_to_user_id: targetProfile.id })
    setBusy(false)
    if (rpcErr) {
      setError(rpcErr.message.includes('BLOCKED') ? t('contacts.errorBlocked') : rpcErr.message)
      return
    }
    fetchState()
    notify()
  }

  const cancelOutgoing = async () => {
    if (state.kind !== 'pendingOutgoing') return
    setBusy(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('cancel_contact_request', { p_request_id: state.request.id })
    setBusy(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    fetchState()
    notify()
  }

  const respondIncoming = async (accept: boolean) => {
    if (state.kind !== 'pendingIncoming') return
    setBusy(true)
    setError(null)
    const { error: rpcErr } = await supabase.rpc('respond_contact_request', {
      p_request_id: state.request.id,
      p_accept: accept,
    })
    setBusy(false)
    if (rpcErr) {
      setError(rpcErr.message)
      return
    }
    fetchState()
    notify()
  }

  const handleListCreated = async (listId: string) => {
    setShowCreateList(false)
    if (user) {
      await supabase.from('list_members').insert({
        list_id: listId,
        user_id: targetProfile.id,
        role: 'member',
        status: 'invited',
        invited_identifier: targetProfile.email,
        invited_by: user.id,
      })
    }
    onClose()
    navigate(`/lists/${listId}`)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm overflow-hidden rounded-t-2xl shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-2 p-6 pb-4 text-center">
          <Avatar username={targetProfile.username} avatarUrl={targetProfile.avatar_url} size={88} enlargeOnClick={false} />
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{targetProfile.username}</p>
        </div>

        {error && (
          <p className="mx-6 mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="px-6 pb-6">
          {state.kind === 'loading' && <p className="py-6 text-center text-sm text-slate-400">{t('card.loading')}</p>}

          {state.kind === 'contact' && (
            <div className="space-y-2">
              {state.contact.blocked_at && (
                <p className="mb-1 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  <BlockIcon className="h-4 w-4 shrink-0" />
                  {t('card.blockedHint')}
                </p>
              )}
              {!state.contact.blocked_at && (
                <>
                  <CardAction icon={<ChatBubbleIcon className="h-5 w-5" />} label={t('card.openChat')} onClick={openChat} />
                  <CardAction icon={<ListsIcon className="h-5 w-5" />} label={t('card.createList')} onClick={() => setShowCreateList(true)} />
                </>
              )}
              <CardAction
                icon={<PinIcon className="h-5 w-5" />}
                label={state.contact.pinned ? t('card.unpin') : t('card.pin')}
                onClick={togglePinned}
                disabled={busy}
              />
              <CardAction
                icon={
                  isCurrentlyMuted(state.contact.muted, state.contact.muted_until) ? (
                    <BellOffIcon className="h-5 w-5" />
                  ) : (
                    <BellIcon className="h-5 w-5" />
                  )
                }
                label={isCurrentlyMuted(state.contact.muted, state.contact.muted_until) ? t('card.unmute') : t('card.mute')}
                hint={
                  isCurrentlyMuted(state.contact.muted, state.contact.muted_until) && state.contact.muted_until
                    ? t('card.mutedUntil', { when: formatMuteUntil(state.contact.muted_until, language) })
                    : undefined
                }
                onClick={toggleMuted}
                disabled={busy}
              />
              <CardAction
                icon={<BlockIcon className="h-5 w-5" />}
                label={state.contact.blocked_at ? t('card.unblock') : t('card.block')}
                onClick={state.contact.blocked_at ? unblockContact : () => setConfirmBlock(true)}
                disabled={busy}
                danger={!state.contact.blocked_at}
              />
              <CardAction
                icon={<TrashIcon className="h-5 w-5" />}
                label={t('card.remove')}
                onClick={() => setConfirmRemove(true)}
                disabled={busy}
                danger
              />
            </div>
          )}

          {state.kind === 'pendingOutgoing' && (
            <div className="space-y-3 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('card.pendingOutgoingBody')}</p>
              <button
                onClick={cancelOutgoing}
                disabled={busy}
                className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 border-[var(--color-surface-border)] dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {t('card.cancelRequest')}
              </button>
            </div>
          )}

          {state.kind === 'pendingIncoming' && (
            <div className="space-y-3 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('card.pendingIncomingBody')}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => respondIncoming(false)}
                  disabled={busy}
                  className="flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 border-[var(--color-surface-border)] dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {t('lists.reject')}
                </button>
                <button
                  onClick={() => respondIncoming(true)}
                  disabled={busy}
                  className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {t('lists.accept')}
                </button>
              </div>
            </div>
          )}

          {state.kind === 'none' && (
            <div className="space-y-3 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('card.notContactHint')}</p>
              <button
                onClick={sendRequest}
                disabled={busy}
                className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              >
                {busy ? t('card.sendingRequest') : t('card.sendRequest')}
              </button>
            </div>
          )}

          <button
            onClick={onClose}
            className="mt-4 w-full rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
          >
            {t('common.close')}
          </button>
        </div>
      </div>

      {confirmRemove && (
        <ConfirmDialog
          title={t('contacts.removeTitle')}
          message={t('contacts.removeConfirm', { name: targetProfile.username })}
          confirmLabel={busy ? t('card.removing') : t('card.remove')}
          danger
          onCancel={() => setConfirmRemove(false)}
          onConfirm={confirmRemoveContact}
        />
      )}

      {confirmBlock && (
        <ConfirmDialog
          title={t('card.blockConfirmTitle', { name: targetProfile.username })}
          message={t('card.blockConfirmBody')}
          confirmLabel={busy ? t('card.blocking') : t('card.block')}
          danger
          onCancel={() => setConfirmBlock(false)}
          onConfirm={confirmBlockContact}
        />
      )}

      {showCreateList && (
        <CreateListModal onClose={() => setShowCreateList(false)} onCreated={handleListCreated} />
      )}

      {showMuteMenu && (
        <MuteDurationMenu
          onClose={() => setShowMuteMenu(false)}
          onPick={(duration) => {
            setShowMuteMenu(false)
            void applyMute(duration)
          }}
        />
      )}
    </div>
  )
}

function CardAction({
  icon,
  label,
  hint,
  onClick,
  disabled,
  danger,
}: {
  icon: ReactNode
  label: string
  // Segunda línea pequeña, opcional (por ejemplo "Silenciado hasta las 18:30").
  hint?: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm hover:bg-slate-50 disabled:opacity-50 border-[var(--color-surface-border)] dark:hover:bg-slate-700 ${
        danger ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-200'
      }`}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="flex-1">
        {label}
        {hint && <span className="block text-xs font-normal text-slate-400">{hint}</span>}
      </span>
    </button>
  )
}
