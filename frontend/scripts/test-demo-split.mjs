// Tests the /#/demo split and ledger with plain node (no packages):
//   node frontend/scripts/test-demo-split.mjs
import assert from "node:assert/strict"
import { split } from "../src/lib/demoSplit.js"
import { THRESHOLD, emptyLedger, payable, record, sweep, totals, withdraw } from "../src/lib/demoLedger.js"

let n = 0
function check(desc, fn) {
  fn()
  n++
  console.log(`PASS  ${desc}`)
}
const parts = (x) => [x.creator, x.intermediary, x.fund, x.total]

check("1000 -> 800/150/50", () => assert.deepEqual(parts(split({ price: 1000, withIntermediary: true })), [800, 150, 50, 1000]))
check("700 + 10 photo -> 570/105/35 (photo to the creator, not split)", () =>
  assert.deepEqual(parts(split({ price: 700, photoFee: 10, withIntermediary: true })), [570, 105, 35, 710]))
check("no intermediary 1000 -> 950/0/50", () => assert.deepEqual(parts(split({ price: 1000, withIntermediary: false })), [950, 0, 50, 1000]))
check("333 -> 268/49/16", () => assert.deepEqual(parts(split({ price: 333, withIntermediary: true })), [268, 49, 16, 333]))
check("every price 50..5000, both paths: parts add up, whole shillings, creator >= 80% with an intermediary", () => {
  for (let p = 50; p <= 5000; p++)
    for (const w of [true, false]) {
      const x = split({ price: p, photoFee: 10, withIntermediary: w })
      assert.equal(x.creator + x.intermediary + x.fund, x.total)
      assert.ok([x.creator, x.intermediary, x.fund].every(Number.isInteger))
      assert.ok(x.creatorProduct >= p * (w ? 0.8 : 0.95))
    }
})

const sale = (id, method, price, withIntermediary = true) => ({ id, method, split: split({ price, withIntermediary }) })
check("M-Pesa sale: all three credited at once", () => {
  const l = record(emptyLedger(), sale(1, "mpesa", 1000))
  assert.deepEqual(l.available, { creator: 800, intermediary: 150, fund: 50 })
})
check("cash sale: creator's share held, never payable; debts 150 + 50 outstanding", () => {
  const l = record(emptyLedger(), sale(1, "cash", 1000))
  assert.equal(l.cashHeld, 800)
  assert.equal(payable(l, "creator"), 0)
  assert.deepEqual(l.debts.map((d) => [d.creditor, d.amount, d.settled]), [["intermediary", 150, false], ["fund", 50, false]])
})
check("...then an M-Pesa sale settles both debts whole from her earnings", () => {
  let l = record(emptyLedger(), sale(1, "cash", 1000))
  l = record(l, sale(2, "mpesa", 1000))
  assert.ok(l.debts.every((d) => d.settled))
  assert.deepEqual(l.available, { creator: 600, intermediary: 300, fund: 100 })
})
check("a debt waits until it fits whole; a smaller one after it may still settle", () => {
  let l = record(emptyLedger(), sale(1, "cash", 1000))
  l = record(l, sale(2, "mpesa", 100)) // creator +95: covers the fund's 50, not the intermediary's 150
  assert.deepEqual(l.debts.map((d) => d.settled), [false, true])
})
check(`withdraw only at KSh ${THRESHOLD} or more, in full; the fund never`, () => {
  let l = record(emptyLedger(), sale(1, "mpesa", 1000))
  l = withdraw(l, "intermediary") // 150: refused
  assert.equal(l.paid.intermediary, 0)
  l = withdraw(l, "creator")
  assert.equal(l.paid.creator, 800)
  assert.equal(l.available.creator, 0)
  l = withdraw(l, "fund")
  assert.equal(l.available.fund, 50)
})
check("the sweep settles debts first, pays everyone at 500+, never the fund", () => {
  let l = record(emptyLedger(), sale(1, "mpesa", 1000))
  l = record(l, sale(2, "mpesa", 3000))
  l = record(l, sale(3, "cash", 500))
  l = sweep(l)
  assert.deepEqual(l.paid, { creator: 3200 - 75 - 25, intermediary: 600 + 75 })
  assert.equal(l.available.fund, 200 + 25)
  assert.ok(l.payouts.every((p) => p.how === "sweep"))
})
check("collected = creators + intermediaries + fund = paid out + still owed, through it all", () => {
  let l = emptyLedger()
  const steps = [
    (x) => record(x, sale(1, "cash", 1000)),
    (x) => record(x, sale(2, "mpesa", 333)),
    (x) => record(x, sale(3, "mpesa", 2000, false)),
    (x) => withdraw(x, "creator"),
    (x) => sweep(x),
    (x) => record(x, sale(4, "cash", 700, false)),
  ]
  for (const f of steps) {
    l = f(l)
    const t = totals(l)
    assert.equal(t.collected, t.creators + t.intermediaries + t.fund)
    assert.equal(t.collected, t.paidOut + t.stillOwed)
  }
})
console.log(`== ${n} passed, 0 failed ==`)
