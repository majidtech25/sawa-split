import { useCallback, useEffect, useState } from "react"
import { Check, Wallet } from "lucide-react"
import { ErrorNote, LiveIndicator, Screen, SecondaryButton, StatusBadge } from "../components/ui"
import { api } from "../lib/api"
import { eatDateTime, ksh } from "../lib/format"
import { useLiveChanges } from "../lib/realtime"
import { currentProfile, supabase } from "../lib/supabase"

const WITHDRAW_THRESHOLD = 500 // CLAUDE.md rule 9

// Everything here is read with the user's own session; Row Level Security limits
// each query to their own rows (migrations 0002 + 0007).
async function loadDashboard(profile) {
  const isMaker = profile.role === "producer"
  const own = isMaker
    ? supabase.from("producers").select("name, site").single()
    : supabase.from("drivers").select("name").single()
  const [me, ledger, txns, withdrawals] = await Promise.all([
    own,
    supabase.from("wallet_ledger_entries").select("amount, status"),
    supabase
      .from("transactions")
      .select(
        "id, created_at, status, payment_method, total_amount, maker_amount, driver_amount, driver_id, maker_confirmed_at, driver_confirmed_at, confirmation_deadline",
      )
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("withdrawal_requests")
      .select("id, amount, status, requested_at, b2c_receipt, retry_of")
      .order("requested_at", { ascending: false })
      .limit(5),
  ])
  const failed = [me, ledger, txns, withdrawals].find((r) => r.error)
  if (failed) throw new Error("Couldn't load your account. Pull to refresh or log in again.")

  const sum = (status) =>
    ledger.data.filter((e) => e.status === status).reduce((total, e) => total + Number(e.amount), 0)
  return {
    name: me.data.name,
    site: me.data.site,
    available: sum("available"),
    pending: sum("pending"),
    frozen: sum("frozen"),
    transactions: txns.data,
    withdrawals: withdrawals.data,
  }
}

function needsMyConfirmation(row, role) {
  if (row.status !== "cash_unconfirmed") return false
  // Past the deadline the API refuses; the minute job marks it expired shortly.
  if (row.confirmation_deadline && new Date(row.confirmation_deadline) <= new Date()) return false
  if (role === "producer") return !row.maker_confirmed_at
  return row.driver_id && !row.driver_confirmed_at
}

function WithdrawPanel({ available, withdrawals, onWithdrawn }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const latest = withdrawals[0]
  const inFlight = latest && ["requested", "processing"].includes(latest.status)
  const waitingForCoordinator = latest && latest.status === "failed" && latest.retry_of
  const lastFailed = latest && latest.status === "failed" && !latest.retry_of
  const belowThreshold = available < WITHDRAW_THRESHOLD

  async function withdraw() {
    setBusy(true)
    setError(null)
    try {
      await api("/withdrawals/request", { method: "POST", auth: true })
      await onWithdrawn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  let label = `Withdraw ${ksh(available)}`
  if (belowThreshold) label = `Withdraw unlocks at ${ksh(WITHDRAW_THRESHOLD)} (you have ${ksh(available)})`
  if (inFlight) label = `Paying out ${ksh(latest.amount)}…`
  if (busy) label = "Starting your payout…"

  return (
    <div className="flex flex-col gap-2">
      <SecondaryButton
        className="w-full"
        onClick={withdraw}
        disabled={busy || belowThreshold || inFlight || waitingForCoordinator}
      >
        <Wallet aria-hidden="true" className="size-4 shrink-0" />
        {label}
      </SecondaryButton>
      <p className="text-[13px] text-sawa-text-muted">
        {waitingForCoordinator
          ? `Your ${ksh(latest.amount)} payout didn't go through after a retry. Your balance is safe; the coordinator will retry it.`
          : lastFailed
            ? `Your last payout didn't go through. Your balance stays available; withdraw again or ask the coordinator.`
            : "Withdrawals send your full available balance to M-Pesa. Anything left at 18:00 is sent automatically."}
      </p>
      <ErrorNote>{error}</ErrorNote>
    </div>
  )
}

export default function DashboardPage() {
  const [profile] = useState(currentProfile)
  const isMaker = profile.role === "producer"
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [confirmError, setConfirmError] = useState(null)

  const load = useCallback(async () => {
    try {
      setData(await loadDashboard(profile))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [profile])
  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])
  const live = useLiveChanges(`dashboard-${profile.producerId || profile.driverId}`, load)

  async function confirm(row) {
    setConfirming(row.id)
    setConfirmError(null)
    try {
      await api(`/transactions/${row.id}/confirm`, { method: "POST", auth: true, body: {} })
      await load()
    } catch (err) {
      setConfirmError(err.message)
    } finally {
      setConfirming(null)
    }
  }

  if (!data) {
    return <Screen>{error ? <ErrorNote>{error}</ErrorNote> : <p className="text-sm text-sawa-text-muted">Loading…</p>}</Screen>
  }

  const shareOf = (row) => (isMaker ? row.maker_amount : row.driver_amount)
  const referrals = data.transactions.filter((t) => ["confirmed", "cash_confirmed"].includes(t.status)).length

  return (
    <Screen className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{data.name}</h1>
          <p className="text-[13px] text-sawa-text-muted">{isMaker ? data.site || "Maker" : "Driver"}</p>
        </div>
        <LiveIndicator live={live} />
      </div>

      <section aria-label="Balance" className="flex flex-col gap-1">
        {!isMaker && (
          <p className="text-[15px]">
            <span className="font-mono text-2xl font-bold tabular-nums">{referrals}</span>{" "}
            <span className="text-sawa-text-muted">confirmed {referrals === 1 ? "referral" : "referrals"} (recent)</span>
          </p>
        )}
        <p className="text-[13px] text-sawa-text-muted">Available balance</p>
        <p className="font-mono text-[40px] font-bold leading-tight tabular-nums">{ksh(data.available)}</p>
        {(data.pending > 0 || data.frozen > 0) && (
          <p className="text-[13px] text-sawa-text-muted">
            {data.pending > 0 && <>Clearing: <span className="font-mono">{ksh(data.pending)}</span></>}
            {data.pending > 0 && data.frozen > 0 && " · "}
            {data.frozen > 0 && <>On hold during a dispute: <span className="font-mono">{ksh(data.frozen)}</span></>}
          </p>
        )}
      </section>

      <WithdrawPanel available={data.available} withdrawals={data.withdrawals} onWithdrawn={load} />

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-sawa-text-muted">
          {isMaker ? "Recent sales" : "Recent referrals"}
        </h2>
        <ErrorNote>{confirmError}</ErrorNote>
        <ul className="mt-2 divide-y divide-sawa-border border-y border-sawa-border">
          {data.transactions.length === 0 && <li className="py-3 text-sm text-sawa-text-muted">Nothing yet.</li>}
          {data.transactions.map((row) => (
            <li key={row.id} className="flex flex-col gap-2 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-mono text-[13px] tabular-nums text-sawa-text-muted">{eatDateTime(row.created_at)}</div>
                  <StatusBadge status={row.status} />
                </div>
                <div className="text-right">
                  <div className="font-mono text-[15px] font-semibold tabular-nums">{ksh(shareOf(row))}</div>
                  <div className="text-xs text-sawa-text-muted">of {ksh(row.total_amount)}</div>
                </div>
              </div>
              {needsMyConfirmation(row, profile.role) && (
                <SecondaryButton className="w-full" onClick={() => confirm(row)} disabled={confirming === row.id}>
                  <Check aria-hidden="true" className="size-4 shrink-0" />
                  {confirming === row.id ? "Confirming…" : `Confirm ${ksh(row.total_amount)} cash received`}
                </SecondaryButton>
              )}
            </li>
          ))}
        </ul>
      </section>

      {data.withdrawals.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-sawa-text-muted">Payouts</h2>
          <ul className="mt-2 divide-y divide-sawa-border border-y border-sawa-border">
            {data.withdrawals.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="font-mono text-[13px] tabular-nums text-sawa-text-muted">{eatDateTime(w.requested_at)}</div>
                  <StatusBadge status={w.status} />
                </div>
                <div className="text-right">
                  <div className="font-mono text-[15px] font-semibold tabular-nums">{ksh(w.amount)}</div>
                  {w.b2c_receipt && <div className="font-mono text-xs text-sawa-text-muted">{w.b2c_receipt}</div>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Screen>
  )
}
