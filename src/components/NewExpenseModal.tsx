import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../lib/i18n'
import { extractReceiptTotal, OCR_CONFIDENCE_THRESHOLD } from '../lib/ocr'
import { compressImage } from '../lib/imageCompression'
import { EXPENSE_CATEGORIES } from '../lib/categories'
import { formatCurrency, splitEqually } from '../lib/balances'
import { currencySymbol, type CurrencyCode } from '../lib/currencies'
import { CameraIcon, FileAttachmentIcon, GalleryIcon } from './icons'
import { formatFileSize } from '../lib/files'
import type { Expense, ExpenseCategory, ListMember } from '../lib/types'

type SplitMode = 'equal' | 'custom' | 'percent'

// Al editar un gasto, ¿el reparto que ya tenía era "a partes iguales"? Si
// lo era, queremos que el formulario arranque en modo "equal" (no
// "custom" a ciegas como antes) — así, si solo se cambia el importe total,
// el reparto se sigue recalculando igualitario en vez de quedarse
// congelado con los números viejos. splitEqually reparte el resto de
// céntimos de uno en uno entre las primeras personas, así que dos partes
// "iguales" pueden diferir como mucho en 1 céntimo entre sí — de ahí la
// tolerancia de abajo en vez de exigir que sean exactamente idénticas.
function looksLikeEqualSplit(shares: { user_id: string | null; amount: number }[], memberIds: string[]): boolean {
  if (shares.length !== memberIds.length || shares.length === 0) return false
  const memberIdSet = new Set(memberIds)
  const cents = shares.map((s) => (s.user_id && memberIdSet.has(s.user_id) ? Math.round(s.amount * 100) : null))
  if (cents.some((c) => c === null)) return false
  const values = cents as number[]
  return Math.max(...values) - Math.min(...values) <= 1
}

export default function NewExpenseModal({
  listId,
  currency,
  members,
  editing,
  // Valores de partida para un gasto NUEVO (distinto de "editing", que es
  // para modificar uno ya existente) — se usa, por ejemplo, al crear un
  // gasto a partir de los productos marcados en la lista de la compra (ver
  // ItemsPanel.tsx): se rellena el formulario, pero la persona lo revisa y
  // confirma igual que cualquier otro gasto, no se guarda solo.
  initial,
  onClose,
  onCreated,
}: {
  listId: string
  currency: CurrencyCode
  members: ListMember[]
  editing?: Expense
  initial?: { description?: string; totalAmount?: number; category?: ExpenseCategory }
  onClose: () => void
  onCreated: () => void
}) {
  const { user } = useAuth()
  const { t, language } = useLanguage()
  const acceptedMembers = useMemo(() => members.filter((m) => m.status === 'accepted'), [members])
  const isEditing = !!editing

  // Dos inputs separados (cámara y galería) en vez de uno solo con
  // "capture=environment" — ese atributo forzaba la cámara y no dejaba
  // elegir una foto ya hecha. Mismo patrón que ya funciona en el chat
  // (ChatPanel.tsx).
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)
  // Adjunto de archivo (factura en PDF, Word…) — independiente de la foto
  // del ticket de arriba: esa es para el OCR, esto es solo para guardar un
  // documento junto al gasto, tal cual, sin tocar el importe ni la
  // categoría. Mismo input que ya usa el chat para documentos.
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(editing?.ocr_confidence ?? null)
  const [ocrChecked, setOcrChecked] = useState(false)

  const [attachment, setAttachment] = useState<File | null>(null)

  const [description, setDescription] = useState(editing?.description ?? initial?.description ?? '')
  const [category, setCategory] = useState<ExpenseCategory>(() => {
    if (editing) return editing.category
    if (initial?.category) return initial.category
    const stored = localStorage.getItem(`lastCategory:${listId}`) as ExpenseCategory | null
    return stored && EXPENSE_CATEGORIES.some((c) => c.value === stored) ? stored : 'otros'
  })
  const [amountInput, setAmountInput] = useState(
    editing ? editing.total_amount.toFixed(2) : initial?.totalAmount ? initial.totalAmount.toFixed(2) : '',
  )
  const [noDebt, setNoDebt] = useState(editing?.no_debt ?? false)
  const [paidBy, setPaidBy] = useState(editing?.paid_by ?? user?.id ?? '')
  const [splitMode, setSplitMode] = useState<SplitMode>(() => {
    if (!editing?.shares) return 'equal'
    return looksLikeEqualSplit(editing.shares, acceptedMembers.map((m) => m.user_id)) ? 'equal' : 'custom'
  })
  // El selector de "Igual / Porcentaje / Personalizado" empieza escondido
  // detrás de un enlace cuando el reparto es igual — es, con diferencia, lo
  // que se usa casi siempre, así que no hace falta verlo cada vez. Si el
  // gasto que se está editando NO era igualitario, se muestra ya
  // desplegado, para no esconder en qué modo está de verdad.
  const [showSplitOptions, setShowSplitOptions] = useState<boolean>(() => {
    if (!editing?.shares) return false
    return !looksLikeEqualSplit(editing.shares, acceptedMembers.map((m) => m.user_id))
  })
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(() => {
    if (!editing?.shares) return {}
    const initial: Record<string, string> = {}
    for (const s of editing.shares) if (s.user_id) initial[s.user_id] = s.amount.toFixed(2)
    return initial
  })
  const [percentAmounts, setPercentAmounts] = useState<Record<string, string>>({})

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const needsManualReview = ocrChecked && (ocrConfidence === null || ocrConfidence < OCR_CONFIDENCE_THRESHOLD)

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setPreviewUrl(URL.createObjectURL(f))
    setError(null)
    setOcrRunning(true)
    setOcrChecked(false)
    setOcrProgress(0)
    try {
      const result = await extractReceiptTotal(f, setOcrProgress)
      setOcrConfidence(result.confidence)
      if (result.amount !== null) {
        setAmountInput(result.amount.toFixed(2))
      }
    } catch {
      setOcrConfidence(0)
    } finally {
      setOcrRunning(false)
      setOcrChecked(true)
    }
  }

  const handleAttachment = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setAttachment(f)
  }

  const totalAmount = Number.parseFloat(amountInput.replace(',', '.'))
  const totalValid = Number.isFinite(totalAmount) && totalAmount > 0

  const equalShares = useMemo(() => {
    if (!totalValid || acceptedMembers.length === 0) return {}
    return splitEqually(Math.round(totalAmount * 100), acceptedMembers.map((m) => m.user_id))
  }, [totalValid, totalAmount, acceptedMembers])

  const customTotalCents = useMemo(
    () =>
      acceptedMembers.reduce((sum, m) => {
        const v = Number.parseFloat((customAmounts[m.user_id] ?? '0').replace(',', '.'))
        return sum + Math.round((Number.isFinite(v) ? v : 0) * 100)
      }, 0),
    [customAmounts, acceptedMembers],
  )
  const customMatchesTotal = totalValid && customTotalCents === Math.round(totalAmount * 100)

  const percentTotal = useMemo(
    () =>
      acceptedMembers.reduce((sum, m) => {
        const v = Number.parseFloat((percentAmounts[m.user_id] ?? '0').replace(',', '.'))
        return sum + (Number.isFinite(v) ? v : 0)
      }, 0),
    [percentAmounts, acceptedMembers],
  )
  const percentComplete = totalValid && Math.abs(percentTotal - 100) < 0.01
  const percentRounded = Math.round(percentTotal * 100) / 100

  // El reparto está "completo" solo si suma exactamente el total (partes
  // iguales siempre lo está, por construcción). Si no lo está, seguimos
  // dejando guardar — se guarda como borrador en vez de bloquear a la
  // persona con un error, para que no se pierda lo que ya ha escrito.
  const splitComplete = splitMode === 'equal' ? true : splitMode === 'custom' ? customMatchesTotal : percentComplete

  const shareRowsFor = (mode: SplitMode) =>
    acceptedMembers.map((m) => {
      let cents: number
      if (mode === 'equal') {
        cents = equalShares[m.user_id] ?? 0
      } else if (mode === 'percent') {
        const pct = Number.parseFloat((percentAmounts[m.user_id] ?? '0').replace(',', '.'))
        cents = Math.round(Math.round(totalAmount * 100) * ((Number.isFinite(pct) ? pct : 0) / 100))
      } else {
        const v = Number.parseFloat((customAmounts[m.user_id] ?? '0').replace(',', '.'))
        cents = Math.round((Number.isFinite(v) ? v : 0) * 100)
      }
      return { expense_id: '', user_id: m.user_id, amount: cents / 100 }
    })

  // Lógica de guardado compartida entre el botón "Guardar" y el cierre del
  // formulario (Cerrar / clic fuera) cuando el reparto no está terminado.
  const persistExpense = async (): Promise<string | null> => {
    let receiptPath: string | null = editing?.receipt_image_path ?? null
    if (file) {
      // El OCR ya se ejecutó sobre "file" tal cual salió de la cámara/galería
      // (ver handleFile) — comprimimos justo antes de subir, no antes, para
      // no arriesgar precisión del OCR con una versión ya reducida.
      const uploadFile = await compressImage(file)
      const ext = uploadFile.name.split('.').pop() || 'jpg'
      const path = `${listId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadErr } = await supabase.storage.from('receipts').upload(path, uploadFile, {
        contentType: uploadFile.type || 'image/jpeg',
      })
      if (uploadErr) return t('expenses.errorReceiptUpload', { message: uploadErr.message })
      receiptPath = path
    }

    // El archivo adjunto (factura, etc.) se sube tal cual, sin comprimir
    // (a diferencia de la foto del ticket, puede ser un PDF) — si no se
    // eligió uno nuevo, se conserva el que ya hubiera al editar.
    let attachmentPath: string | null = editing?.file_path ?? null
    let attachmentName: string | null = editing?.file_name ?? null
    let attachmentMimeType: string | null = editing?.file_mime_type ?? null
    let attachmentSizeBytes: number | null = editing?.file_size_bytes ?? null
    if (attachment) {
      const ext = attachment.name.split('.').pop() || 'bin'
      const path = `${listId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: attachmentUploadErr } = await supabase.storage
        .from('expense-files')
        .upload(path, attachment, { contentType: attachment.type || 'application/octet-stream' })
      if (attachmentUploadErr) return t('expenses.errorAttachmentUpload', { message: attachmentUploadErr.message })
      attachmentPath = path
      attachmentName = attachment.name
      attachmentMimeType = attachment.type || null
      attachmentSizeBytes = attachment.size
    }

    const isDraft = !splitComplete
    let expenseId: string
    if (isEditing) {
      const { error: updateErr } = await supabase
        .from('expenses')
        .update({
          description: description.trim() || null,
          total_amount: totalAmount,
          receipt_image_path: receiptPath,
          ocr_confidence: ocrConfidence,
          category,
          paid_by: noDebt ? null : paidBy,
          no_debt: noDebt,
          is_draft: isDraft,
          file_path: attachmentPath,
          file_name: attachmentName,
          file_mime_type: attachmentMimeType,
          file_size_bytes: attachmentSizeBytes,
        })
        .eq('id', editing!.id)
      if (updateErr) return updateErr.message
      expenseId = editing!.id
      const { error: delSharesErr } = await supabase.from('expense_shares').delete().eq('expense_id', expenseId)
      if (delSharesErr) return delSharesErr.message
    } else {
      const { data: expense, error: expenseErr } = await supabase
        .from('expenses')
        .insert({
          list_id: listId,
          description: description.trim() || null,
          total_amount: totalAmount,
          receipt_image_path: receiptPath,
          ocr_confidence: ocrConfidence,
          category,
          paid_by: noDebt ? null : paidBy,
          no_debt: noDebt,
          created_by: user!.id,
          is_draft: isDraft,
          file_path: attachmentPath,
          file_name: attachmentName,
          file_mime_type: attachmentMimeType,
          file_size_bytes: attachmentSizeBytes,
        })
        .select()
        .single()

      if (expenseErr || !expense) return expenseErr?.message ?? t('expenses.errorGeneric')
      expenseId = expense.id
    }

    const shareRows = shareRowsFor(splitMode).map((row) => ({ ...row, expense_id: expenseId }))
    const { error: sharesErr } = await supabase.from('expense_shares').insert(shareRows)
    if (sharesErr) return sharesErr.message

    localStorage.setItem(`lastCategory:${listId}`, category)
    return null
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setError(null)

    if (!totalValid) {
      setError(t('expenses.errorTotalInvalid'))
      return
    }
    if (!noDebt && !paidBy) {
      setError(t('expenses.errorNoPayer'))
      return
    }
    if (acceptedMembers.length === 0) {
      setError(t('expenses.errorNoMembers'))
      return
    }

    setSubmitting(true)
    const errorMessage = await persistExpense()
    setSubmitting(false)
    if (errorMessage) {
      setError(errorMessage)
      return
    }
    onCreated()
  }

  // Si cierras sin haber terminado, no queremos que se pierda lo que ya
  // llevabas escrito: si hay al menos un importe y quién pagó, se guarda
  // igual (como borrador si el reparto no cuadra). Si el formulario está
  // prácticamente vacío, no hay nada que merezca la pena guardar y se
  // cierra sin más.
  const handleRequestClose = async () => {
    if (submitting) return
    if (!user || !totalValid || (!noDebt && !paidBy) || acceptedMembers.length === 0) {
      onClose()
      return
    }
    setSubmitting(true)
    const errorMessage = await persistExpense()
    setSubmitting(false)
    if (errorMessage) {
      // Mejor cerrar igualmente: no tiene sentido dejar a la persona
      // atrapada en el formulario por un fallo de guardado del borrador.
      onClose()
      return
    }
    onCreated()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={handleRequestClose}
    >
      <div
        className="glass-panel max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-[28px] p-6 shadow-[0_24px_60px_-20px_rgba(20,21,26,0.5)] sm:rounded-[28px]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">
          {isEditing ? t('expenses.edit') : t('expenses.newTitle')}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('expenses.receiptPhoto')} {isEditing ? t('expenses.receiptReplaceOptional') : t('expenses.receiptOptional')}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 border-transparent bg-brand-50 dark:bg-brand-950/40 dark:text-brand-400"
              >
                <CameraIcon className="h-4 w-4" />
                {t('expenses.takePhoto')}
              </button>
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 border-transparent bg-brand-50 dark:bg-brand-950/40 dark:text-brand-400"
              >
                <GalleryIcon className="h-4 w-4" />
                {t('expenses.choosePhoto')}
              </button>
            </div>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFile}
              className="hidden"
            />
            <input ref={galleryInputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
            {!previewUrl && isEditing && editing?.receipt_image_path && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('expenses.receiptSavedHint')}</p>
            )}
            {previewUrl && (
              <img src={previewUrl} alt={t('expenses.receiptPreviewAlt')} className="mt-3 max-h-48 rounded-lg object-contain" />
            )}
            {ocrRunning && (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {t('expenses.ocrReading', { progress: ocrProgress })}
              </p>
            )}
            {ocrChecked && !ocrRunning && (
              <p className={`mt-2 text-sm ${needsManualReview ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                {needsManualReview ? t('expenses.ocrNeedsReview') : t('expenses.ocrDetected')}
              </p>
            )}
          </div>

          {/* Adjunto de archivo, aparte de la foto del ticket de arriba —
              para guardar por ejemplo la factura en PDF de la luz o el gas
              junto al gasto, sin pasar por el OCR. Mismos tipos de archivo
              que ya admite el chat para documentos. */}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('expenses.attachFile')} {t('expenses.receiptOptional')}
            </label>
            <button
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100 border-transparent bg-brand-50 dark:bg-brand-950/40 dark:text-brand-400"
            >
              <FileAttachmentIcon className="h-4 w-4" />
              {attachment ? attachment.name : t('expenses.chooseFile')}
            </button>
            <input
              ref={attachmentInputRef}
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={handleAttachment}
              className="hidden"
            />
            {attachment && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{formatFileSize(attachment.size)}</p>
            )}
            {!attachment && isEditing && editing?.file_name && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {t('expenses.attachmentSavedHint', { name: editing.file_name })}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="new-expense-amount" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {t('expenses.totalAmount', { symbol: currencySymbol(currency) })}
            </label>
            <input
              id="new-expense-amount"
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0.00"
              className={`w-full rounded-2xl border px-3 py-2.5 text-base focus:outline-none focus:ring-2 bg-[var(--color-glass)] dark:text-slate-100 ${
                needsManualReview
                  ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-100'
                  : 'focus:border-brand-500 focus:ring-brand-100 border-[var(--color-glass-border)]'
              }`}
            />
          </div>

          <div>
            <label htmlFor="new-expense-description" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('expenses.description')}</label>
            <input
              id="new-expense-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('expenses.descriptionPlaceholder')}
              className="w-full rounded-2xl border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('expenses.category')}</label>
            <div className="flex flex-wrap gap-2">
              {EXPENSE_CATEGORIES.map((c) => (
                <button
                  type="button"
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`rounded-full px-3 py-1.5 text-sm transition ${
                    category === c.value
                      ? 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_8px_18px_-8px_var(--color-glow)]'
                      : 'border text-slate-600 hover:bg-white/40 border-[var(--color-glass-border)] dark:text-slate-300 dark:hover:bg-white/5'
                  }`}
                >
                  {c.icon} {t(c.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={noDebt}
                onChange={(e) => setNoDebt(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 accent-brand-600"
              />
              <span>
                <span className="font-medium">{t('expenses.noDebt')}</span>
                <br />
                <span className="text-xs text-slate-500 dark:text-slate-400">{t('expenses.noDebtHint')}</span>
              </span>
            </label>
          </div>

          {!noDebt && (
            <div>
              <label htmlFor="new-expense-paid-by" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('expenses.whoPaid')}</label>
              <select
                id="new-expense-paid-by"
                value={paidBy}
                onChange={(e) => setPaidBy(e.target.value)}
                className="w-full rounded-2xl border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
              >
                {acceptedMembers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.profile?.username ?? m.user_id} {m.user_id === user?.id ? t('expenses.you') : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {noDebt ? t('expenses.contributionSplit') : t('expenses.split')}
            </label>
            {/* La mayoría de los gastos se reparten a partes iguales, así
                que ese es el único que se ve al principio — "Porcentaje" y
                "Personalizado" se quedan escondidos detrás de un enlace, en
                vez de mostrar los 3 modos siempre con el mismo peso
                visual. */}
            {showSplitOptions ? (
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSplitMode('equal')}
                  className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${
                    splitMode === 'equal'
                      ? 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_8px_18px_-8px_var(--color-glow)]'
                      : 'border text-slate-600 hover:bg-white/40 border-[var(--color-glass-border)] dark:text-slate-300 dark:hover:bg-white/5'
                  }`}
                >
                  {t('expenses.splitEqual')}
                </button>
                <button
                  type="button"
                  onClick={() => setSplitMode('percent')}
                  className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${
                    splitMode === 'percent'
                      ? 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_8px_18px_-8px_var(--color-glow)]'
                      : 'border text-slate-600 hover:bg-white/40 border-[var(--color-glass-border)] dark:text-slate-300 dark:hover:bg-white/5'
                  }`}
                >
                  {t('expenses.splitPercent')}
                </button>
                <button
                  type="button"
                  onClick={() => setSplitMode('custom')}
                  className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${
                    splitMode === 'custom'
                      ? 'bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] text-white shadow-[0_8px_18px_-8px_var(--color-glow)]'
                      : 'border text-slate-600 hover:bg-white/40 border-[var(--color-glass-border)] dark:text-slate-300 dark:hover:bg-white/5'
                  }`}
                >
                  {t('expenses.splitCustom')}
                </button>
              </div>
            ) : (
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-slate-600 dark:text-slate-300">{t('expenses.splitEqual')}</span>
                <button
                  type="button"
                  onClick={() => setShowSplitOptions(true)}
                  className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  {t('expenses.splitOtherWay')}
                </button>
              </div>
            )}

            <div className="space-y-2">
              {acceptedMembers.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 dark:text-slate-200">{m.profile?.username ?? m.user_id}</span>
                  {splitMode === 'equal' ? (
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {formatCurrency((equalShares[m.user_id] ?? 0) / 100, currency, language)}
                    </span>
                  ) : splitMode === 'percent' ? (
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={percentAmounts[m.user_id] ?? ''}
                          onChange={(e) => setPercentAmounts((prev) => ({ ...prev, [m.user_id]: e.target.value }))}
                          placeholder="0"
                          aria-label={t('expenses.percentForLabel', { name: m.profile?.username ?? m.user_id })}
                          className="w-16 rounded-2xl border px-2 py-1.5 pr-5 text-right text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-slate-500 dark:text-slate-400">%</span>
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs text-slate-500 dark:text-slate-400">
                        {(() => {
                          const pct = Number.parseFloat((percentAmounts[m.user_id] ?? '0').replace(',', '.'))
                          const cents = Math.round(Math.round((totalValid ? totalAmount : 0) * 100) * ((Number.isFinite(pct) ? pct : 0) / 100))
                          return formatCurrency(cents / 100, currency, language)
                        })()}
                      </span>
                    </div>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customAmounts[m.user_id] ?? ''}
                      onChange={(e) =>
                        setCustomAmounts((prev) => ({ ...prev, [m.user_id]: e.target.value }))
                      }
                      placeholder="0.00"
                      aria-label={t('expenses.amountForLabel', { name: m.profile?.username ?? m.user_id })}
                      className="w-24 rounded-2xl border px-2 py-1.5 text-right text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-glass-border)] bg-[var(--color-glass)] dark:text-slate-100"
                    />
                  )}
                </div>
              ))}
            </div>
            {splitMode === 'custom' && totalValid && (
              <p className={`mt-2 text-xs ${customMatchesTotal ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {t('expenses.sumCurrent', {
                  sum: formatCurrency(customTotalCents / 100, currency, language),
                  total: formatCurrency(totalAmount, currency, language),
                })}
              </p>
            )}
            {splitMode === 'percent' && totalValid && (
              <p className={`mt-2 text-xs ${percentComplete ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                {percentComplete
                  ? t('expenses.percentAssigned', { sum: percentRounded })
                  : percentRounded < 100
                    ? t('expenses.percentUnassigned', { pct: (Math.round((100 - percentRounded) * 100) / 100).toString() })
                    : t('expenses.percentOver', { pct: (Math.round((percentRounded - 100) * 100) / 100).toString() })}
              </p>
            )}
            {!splitComplete && (splitMode === 'custom' || splitMode === 'percent') && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('expenses.draftHint')}</p>
            )}
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleRequestClose}
              className="flex-1 rounded-full border px-4 py-2.5 font-medium text-slate-700 hover:bg-white/60 border-[var(--color-glass-border)] dark:text-slate-200 dark:hover:bg-white/10"
            >
              {t('expenses.close')}
            </button>
            <button
              type="submit"
              disabled={submitting || ocrRunning}
              className="flex-1 rounded-full bg-gradient-to-br from-[var(--color-brand-500)] to-[var(--color-brand-600)] px-4 py-2.5 font-medium text-white shadow-[0_10px_22px_-10px_var(--color-glow)] disabled:opacity-60"
            >
              {submitting ? t('common.saving') : isEditing ? t('expenses.saveChanges') : t('expenses.saveExpense')}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
