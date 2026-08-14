import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import Avatar from './Avatar'
import { colorForName } from '../lib/colors'
import type { Message } from '../lib/types'

export default function ChatPanel({ listId, messages }: { listId: string; messages: Message[] }) {
  const { user } = useAuth()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const imagePaths = useMemo(
    () => messages.filter((m) => m.image_path).map((m) => m.image_path as string),
    [messages],
  )

  useEffect(() => {
    const missing = imagePaths.filter((p) => !imageUrls[p])
    if (missing.length === 0) return
    supabase.storage
      .from('chat-images')
      .createSignedUrls(missing, 3600)
      .then(({ data }) => {
        if (!data) return
        setImageUrls((prev) => {
          const next = { ...prev }
          for (const row of data) {
            if (row.signedUrl && row.path) next[row.path] = row.signedUrl
          }
          return next
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePaths])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const sendText = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim() || !user) return
    setSending(true)
    setError(null)
    const { error: err } = await supabase
      .from('messages')
      .insert({ list_id: listId, sender_id: user.id, content: text.trim() })
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    setText('')
  }

  const sendImage = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setError(null)
    setSending(true)

    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${listId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('chat-images')
      .upload(path, file, { contentType: file.type || 'image/jpeg' })

    if (uploadErr) {
      setError(`No se pudo subir la foto: ${uploadErr.message}`)
      setSending(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }

    const { error: insertErr } = await supabase
      .from('messages')
      .insert({ list_id: listId, sender_id: user.id, image_path: path, content: text.trim() || null })

    setSending(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setText('')
  }

  return (
    <div className="flex h-[65vh] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pb-3">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Todavía no hay mensajes. ¡Escribe el primero!</p>
        ) : (
          messages.map((m, idx) => {
            const isMine = m.sender_id === user?.id
            const isFirstInGroup = idx === 0 || messages[idx - 1].sender_id !== m.sender_id
            return (
              <div key={m.id} className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
                {!isMine && (
                  <div className="w-7 shrink-0">
                    {isFirstInGroup && (
                      <Avatar username={m.sender?.username ?? '?'} avatarUrl={m.sender?.avatar_url} size={28} />
                    )}
                  </div>
                )}
                <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
                  {!isMine && isFirstInGroup && (
                    <p
                      className="mb-0.5 px-1 text-xs font-medium"
                      style={{ color: colorForName(m.sender?.username ?? '?') }}
                    >
                      {m.sender?.username ?? '—'}
                    </p>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      isMine ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200'
                    }`}
                  >
                    {m.image_path && (
                      <img
                        src={imageUrls[m.image_path]}
                        alt="Foto"
                        className="mb-1 max-h-56 rounded-lg object-contain"
                      />
                    )}
                    {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                  </div>
                  <p className="mt-0.5 px-1 text-[10px] text-slate-400">
                    {new Date(m.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <form onSubmit={sendText} className="flex items-center gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={sending}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg text-slate-500 hover:bg-slate-200 disabled:opacity-50"
          aria-label="Adjuntar foto"
        >
          📷
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={sendImage} className="hidden" />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe un mensaje…"
          className="flex-1 rounded-full border border-slate-300 px-4 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          aria-label="Enviar"
        >
          ➤
        </button>
      </form>
    </div>
  )
}
