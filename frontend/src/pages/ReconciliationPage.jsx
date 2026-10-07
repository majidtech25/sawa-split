import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Check } from "lucide-react"
import { ErrorNote, LiveIndicator, StatusBadge } from "../components/ui"
import { api } from "../lib/api"
import { eatDateTime, ksh } from "../lib/format"
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

  return (
    <main className="mx-auto w-full max-w-[420px] px-4 py-8 md:max-w-6xl md:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Reconciliation</h1>
        <LiveIndicator live={live} />
      </div>
      <p className="mt-1 text-[15px] text-sawa-text-muted">
        Every shilling collected is either paid out or still owed to a maker or driver.
      </p>

      <div className="mt-4">
        <ErrorNote>{error}</ErrorNote>
      </div>

      {t && (
        <>
          <section aria-label="Totals" className="mt-6 grid gap-3 md:grid-cols-3">
            <Tile label="Collected" value={t.collected} note="M-Pesa and confirmed cash" />
            <Tile label="Paid out" value={t.disbursed} note="Sent by M-Pesa B2C" tone="text-sawa-green" />
            <Tile
              label="Still owed"
              value={t.pending}
              note={Number(t.frozen) > 0 ? `${ksh(t.frozen)} frozen by disputes` : "Makers' and drivers' balances"}
            />
          </section>

          <p className={`mt-3 flex items-start gap-2 text-sm ${t.balanced ? "text-sawa-green" : "text-sawa-terracotta"}`}>
            {t.balanced ? (
              <>
                <Check aria-hidden="true" className="size-4 shrink-0" /> Balanced: collected = paid out + still owed.
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
              {t.needs_attention} {t.needs_attention === 1 ? "item needs" : "items need"} attention: expired cash sales and
              failed payouts are listed first.
            </p>
          )}

          <section className="mt-8">
            <h2 className="text-lg font-semibold">Transactions</h2>
            <div className="mt-3 overflow-x-auto rounded-sawa border border-sawa-border bg-sawa-surface">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr>
                    <Th>When (EAT)</Th>
                    <Th>Maker</Th>
                    <Th>Driver</Th>
                    <Th>Method</Th>
                    <Th>Status</Th>
                    <Th right>Total</Th>
                    <Th right>Maker</Th>
                    <Th right>Driver</Th>
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
                      <Td right mono className="text-sawa-green">{ksh(row.maker_amount)}</Td>
                      <Td right mono>{ksh(row.driver_amount)}</Td>
                      {renderTransactionAction && <Td right>{renderTransactionAction(row, reload)}</Td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-semibold">Payouts</h2>
            <div className="mt-3 overflow-x-auto rounded-sawa border border-sawa-border bg-sawa-surface">
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
