import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Check } from "lucide-react"
import { ErrorNote, LiveIndicator, StatusBadge } from "../components/ui"
import { api } from "../lib/api"
import { eatDate, eatDateTime, eatTime, ksh, referrerKind, wasCredited } from "../lib/format"
import { useLiveChanges } from "../lib/realtime"

function Tile({ label, value, note, tone = "text-sawa-text" }) {
  return (
    <div className="rounded-sawa border border-sawa-border bg-sawa-surface p-4">
      <div className="text-[13px] text-sawa-text-muted">{label}</div>
      <div className={`mt-1 font-mono text-[28px] font-bold tabular-nums ${tone}`}>{ksh(value)}</div>
      {note && <div className="mt-1 text-xs text-sawa-text-muted">{note}</div>}
    </div>
  )
}

function Th({ children, right = false }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap border-b border-sawa-border px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-sawa-text-muted ${right ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  )
}

function Td({ children, right = false, mono = false, className = "", colSpan }) {
  return (
    <td
      colSpan={colSpan}
      className={`border-b border-sawa-border px-3 py-2.5 text-sm ${right ? "text-right" : ""} ${mono ? "whitespace-nowrap font-mono tabular-nums" : ""} ${className}`}
    >
      {children}
    </td>
  )
}

const CHECK_LABEL = {
  pending: "Waiting for Safaricom",
  mismatch: "Safaricom says not paid",
  unanswered: "Safaricom never answered",
  amount_mismatch: "Callback amount was wrong",
  unresolved: "No final answer yet",
  paid_late: "Paid late",
}

// What each flagged check means for the money, in a coordinator's terms.
function checkMeaning(c) {
  if (c.state === "unresolved")
    return "Nobody is credited. The sale was released after 10 minutes so the creator could carry on. Safaricom is asked again every 15 minutes."
  if (c.state === "paid_late")
    return "Safaricom confirmed it after the sale was released, so it was credited then. Check the tourist didn't pay this sale twice."
  if (c.state === "amount_mismatch") return "The callback was refused and nobody was credited."
  if (c.transaction_status === "verifying") return "Nobody is credited until Safaricom confirms it."
  if (c.state === "mismatch" && c.transaction_status === "failed") return "Marked failed. Nobody was credited."
  if (c.state === "mismatch") return "Already credited (flag mode). Flag a dispute to hold the shares."
  return "Credited (flag mode). Check again, or flag a dispute to hold the shares."
}

function PaymentChecks({ checks, reload }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  async function checkAgain(id) {
    setBusy(id)
    setError(null)
    try {
      await api(`/admin/transactions/${id}/check-payment`, { method: "POST", auth: true })
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Payment checks</h2>
      <p className="mt-1 text-sm text-sawa-text-muted">
        Every M-Pesa payment is confirmed with Safaricom (STK Push Query). These ones need a look.
      </p>
      <div className="mt-2">
        <ErrorNote>{error}</ErrorNote>
      </div>
      <div className="relative mt-3 overflow-x-auto rounded-sawa border border-sawa-border bg-sawa-surface">
        <table className="w-full min-w-[760px] border-collapse">
          <thead>
            <tr>
              <Th>When (EAT)</Th>
              <Th>Creator</Th>
              <Th right>Total</Th>
              <Th>Check</Th>
              <Th>What it means</Th>
              <Th>
                <span className="sr-only">Action</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.transaction_id}>
                <Td mono>{eatDateTime(c.created_at)}</Td>
                <Td>{c.producer_name}</Td>
                <Td right mono>{ksh(c.total_amount)}</Td>
                <Td>
                  <span className="font-semibold">{CHECK_LABEL[c.state] || c.state}</span>
                  {c.last_result && <div className="mt-0.5 text-xs text-sawa-text-muted">{c.last_result}</div>}
                  {c.state === "amount_mismatch" && c.callback_amount != null && (
                    <div className="mt-0.5 text-xs text-sawa-text-muted">Callback said {ksh(c.callback_amount)}</div>
                  )}
                </Td>
                <Td className="text-sawa-text-muted">{checkMeaning(c)}</Td>
                <Td right>
                  {!["amount_mismatch", "paid_late"].includes(c.state) && c.transaction_status !== "failed" && (
                    <button
                      type="button"
                      onClick={() => checkAgain(c.transaction_id)}
                      disabled={busy === c.transaction_id}
                      className="whitespace-nowrap text-sm text-sawa-green underline-offset-2 hover:underline disabled:text-sawa-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"
                    >
                      {busy === c.transaction_id ? "Checking…" : "Check again"}
                    </button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// Every payout stops when M-Pesa refuses the payout credential (migration 0015), so a
// locked initiator isn't hammered into a longer lock. Resume once it's fixed.
function PayoutsPaused({ pause, reload }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function resume() {
    setBusy(true)
    setError(null)
    try {
      await api("/admin/payouts/resume", { method: "POST", auth: true })
      await reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section role="alert" className="mt-4 rounded-sawa border border-sawa-terracotta/40 bg-sawa-surface p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold text-sawa-terracotta">
        <AlertTriangle aria-hidden="true" className="size-4 shrink-0" /> Payouts are paused
      </p>
      <p className="mt-1 text-sawa-text-muted">
        M-Pesa refused the payout credential (ResultCode {pause.result_code}: {pause.reason}) at {eatDateTime(pause.paused_at)}.
        No payout is sent until you resume, so a locked credential isn't locked for longer. Balances are safe. Fix the
        credential in the Daraja portal first.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={resume}
          disabled={busy}
          className="text-sm text-sawa-green underline-offset-2 hover:underline disabled:text-sawa-text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"
        >
          {busy ? "Resuming…" : "Resume payouts"}
        </button>
      </div>
      <div className="mt-2">
        <ErrorNote>{error}</ErrorNote>
      </div>
    </section>
  )
}

function useReconciliation() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(async () => {
    try {
      setData(await api("/admin/reconciliation", { auth: true }))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])
  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])
  const live = useLiveChanges("coordinator-reconciliation", load)
  return { data, error, live, reload: load }
}

export default function ReconciliationPage({ renderTransactionAction, renderWithdrawalAction }) {
  const { data, error, live, reload } = useReconciliation()
  const t = data?.totals
  const unaccounted = t ? Number(t.collected) - Number(t.ledger_paid) - Number(t.pending) : 0
  // The Conservation fund (fixed split, migration 0020): shown once it holds or is owed anything.
  const hasFund = t && (Number(t.fund) > 0 || Number(t.fund_debts_outstanding) > 0)

  return (
    <main className="mx-auto w-full max-w-[420px] px-4 py-8 md:max-w-6xl md:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Reconciliation</h1>
        <LiveIndicator live={live} />
      </div>
      <p className="mt-1 text-[15px] text-sawa-text-muted">
        Every M-Pesa shilling collected is either paid out or still owed to a creator or site intermediary. Cash
        stays with the creator, so it's shown beside these totals, not in them.
      </p>

      <div className="mt-4">
        <ErrorNote>{error}</ErrorNote>
      </div>
      {data?.payouts_paused && <PayoutsPaused pause={data.payouts_paused} reload={reload} />}

      {t && (
        <>
          <section aria-label="Totals" className="mt-6 grid gap-3 md:grid-cols-3">
            <Tile label="Collected" value={t.collected} note="M-Pesa only: what reached the account" />
            <Tile label="Paid out" value={t.disbursed} note="Sent by M-Pesa B2C" tone="text-sawa-green" />
            <Tile
              label="Still owed"
              value={t.pending}
              note={Number(t.frozen) > 0 ? `${ksh(t.frozen)} frozen by disputes` : "Creators' and site intermediaries' balances"}
            />
          </section>

          <section aria-label="Cash" className="mt-3 grid gap-3 md:grid-cols-3">
            <Tile label="Cash recorded" value={t.cash_recorded} note="Confirmed cash sales. Held by creators, never paid out by M-Pesa." />
            <Tile
              label="Owed to site intermediaries"
              value={t.debts_outstanding}
              note="Site intermediaries' shares of cash sales, moved from creators' M-Pesa earnings as they come in"
            />
            {hasFund && Number(t.fund_debts_outstanding) > 0 && (
              <Tile
                label="Owed to the Conservation & sustainability fund"
                value={t.fund_debts_outstanding}
                note="The fund's 5% of cash sales, moved from creators' M-Pesa earnings as they come in"
              />
            )}
          </section>

          {hasFund && (
            <section aria-label="Conservation & sustainability fund" className="mt-3 rounded-sawa border border-sawa-border bg-sawa-surface p-4">
              <p className="text-sm font-semibold">
                Conservation & sustainability fund: <span className="font-mono tabular-nums">{ksh(t.fund)}</span>
              </p>
              <p className="mt-1 text-[13px] text-sawa-text-muted">
                Held for a partner community conservancy, transferred monthly (two approvals) once signed. Ring-fenced: never
                paid out with creators' and site intermediaries' balances.
              </p>
            </section>
          )}

          <p className={`mt-3 flex items-start gap-2 text-sm ${t.balanced ? "text-sawa-green" : "text-sawa-terracotta"}`}>
            {t.balanced ? (
              <>
                <Check aria-hidden="true" className="size-4 shrink-0" />{" "}
                {hasFund
                  ? `Balanced: collected = creators ${ksh(t.creators)} + site intermediaries ${ksh(t.intermediaries)} + fund ${ksh(t.fund)} = paid out + still owed.`
                  : "Balanced: collected = paid out + still owed."}
              </>
            ) : (
              <>
                <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
                Doesn't add up: collected minus paid and owed is {ksh(unaccounted)}
                {Number(t.ledger_paid) !== Number(t.disbursed) &&
                  `, and ${ksh(t.ledger_paid)} is marked paid against ${ksh(t.disbursed)} actually sent`}
                .
              </>
            )}
          </p>

          {t.needs_attention > 0 && (
            <p className="mt-2 text-sm font-semibold">
              {t.needs_attention} {t.needs_attention === 1 ? "item needs" : "items need"} attention: payment checks, expired
              cash sales and failed payouts are listed first.
            </p>
          )}

          {data.payment_checks.length > 0 && <PaymentChecks checks={data.payment_checks} reload={reload} />}

          <section className="mt-8">
            <h2 className="text-lg font-semibold">Transactions</h2>
            <div className="relative mt-3 overflow-x-auto rounded-sawa border border-sawa-border bg-sawa-surface">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr>
                    <Th>When (EAT)</Th>
                    <Th>Creator</Th>
                    <Th>Intermediary</Th>
                    <Th>Method</Th>
                    <Th>Status</Th>
                    <Th right>Total</Th>
                    <Th right>Creator</Th>
                    <Th right>Intermediary</Th>
                    {renderTransactionAction && <Th><span className="sr-only">Action</span></Th>}
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.length === 0 && (
                    <tr>
                      <Td colSpan={9} className="text-sawa-text-muted">No transactions yet.</Td>
                    </tr>
                  )}
                  {data.transactions.map((row) => (
                    <tr key={row.id} className={row.status === "cash_expired" ? "bg-sawa-bg" : ""}>
                      <Td mono>{eatDateTime(row.created_at)}</Td>
                      <Td>{row.producer_name}</Td>
                      <Td className={row.driver_name ? "" : "text-sawa-text-muted"}>{row.driver_name || "None"}</Td>
                      <Td>{row.payment_method === "mpesa" ? "M-Pesa" : "Cash"}</Td>
                      <Td>
                        <StatusBadge status={row.status} />
                      </Td>
                      <Td right mono>{ksh(row.total_amount)}</Td>
                      {wasCredited(row.status) ? (
                        <>
                          <Td right mono className="text-sawa-green">{ksh(row.maker_amount)}</Td>
                          <Td right mono>{ksh(row.driver_amount)}</Td>
                        </>
                      ) : (
                        <Td right colSpan={2} className="whitespace-nowrap text-sawa-text-muted">Not credited</Td>
                      )}
                      {renderTransactionAction && <Td right>{renderTransactionAction(row, reload)}</Td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.debts.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">Cash debts</h2>
              <p className="mt-1 text-sm text-sawa-text-muted">
                Each creator owes the site intermediary's share of a referred cash sale. It's settled from the creator's next M-Pesa
                earnings, never paid out of anyone else's money.
              </p>
              <div className="relative mt-3 overflow-x-auto rounded-sawa border border-sawa-border bg-sawa-surface">
                <table className="w-full min-w-[560px] border-collapse">
                  <thead>
                    <tr>
                      <Th>Since (EAT)</Th>
                      <Th>Creator owes</Th>
                      <Th>Intermediary</Th>
                      <Th right>Amount</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.debts.map((d) => (
                      <tr key={d.id}>
                        <Td mono>{eatDateTime(d.created_at)}</Td>
                        <Td>{d.producer_name}</Td>
                        <Td>{d.driver_name}</Td>
                        <Td right mono>
                          {ksh(d.amount)}
                          {d.disputed && <span className="ml-2 font-sans text-xs text-sawa-text-muted">on hold: disputed</span>}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.referrers.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">Site intermediaries</h2>
              <p className="mt-1 text-sm text-sawa-text-muted">Sales each site intermediary referred that went through, and their share.</p>
              <div className="relative mt-3 overflow-x-auto rounded-sawa border border-sawa-border bg-sawa-surface">
                <table className="w-full min-w-[480px] border-collapse">
                  <thead>
                    <tr>
                      <Th>Intermediary</Th>
                      <Th>Type</Th>
                      <Th>Code</Th>
                      <Th right>Sales</Th>
                      <Th right>Commission</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.referrers.map((r) => (
                      <tr key={r.referral_code}>
                        <Td>{r.name}</Td>
                        <Td>{referrerKind(r.referrer_type)}</Td>
                        <Td mono>{r.referral_code}</Td>
                        <Td right mono>{r.sales}</Td>
                        <Td right mono>{ksh(r.commission)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.tours?.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-semibold">Tours</h2>
              <p className="mt-1 text-sm text-sawa-text-muted">
                A referral counts only for a tourist who joined the site intermediary's running tour, so joins can't pass the group size.
              </p>
              <div className="relative mt-3 overflow-x-auto rounded-sawa border border-sawa-border bg-sawa-surface">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr>
                      <Th>Intermediary</Th>
                      <Th>Date (EAT)</Th>
                      <Th right>Group size</Th>
                      <Th right>Joined</Th>
                      <Th right>Sales</Th>
                      <Th right>Commission</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tours.map((tour) => (
                      <tr key={tour.id}>
                        <Td>
                          {tour.referrer_name} <span className="font-mono text-xs text-sawa-text-muted">{tour.referral_code}</span>
                        </Td>
                        <Td mono>
                          {eatDate(tour.started_at)}, {eatTime(tour.started_at)}–{tour.ended_at ? eatTime(tour.ended_at) : "running"}
                        </Td>
                        <Td right mono>{tour.group_size}</Td>
                        <Td right mono>{tour.joined}</Td>
                        <Td right mono>{tour.sales}</Td>
                        <Td right mono>{ksh(tour.commission)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-lg font-semibold">Payouts</h2>
            <div className="relative mt-3 overflow-x-auto rounded-sawa border border-sawa-border bg-sawa-surface">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr>
                    <Th>Requested (EAT)</Th>
                    <Th>Recipient</Th>
                    <Th>Status</Th>
                    <Th right>Amount</Th>
                    <Th>M-Pesa receipt</Th>
                    {renderWithdrawalAction && <Th><span className="sr-only">Action</span></Th>}
                  </tr>
                </thead>
                <tbody>
                  {data.withdrawals.length === 0 && (
                    <tr>
                      <Td colSpan={6} className="text-sawa-text-muted">No payouts yet.</Td>
                    </tr>
                  )}
                  {data.withdrawals.map((w) => (
                    <tr key={w.id}>
                      <Td mono>{eatDateTime(w.requested_at)}</Td>
                      <Td>
                        {w.recipient_name} <span className="text-sawa-text-muted">({w.recipient_type})</span>
                      </Td>
                      <Td>
                        <StatusBadge status={w.status} />
                        {w.retry_of && <span className="ml-2 text-xs text-sawa-text-muted">retry</span>}
                      </Td>
                      <Td right mono>{ksh(w.amount)}</Td>
                      <Td mono className="text-sawa-text-muted">{w.b2c_receipt || "—"}</Td>
                      {renderWithdrawalAction && <Td right>{renderWithdrawalAction(w, reload)}</Td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}
