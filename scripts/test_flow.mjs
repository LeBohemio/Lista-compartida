#!/usr/bin/env node
/**
 * Prueba end-to-end del flujo completo de la app contra un proyecto REAL de
 * Supabase (no un mock). Simula 3 usuarios distintos y recorre exactamente
 * el flujo pedido:
 *
 *  1. Crear las 3 cuentas
 *  2. Lista A (sin gastos) creada por user1, invita a user2 y user3
 *  3. Lista B (con gastos) creada por user1, invita a user2 y user3
 *  4. Añadir ítems en Lista A y marcarlos
 *  5. Subir un ticket de ejemplo a Lista B, comprobar OCR
 *  6. Repartir el gasto entre los 3
 *  7. Marcar una deuda como saldada
 *  8. Verificar que el balance final es correcto
 *
 * Uso:
 *   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... node scripts/test_flow.mjs
 * (o simplemente `node scripts/test_flow.mjs` si ya existe un .env en la raíz)
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { extractReceiptTotal, OCR_CONFIDENCE_THRESHOLD } from '../src/lib/ocr.ts'
import { computeNetBalances, simplifyDebts } from '../src/lib/balances.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('TU-PROYECTO')) {
  console.error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env. Copia .env.example a .env y rellena tus credenciales.')
  process.exit(1)
}

const stamp = Date.now()
const USERS = [
  { username: `ana_test_${stamp}`, email: `ana+${stamp}@example.com`, password: 'password123' },
  { username: `beto_test_${stamp}`, email: `beto+${stamp}@example.com`, password: 'password123' },
  { username: `carla_test_${stamp}`, email: `carla+${stamp}@example.com`, password: 'password123' },
]

let passCount = 0
let failCount = 0
function assert(cond, msg) {
  if (cond) {
    console.log('✓', msg)
    passCount++
  } else {
    console.error('❌ FAIL:', msg)
    failCount++
  }
}
function section(title) {
  console.log(`\n=== ${title} ===`)
}

function client() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signUpAndSignIn(c, u) {
  const { data: signUpData, error: signUpErr } = await c.auth.signUp({
    email: u.email,
    password: u.password,
    options: { data: { username: u.username } },
  })
  if (signUpErr) throw new Error(`signUp(${u.email}): ${signUpErr.message}`)

  if (!signUpData.session) {
    // El proyecto pide confirmación de email: no podremos continuar sin desactivarla.
    const { error: signInErr } = await c.auth.signInWithPassword({ email: u.email, password: u.password })
    if (signInErr) {
      throw new Error(
        `No hay sesión tras el registro y el login también falla (${signInErr.message}). ` +
          'Desactiva "Confirm email" en Supabase → Authentication → Providers → Email para poder probar sin servidor de correo.',
      )
    }
  }
  return signUpData.user
}

async function main() {
  section('1. Registro de 3 usuarios')
  const clients = USERS.map(() => client())
  const authUsers = []
  for (let i = 0; i < USERS.length; i++) {
    const user = await signUpAndSignIn(clients[i], USERS[i])
    authUsers.push(user)
    assert(!!user?.id, `Usuario ${USERS[i].username} registrado y autenticado`)
  }
  const [ana, beto, carla] = clients
  const [anaUser, betoUser, carlaUser] = authUsers

  // Espera breve a que el trigger handle_new_user cree las filas en profiles.
  await new Promise((r) => setTimeout(r, 1000))

  section('2. Lista A (solo notas) creada por Ana, invita a Beto y Carla')
  const { data: listA, error: listAErr } = await ana
    .from('lists')
    .insert({ name: 'Compra semanal', owner_id: anaUser.id, expenses_enabled: false })
    .select()
    .single()
  assert(!listAErr && listA, `Lista A creada: ${listAErr?.message ?? listA?.id}`)

  await ana.from('list_members').insert({
    list_id: listA.id,
    user_id: anaUser.id,
    role: 'owner',
    status: 'accepted',
    invited_identifier: ana.auth.user?.() ?? USERS[0].email,
    responded_at: new Date().toISOString(),
  })

  const { error: invBetoAErr } = await ana
    .from('list_members')
    .insert({ list_id: listA.id, user_id: betoUser.id, role: 'member', status: 'invited', invited_identifier: USERS[1].email })
  assert(!invBetoAErr, `Beto invitado a Lista A: ${invBetoAErr?.message ?? 'ok'}`)

  const { error: invCarlaAErr } = await ana
    .from('list_members')
    .insert({ list_id: listA.id, user_id: carlaUser.id, role: 'member', status: 'invited', invited_identifier: USERS[2].email })
  assert(!invCarlaAErr, `Carla invitada a Lista A: ${invCarlaAErr?.message ?? 'ok'}`)

  const { error: acceptBetoAErr } = await beto
    .from('list_members')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('list_id', listA.id)
    .eq('user_id', betoUser.id)
  assert(!acceptBetoAErr, 'Beto acepta la invitación a Lista A')

  const { error: acceptCarlaAErr } = await carla
    .from('list_members')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('list_id', listA.id)
    .eq('user_id', carlaUser.id)
  assert(!acceptCarlaAErr, 'Carla acepta la invitación a Lista A')

  section('3. Ítems en Lista A: añadir, marcar, eliminar definitivamente')
  const { data: item1 } = await ana.from('items').insert({ list_id: listA.id, content: 'Leche', created_by: anaUser.id }).select().single()
  const { data: item2 } = await beto.from('items').insert({ list_id: listA.id, content: 'Pan', created_by: betoUser.id }).select().single()
  const { data: item3 } = await carla.from('items').insert({ list_id: listA.id, content: 'Fruta', created_by: carlaUser.id }).select().single()
  assert(!!item1 && !!item2 && !!item3, 'Los 3 usuarios pueden añadir ítems de texto libre a Lista A')

  const { data: toggled } = await beto
    .from('items')
    .update({ done: true, done_at: new Date().toISOString() })
    .eq('id', item1.id)
    .select()
    .single()
  assert(toggled?.done === true, 'Beto marca "Leche" como comprado (se tacha, no desaparece)')

  const { data: stillThere } = await ana.from('items').select('*').eq('list_id', listA.id)
  assert(stillThere.length === 3, `El ítem tachado sigue existiendo (${stillThere.length}/3 ítems visibles)`)

  const { error: delErr } = await beto.from('items').delete().eq('id', item1.id).eq('done', true)
  const { data: afterDelete } = await ana.from('items').select('*').eq('list_id', listA.id)
  assert(!delErr && afterDelete.length === 2, 'Acción explícita de papelera elimina definitivamente el ítem tachado')

  section('4. Lista B (con gastos) creada por Ana, invita a Beto y Carla')
  const { data: listB } = await ana
    .from('lists')
    .insert({ name: 'Viaje a la playa', owner_id: anaUser.id, expenses_enabled: true })
    .select()
    .single()
  assert(!!listB, 'Lista B creada con expenses_enabled = true')

  await ana.from('list_members').insert({
    list_id: listB.id,
    user_id: anaUser.id,
    role: 'owner',
    status: 'accepted',
    invited_identifier: USERS[0].email,
    responded_at: new Date().toISOString(),
  })
  await ana.from('list_members').insert({ list_id: listB.id, user_id: betoUser.id, role: 'member', status: 'invited', invited_identifier: USERS[1].email })
  await ana.from('list_members').insert({ list_id: listB.id, user_id: carlaUser.id, role: 'member', status: 'invited', invited_identifier: USERS[2].email })
  await beto.from('list_members').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('list_id', listB.id).eq('user_id', betoUser.id)
  await carla.from('list_members').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('list_id', listB.id).eq('user_id', carlaUser.id)

  const { data: membersB } = await ana.from('list_members').select('*').eq('list_id', listB.id).eq('status', 'accepted')
  assert(membersB.length === 3, `Los 3 usuarios son miembros aceptados de Lista B (${membersB.length}/3)`)

  section('5. Subida de ticket + OCR')
  const receiptPath = path.join(__dirname, '..', '..', 'receipt_sample.png')
  const receiptBuffer = fs.existsSync('/tmp/receipt_sample.png')
    ? fs.readFileSync('/tmp/receipt_sample.png')
    : fs.readFileSync(receiptPath)

  const ocrResult = await extractReceiptTotal(new Blob([receiptBuffer], { type: 'image/png' }))
  assert(ocrResult.amount !== null, `OCR extrae un importe del ticket: ${ocrResult.amount}€ (confianza ${ocrResult.confidence})`)
  const needsManualReview = ocrResult.confidence < OCR_CONFIDENCE_THRESHOLD
  console.log(`   → ${needsManualReview ? 'Confianza baja: la UI pediría confirmación/corrección manual' : 'Confianza suficiente: se acepta automáticamente (editable)'}`)

  const storagePath = `${listB.id}/${Date.now()}-ticket.png`
  const { error: uploadErr } = await ana.storage.from('receipts').upload(storagePath, receiptBuffer, { contentType: 'image/png' })
  assert(!uploadErr, `Foto del ticket subida a Storage: ${uploadErr?.message ?? storagePath}`)

  section('6. Registrar el gasto y repartirlo entre los 3')
  const totalAmount = ocrResult.amount ?? 9.65
  const { data: expense, error: expenseErr } = await ana
    .from('expenses')
    .insert({
      list_id: listB.id,
      description: 'Cena de bienvenida',
      total_amount: totalAmount,
      receipt_image_path: storagePath,
      ocr_confidence: ocrResult.confidence,
      paid_by: anaUser.id,
      created_by: anaUser.id,
    })
    .select()
    .single()
  assert(!expenseErr && !!expense, `Gasto de ${totalAmount}€ registrado (pagado por Ana): ${expenseErr?.message ?? 'ok'}`)

  const totalCents = Math.round(totalAmount * 100)
  const base = Math.floor(totalCents / 3)
  let remainder = totalCents - base * 3
  const shareAmounts = [anaUser.id, betoUser.id, carlaUser.id].map((id) => {
    const cents = base + (remainder > 0 ? 1 : 0)
    if (remainder > 0) remainder--
    return { expense_id: expense.id, user_id: id, amount: cents / 100 }
  })
  const { error: sharesErr } = await ana.from('expense_shares').insert(shareAmounts)
  assert(!sharesErr, `Reparto a partes iguales guardado (3 partes que suman ${totalAmount}€): ${sharesErr?.message ?? 'ok'}`)

  section('7. Comprobar balance antes de saldar')
  const { data: expensesForBalance } = await ana
    .from('expenses')
    .select('*, shares:expense_shares(*)')
    .eq('list_id', listB.id)
  const { data: settlementsBefore } = await ana.from('settlements').select('*').eq('list_id', listB.id)

  let balances = computeNetBalances(expensesForBalance, settlementsBefore ?? [])
  console.log('   Balances:', balances)
  assert(balances[anaUser.id] > 0, `Ana (pagadora) tiene balance positivo: ${balances[anaUser.id]?.toFixed(2)}€`)
  assert(balances[betoUser.id] < 0, `Beto debe dinero: ${balances[betoUser.id]?.toFixed(2)}€`)
  assert(balances[carlaUser.id] < 0, `Carla debe dinero: ${balances[carlaUser.id]?.toFixed(2)}€`)

  let debts = simplifyDebts(balances)
  const betoDebt = debts.find((d) => d.from === betoUser.id && d.to === anaUser.id)
  assert(!!betoDebt, `Deuda sugerida detectada: Beto debe ${betoDebt?.amount}€ a Ana`)

  section('8. Beto salda su deuda con Ana')
  const { error: settleErr } = await beto.from('settlements').insert({
    list_id: listB.id,
    from_user: betoUser.id,
    to_user: anaUser.id,
    amount: betoDebt.amount,
    note: 'Bizum de prueba',
    created_by: betoUser.id,
  })
  assert(!settleErr, `Settlement registrado: ${settleErr?.message ?? 'ok'}`)

  const { data: settlementsAfter } = await ana.from('settlements').select('*').eq('list_id', listB.id)
  assert(settlementsAfter.length === 1, 'El pago queda registrado en el histórico (no se borra nada)')

  balances = computeNetBalances(expensesForBalance, settlementsAfter)
  assert(Math.abs(balances[betoUser.id]) < 0.01, `Balance de Beto tras saldar ≈ 0: ${balances[betoUser.id]?.toFixed(2)}€`)
  debts = simplifyDebts(balances)
  assert(
    !debts.some((d) => d.from === betoUser.id),
    'Beto ya no aparece en las deudas pendientes tras marcarla como saldada',
  )
  assert(
    debts.some((d) => d.from === carlaUser.id && d.to === anaUser.id),
    'Carla sigue debiendo su parte a Ana (no se ha tocado su deuda)',
  )

  section('Resumen')
  console.log(`\n${passCount} comprobaciones OK, ${failCount} fallidas.`)
  if (failCount > 0) process.exit(1)
}

main().catch((err) => {
  console.error('\n💥 Error inesperado durante la prueba:', err)
  process.exit(1)
})
