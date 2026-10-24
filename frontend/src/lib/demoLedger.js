// The /#/demo walkthrough's money, in memory only, following the server's rules
// (CLAUDE.md rules 9-12, section 6) for one creator and one site intermediary:
//   - M-Pesa: every share is credited at once, available to its owner.
//   - Cash: the creator already holds the cash, so her share is recorded as received
//     (never payable), and the intermediary's 15% and the fund's 5% become debts she owes.
//   - Debts settle oldest first and whole, never in part, from the creator's available
//     M-Pesa balance, as soon as it covers one: after an M-Pesa credit, a withdrawal or
//     the sweep. The money moves from her balance to the creditor's.
//   - Withdrawals are the full payable balance, from KSh 500. The 18:00 sweep settles
//     debts first, then pays everyone payable at KSh 500 or more.
//   - The fund is ring-fenced: never paid out.
// Collected by M-Pesa = creator + intermediary + fund (available + paid out), always.
export const THRESHOLD = 500

export const emptyLedger = () => ({
  available: { creator: 0, intermediary: 0, fund: 0 },
  paid: { creator: 0, intermediary: 0 },
  cashHeld: 0,
  collected: 0,
  cashRecorded: 0,
  debts: [], // { id, saleId, creditor: "intermediary" | "fund", amount, settled }
  payouts: [], // { who, amount, how: "withdraw" | "sweep" }
})

// Settles every outstanding debt the creator's available balance covers in full, oldest
// first; one that doesn't fit waits, and a later, smaller one may still settle.
export function settle(ledger) {
  const l = structuredClone(ledger)
  for (const d of l.debts) {
    if (d.settled || l.available.creator < d.amount) continue
    l.available.creator -= d.amount
    l.available[d.creditor] += d.amount
    d.settled = true
  }
  return l
}

export function record(ledger, sale) {
  const l = structuredClone(ledger)
  const s = sale.split
  if (sale.method === "mpesa") {
    l.collected += s.total
    l.available.creator += s.creator
    l.available.intermediary += s.intermediary
    l.available.fund += s.fund
  } else {
    l.cashRecorded += s.total
    l.cashHeld += s.creator
    if (s.intermediary > 0) l.debts.push({ id: `${sale.id}-i`, saleId: sale.id, creditor: "intermediary", amount: s.intermediary, settled: false })
    l.debts.push({ id: `${sale.id}-f`, saleId: sale.id, creditor: "fund", amount: s.fund, settled: false })
  }
  return settle(l)
}

export const owed = (l) => l.debts.filter((d) => !d.settled).reduce((sum, d) => sum + d.amount, 0)

// What can go to M-Pesa: the intermediary's available balance; the creator's, less what
// she still owes. The fund: never.
export function payable(l, who) {
  if (who === "intermediary") return l.available.intermediary
  if (who === "creator") return Math.max(l.available.creator - owed(l), 0)
  return 0
}

export function withdraw(ledger, who, how = "withdraw") {
  const l = settle(ledger)
  const amount = payable(l, who)
  if (who === "fund" || amount < THRESHOLD) return l
  l.available[who] -= amount
  l.paid[who] += amount
  l.payouts.push({ who, amount, how })
  return l
}

export function sweep(ledger) {
  let l = settle(ledger)
  for (const who of ["creator", "intermediary"]) l = withdraw(l, who, "sweep")
  return l
}

export function totals(l) {
  const creators = l.available.creator + l.paid.creator
  const intermediaries = l.available.intermediary + l.paid.intermediary
  const fund = l.available.fund
  const paidOut = l.paid.creator + l.paid.intermediary
  return { collected: l.collected, creators, intermediaries, fund, paidOut, stillOwed: l.collected - paidOut, cashRecorded: l.cashRecorded, cashDebts: owed(l) }
}
