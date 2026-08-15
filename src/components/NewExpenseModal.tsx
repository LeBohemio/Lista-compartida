import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../context/AuthContext'
import { extractReceiptTotal, OCR_CONFIDENCE_THRESHOLD } from '../lib/ocr'
import { EXPENSE_CATEGORIES } from '../lib/categories'
import type { Expense, ExpenseCategory, ListMember } from '../lib/types'

type SplitMode = 'equal' | 'custom'

function splitEqually(totalCents: number, userIds: string[]): Record<string, number> {
  const n = userIds.length
  const base = Math.floor(totalCents / n)
  let remainder = totalCents - base * n
  const result: Record<string, number> = {}
  for (const id of userIds) {
    result[id] = base + (remainder > 0 ? 1 : 0)
    if (remainder > 0) remainder--
  }
  return result
}

export default function NewExpenseModal({
  listId,
  members,
  editing,
  onClose,
  onCreated,
}: {
  listId: string
  members: ListMember[]
  editing?: Expense
  onClose: () => void
  onCreated: () => void
}) {
  const { user } = useAuth()
  const acceptedMembers = useMemo(() => members.filter((m) => m.status === 'accepted'), [members])
  const isEditing = !!editing

  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState(0)
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(editing?.ocr_confidence ?? null)
  const [ocrChecked, setOcrChecked] = useState(false)

  const [description, setDescription] = useState(editing?.description ?? '')
  const [category, setCategory] = useState<ExpenseCategory>(() => {
    if (editing) return editing.category
    const stored = localStorage.getItem(`lastCategory:${listId}`) as ExpenseCategory | null
    return stored && EXPENSE_CATEGORIES.some((c) => c.value === stored) ? stored : 'otros'
  })
  const [amountInput, setAmountInput] = useState(editing ? editing.total_amount.toFixed(2) : '')
  const [paidBy, setPaidBy] = useState(editing?.paid_by ?? user?.id ?? '')
  const [splitMode, setSplitMode] = useState<SplitMode>(editing ? 'custom' : 'equal')
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(() => {
    if (!editing?.shares) return {}
    const initial: Record<string, string> = {}
    for (const s of editing.shares) if (s.user_id) initial[s.user_id] = s.amount.toFixed(2)
    return initial
  })

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user) return
    setError(null)

    if (!totalValid) {
      setError('Introduce un importe total válido.')
      return
    }
    if (!paidBy) {
      setError('Indica quién ha pagado el ticket.')
      return
    }
    if (splitMode === 'custom' && !customMatchesTotal) {
      setError('Los importes personalizados deben sumar exactamente el total.')
      return
    }
    if (acceptedMembers.length === 0) {
      setError('No hay miembros aceptados en la lista para repartir el gasto.')
      return
    }

    setSubmitting(true)

    let receiptPath: string | null = editing?.receipt_image_path ?? null
    if (file) {
      const ext = file.name.split('.').pop() || 'jpg'
      const path = `${listId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadErr } = await supabase.storage.from('receipts').upload(path, file, {
        contentType: file.type || 'image/jpeg',
      })
      if (uploadErr) {
        setError(`No se pudo subir la foto del ticket: ${uploadErr.message}`)
        setSubmitting(false)
        return
      }
      receiptPath = path
    }

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
          paid_by: paidBy,
        })
        .eq('id', editing!.id)
      if (updateErr) {
        setError(updateErr.message)
        setSubmitting(false)
        return
      }
      expenseId = editing!.id
      const { error: delSharesErr } = await supabase.from('expense_shares').delete().eq('expense_id', expenseId)
      if (delSharesErr) {
        setError(delSharesErr.message)
        setSubmitting(false)
        return
      }
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
          paid_by: paidBy,
          created_by: user.id,
        })
        .select()
        .single()

      if (expenseErr || !expense) {
        setError(expenseErr?.message ?? 'No se pudo registrar el gasto.')
        setSubmitting(false)
        return
      }
      expenseId = expense.id
    }

    const shareCentsById = splitMode === 'equal' ? equalShares : null
    const shareRows = acceptedMembers.map((m) => {
      const cents =
        splitMode === 'equal'
          ? shareCentsById![m.user_id]
          : Math.round(Number.parseFloat((customAmounts[m.user_id] ?? '0').replace(',', '.')) * 100)
      return { expense_id: expenseId, user_id: m.user_id, amount: cents / 100 }
    })

    const { error: sharesErr } = await supabase.from('expense_shares').insert(shareRows)
    setSubmitting(false)
    if (sharesErr) {
      setError(sharesErr.message)
      return
    }
    localStorage.setItem(`lastCategory:${listId}`, category)
    onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-6 shadow-xl sm:rounded-2xl bg-[var(--color-surface)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{isEditing ? 'Editar gasto' : 'Nuevo gasto'}</h2>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Foto del ticket {isEditing ? '(sustituir, opcional)' : '(opcional)'}
            </label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFile}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100 dark:text-slate-300 dark:file:bg-brand-950/40 dark:file:text-brand-400"
            />
            {!previewUrl && isEditing && editing?.receipt_image_path && (
              <p className="mt-2 text-xs text-slate-400">Ya hay una foto de ticket guardada. Sube una nueva para sustituirla.</p>
            )}
            {previewUrl && (
              <img src={previewUrl} alt="Vista previa del ticket" className="mt-3 max-h-48 rounded-lg object-contain" />
            )}
            {ocrRunning && (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Leyendo el ticket… {ocrProgress}%</p>
            )}
            {ocrChecked && !ocrRunning && (
              <p className={`mt-2 text-sm ${needsManualReview ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                {needsManualReview
                  ? '⚠️ No hemos podido leer el importe con confianza. Revisa y corrige el total manualmente.'
                  : '✓ Importe detectado automáticamente. Puedes corregirlo si no es correcto.'}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Importe total (€)</label>
            <input
              type="text"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0.00"
              className={`w-full rounded-lg border px-3 py-2.5 text-base focus:outline-none focus:ring-2 bg-[var(--color-surface-alt)] dark:text-slate-100 ${
                needsManualReview
                  ? 'border-amber-400 focus:border-amber-500 focus:ring-amber-100'
                  : 'focus:border-brand-500 focus:ring-brand-100 border-[var(--color-surface-border)]'
              }`}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">Descripción (opcional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej. Supermercado, cena…"
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Categoría</label>
            <div className="flex flex-wrap gap-2">
              {EXPENSE_CATEGORIES.map((c) => (
                <button
                  type="button"
                  key={c.value}
                  onClick={() => setCategory(c.value)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    category === c.value
                      ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400'
                      : 'text-slate-600 hover:border-brand-300 border-[var(--color-surface-border)] dark:text-slate-300'
                  }`}
                >
                  {c.icon} {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">¿Quién ha pagado?</label>
            <select
              value={paidBy}
              onChange={(e) => setPaidBy(e.target.value)}
              className="w-full rounded-lg border px-3 py-2.5 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
            >
              {acceptedMembers.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.profile?.username ?? m.user_id} {m.user_id === user?.id ? '(tú)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Reparto</label>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => setSplitMode('equal')}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                  splitMode === 'equal'
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400'
                    : 'text-slate-600 border-[var(--color-surface-border)] dark:text-slate-300'
                }`}
              >
                Partes iguales
              </button>
              <button
                type="button"
                onClick={() => setSplitMode('custom')}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                  splitMode === 'custom'
                    ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-400'
                    : 'text-slate-600 border-[var(--color-surface-border)] dark:text-slate-300'
                }`}
              >
                Importes personalizados
              </button>
            </div>

            <div className="space-y-2">
              {acceptedMembers.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 dark:text-slate-200">{m.profile?.username ?? m.user_id}</span>
                  {splitMode === 'equal' ? (
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {((equalShares[m.user_id] ?? 0) / 100).toFixed(2)} €
                    </span>
                  ) : (
                    <input
                      type="text"
                      inputMode="decimal"
                      value={customAmounts[m.user_id] ?? ''}
                      onChange={(e) =>
                        setCustomAmounts((prev) => ({ ...prev, [m.user_id]: e.target.value }))
                      }
                      placeholder="0.00"
                      className="w-24 rounded-lg border px-2 py-1.5 text-right text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 border-[var(--color-surface-border)] bg-[var(--color-surface-alt)] dark:text-slate-100"
                    />
                  )}
                </div>
              ))}
            </div>
            {splitMode === 'custom' && totalValid && (
              <p className={`mt-2 text-xs ${customMatchesTotal ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                Suma actual: {(customTotalCents / 100).toFixed(2)} € de {totalAmount.toFixed(2)} €
              </p>
            )}
          </div>

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border px-4 py-2.5 font-medium text-slate-700 hover:bg-slate-50 border-[var(--color-surface-border)] dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || ocrRunning}
              className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {submitting ? 'Guardando…' : isEditing ? 'Guardar cambios' : 'Guardar gasto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
