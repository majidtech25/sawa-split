import { useCallback, useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import ConfirmDialog from "../components/ConfirmDialog"
import { ErrorNote, TextArea } from "../components/ui"
import { api } from "../lib/api"
import { eatDate, eatDateTime, ksh } from "../lib/format"

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

const STATUS_LABEL = { active: "Active", suspended: "Suspended", closing: "Closing", closed: "Closed" }
const ACTION_LABEL = {
  closure_requested: "Closure requested",
  closure_cancelled: "Closure request cancelled",
  closure_approved: "Closure approved",
  closure_rejected: "Closure rejected",
  account_closed: "Account closed",
  suspended: "Suspended",
  unsuspended: "Unsuspended",
  login_locked: "Login locked",
  login_unlocked: "Login unlocked",
}
const TYPE_LABEL = { maker: "Maker", driver: "Driver", coordinator: "Coordinator", unknown: "Unregistered phone", ip: "One IP address" }

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
      className={`border-b border-sawa-border px-3 py-2.5 align-top text-sm ${right ? "text-right" : ""} ${mono ? "whitespace-nowrap font-mono tabular-nums" : ""} ${className}`}
    >
      {children}
    </td>
  )
}

function RowAction({ children, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`whitespace-nowrap text-sm text-sawa-green underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-sawa-text-muted disabled:no-underline ${focusRing}`}
    >
      {children}
    </button>
  )
}

const plusDays = (days) => {
  const d = new Date(Date.now() + days * 86400000)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(d) // YYYY-MM-DD
}

// Coordinator: closure requests, suspensions and the audit log (CLAUDE.md rule 17).
export default function AccountsPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [action, setAction] = useState(null) // { kind, row }
  const [reason, setReason] = useState("")
  const [reviewOn, setReviewOn] = useState(plusDays(7))
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    try {
      setData(await api("/admin/accounts", { auth: true }))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])
  useEffect(() => {
    const first = setTimeout(load, 0)
    return () => clearTimeout(first)
  }, [load])

  function start(kind, row) {
    setReason("")
    setReviewOn(plusDays(7))
    setNotice(null)
    setAction({ kind, row })
  }
  const close = () => setAction(null)
  const row = action?.row
  const needReason = (what) => {
    if (!reason.trim()) throw new Error(`Give a reason for ${what}.`)
    return reason.trim()
  }

  if (!data) {
    return (
      <main className="mx-auto w-full max-w-[420px] px-4 py-8 md:max-w-6xl md:px-8">
        {error ? <ErrorNote>{error}</ErrorNote> : <p className="text-sm text-sawa-text-muted">Loading…</p>}
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-[420px] px-4 py-8 md:max-w-6xl md:px-8">
      <h1 className="text-2xl font-semibold">Accounts</h1>
      <p className="mt-1 text-[15px] text-sawa-text-muted">
        Closures and suspensions. Accounts are never deleted: their sales and payouts stay on record.
      </p>
      <div className="mt-4 flex flex-col gap-2">
        <ErrorNote>{error}</ErrorNote>
        {notice && <p className="text-sm text-sawa-green">{notice}</p>}
        {data.overdue_reviews > 0 && (
          <p className="text-sm font-semibold">
            {data.overdue_reviews} suspension {data.overdue_reviews === 1 ? "review is" : "reviews are"} overdue.
          </p>
        )}
      </div>

      {data.lockouts.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Login lockouts</h2>
          <p className="mt-1 text-sm text-sawa-text-muted">
            Locked after 5 wrong PINs for one phone, or 20 from one network, within 15 minutes. Each lifts by itself
            after 15 minutes; Unlock lifts it now.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {data.lockouts.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 rounded-sawa border border-sawa-border bg-sawa-surface p-3 text-sm">
                <span>
                  {l.kind === "phone" ? (
                    <>
                      {l.name || "Unregistered phone"} <span className="font-mono text-sawa-text-muted">+{l.key}</span>
                    </>
                  ) : (
                    <>
                      Network <span className="font-mono text-sawa-text-muted">{l.key}</span>
                    </>
                  )}
                  <span className="block text-xs text-sawa-text-muted">Locked until {eatDateTime(l.locked_until)}</span>
                </span>
                <RowAction onClick={() => start("unlock", l)}>Unlock</RowAction>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Closure requests</h2>
        {data.closure_requests.length === 0 ? (
          <p className="mt-2 text-sm text-sawa-text-muted">No open requests.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {data.closure_requests.map((c) => (
              <li key={c.id} className="rounded-sawa border border-sawa-border bg-sawa-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">
                    {c.name} <span className="font-normal text-sawa-text-muted">({TYPE_LABEL[c.party_type]})</span>
                  </p>
                  <p className="font-mono text-[13px] tabular-nums text-sawa-text-muted">{eatDateTime(c.requested_at)}</p>
                </div>
                <p className="mt-1 text-sm">Reason: {c.reason}</p>
                {c.status === "approved" ? (
                  <p className="mt-2 text-sm text-sawa-text-muted">
                    Approved. The final payout is in progress; the account closes when it's paid. A failed payout is
                    retried from Reconciliation.
                  </p>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-sawa-text-muted">
                      Final payout on approval: <span className="font-mono text-sawa-text">{ksh(c.payable)}</span>
                    </p>
                    {c.blockers.length > 0 && (
                      <div className="mt-2 text-sm">
                        <p className="flex items-center gap-1.5 font-semibold">
                          <AlertTriangle aria-hidden="true" className="size-4 shrink-0" /> Can't approve yet:
                        </p>
                        <ul className="mt-1 list-disc pl-6 text-sawa-text-muted">
                          {c.blockers.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="mt-3 flex gap-5">
                      <RowAction onClick={() => start("approve", c)} disabled={c.blockers.length > 0}>
                        Approve
                      </RowAction>
                      <RowAction onClick={() => start("reject", c)}>Reject</RowAction>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Makers and drivers</h2>
        <div className="relative mt-3 overflow-x-auto rounded-sawa border border-sawa-border bg-sawa-surface">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th right>Payable</Th>
                <Th>
                  <span className="sr-only">Action</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((a) => (
                <tr key={`${a.party_type}-${a.id}`} className={a.suspension?.overdue ? "bg-sawa-bg" : ""}>
                  <Td>{a.name}</Td>
                  <Td>{TYPE_LABEL[a.party_type]}</Td>
                  <Td>
                    <span className={a.account_status === "active" ? "" : "font-semibold"}>{STATUS_LABEL[a.account_status]}</span>
                    {a.suspension && (
                      <div className="mt-0.5 text-xs text-sawa-text-muted">
                        {a.suspension.reason}
                        <br />
                        <span className={a.suspension.overdue ? "font-semibold text-sawa-text" : ""}>
                          {a.suspension.overdue ? "Review overdue: was due " : "Review by "}
                          {eatDate(a.suspension.review_on)}
                        </span>
                      </div>
                    )}
                  </Td>
                  <Td right mono>{ksh(a.payable)}</Td>
                  <Td right>
                    {a.account_status === "active" && <RowAction onClick={() => start("suspend", a)}>Suspend</RowAction>}
                    {a.account_status === "suspended" && <RowAction onClick={() => start("unsuspend", a)}>Unsuspend</RowAction>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Audit log</h2>
        <p className="mt-1 text-sm text-sawa-text-muted">Every request and decision, as it happened. Entries can't be edited or deleted.</p>
        <div className="relative mt-3 overflow-x-auto rounded-sawa border border-sawa-border bg-sawa-surface">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <Th>When (EAT)</Th>
                <Th>What</Th>
                <Th>Account</Th>
                <Th>By</Th>
                <Th>Why</Th>
              </tr>
            </thead>
            <tbody>
              {data.audit.length === 0 && (
                <tr>
                  <Td colSpan={5} className="text-sawa-text-muted">Nothing yet.</Td>
                </tr>
              )}
              {data.audit.map((e) => (
                <tr key={e.id}>
                  <Td mono>{eatDateTime(e.at)}</Td>
                  <Td className="whitespace-nowrap">{ACTION_LABEL[e.action] || e.action}</Td>
                  <Td>
                    {e.party_name ? (
                      <>
                        {e.party_name} <span className="text-sawa-text-muted">({TYPE_LABEL[e.party_type]})</span>
                      </>
                    ) : (
                      <span className="text-sawa-text-muted">{TYPE_LABEL[e.party_type] || e.party_type}</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {e.actor_role === "system" ? "Automatic" : e.actor_role === "coordinator" ? "Coordinator" : TYPE_LABEL[e.actor_role]}
                    {e.actor_phone && <div className="font-mono text-xs text-sawa-text-muted">{e.actor_phone}</div>}
                  </Td>
                  <Td className="text-sawa-text-muted">{e.reason || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ConfirmDialog
        open={action?.kind === "approve"}
        title={`Close ${row?.name}'s account?`}
        confirmLabel="Approve and pay out"
        onClose={close}
        onConfirm={async () => {
          const result = await api(`/admin/closure-requests/${row.id}/approve`, { method: "POST", auth: true, body: {} })
          setNotice(
            result.status === "closed"
              ? `${row.name}'s account is closed. There was nothing left to pay.`
              : `Approved. ${ksh(result.payout.amount)} is being paid to ${row.name}; the account closes when it's paid.`,
          )
          await load()
        }}
      >
        {row && action.kind === "approve" && (
          <p>
            They stop taking sales now. {ksh(row.payable)} is paid to their M-Pesa, even below KSh 500, and the account
            closes once it's paid. If the payout fails, it stays open and is retried as usual. Their history is kept.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={action?.kind === "reject"}
        title={`Reject ${row?.name}'s request?`}
        confirmLabel="Reject request"
        onClose={close}
        onConfirm={async () => {
          await api(`/admin/closure-requests/${row.id}/reject`, { method: "POST", auth: true, body: { reason: needReason("rejecting") } })
          await load()
        }}
      >
        <div className="mt-2 text-sawa-text">
          <TextArea id="reject-reason" label="Reason (they'll see it)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={action?.kind === "suspend"}
        title={`Suspend ${row?.name}?`}
        confirmLabel="Suspend"
        onClose={close}
        onConfirm={async () => {
          await api(`/admin/accounts/${row.party_type}/${row.id}/suspend`, {
            method: "POST",
            auth: true,
            body: { reason: needReason("the suspension"), review_on: reviewOn },
          })
          await load()
        }}
      >
        <p>
          They can't log in or take new sales. Money they've already earned is still paid out by the usual rules; only
          disputed sales stay on hold.
        </p>
        <div className="mt-3 flex flex-col gap-3 text-sawa-text">
          <TextArea id="suspend-reason" label="Reason (they'll see it when they log in)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="suspend-review" className="text-[13px] text-sawa-text-muted">
              Review by
            </label>
            <input
              id="suspend-review"
              type="date"
              value={reviewOn}
              min={plusDays(0)}
              onChange={(e) => setReviewOn(e.target.value)}
              className="rounded-sawa border border-sawa-border bg-sawa-surface px-3 py-2.5 font-mono text-[15px] outline-none focus:border-2 focus:border-sawa-green"
            />
          </div>
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={action?.kind === "unlock"}
        title="Unlock this login?"
        confirmLabel="Unlock"
        onClose={close}
        onConfirm={async () => {
          await api(`/admin/login-lockouts/${row.id}/clear`, { method: "POST", auth: true, body: { reason: reason.trim() || null } })
          setNotice(row.kind === "phone" ? `${row.name || "That phone"} can log in again.` : "That network can log in again.")
          await load()
        }}
      >
        <p>Its wrong-PIN count is cleared too, so the next correct PIN logs straight in. This is recorded in the audit log.</p>
        <div className="mt-3 text-sawa-text">
          <TextArea id="unlock-reason" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={action?.kind === "unsuspend"}
        title={`Lift ${row?.name}'s suspension?`}
        confirmLabel="Unsuspend"
        onClose={close}
        onConfirm={async () => {
          await api(`/admin/accounts/${row.party_type}/${row.id}/unsuspend`, {
            method: "POST",
            auth: true,
            body: { reason: needReason("lifting the suspension") },
          })
          await load()
        }}
      >
        <div className="mt-2 text-sawa-text">
          <TextArea id="unsuspend-reason" label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </div>
      </ConfirmDialog>
    </main>
  )
}
