import { useState } from "react"
import ConfirmDialog from "../components/ConfirmDialog"
import { api } from "../lib/api"
import { eatDateTime, ksh } from "../lib/format"
import ReconciliationPage from "./ReconciliationPage"

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sawa-green"

function RowAction({ children, onClick }) {
  return (
    <button type="button" onClick={onClick} className={`whitespace-nowrap text-sm text-sawa-green underline-offset-2 hover:underline ${focusRing}`}>
      {children}
    </button>
  )
}

export default function CoordinatorPage() {
  const [action, setAction] = useState(null) // { kind, row, reload }
  const close = () => setAction(null)

  const transactionAction = (row, reload) => {
    if (["confirmed", "cash_confirmed"].includes(row.status))
      return <RowAction onClick={() => setAction({ kind: "dispute", row, reload })}>Flag dispute</RowAction>
    if (row.status === "disputed")
      return <RowAction onClick={() => setAction({ kind: "resolve", row, reload })}>Clear dispute</RowAction>
    return null
  }
  const withdrawalAction = (w, reload) =>
    w.status === "failed" ? <RowAction onClick={() => setAction({ kind: "retry", row: w, reload })}>Retry payout</RowAction> : null

  const row = action?.row
  const describe = row && action.kind !== "retry" ? `${row.producer_name}, ${ksh(row.total_amount)}, ${eatDateTime(row.created_at)}` : null

  return (
    <>
      <ReconciliationPage renderTransactionAction={transactionAction} renderWithdrawalAction={withdrawalAction} />

      <ConfirmDialog
        open={action?.kind === "dispute"}
        title="Flag this sale as disputed?"
        confirmLabel="Flag dispute"
        onClose={close}
        onConfirm={async () => {
          await api(`/admin/transactions/${row.id}/dispute`, { method: "POST", auth: true })
          await action.reload()
        }}
      >
        <p>{describe}</p>
        <p className="mt-2">
          The creator's and site intermediary's unpaid shares from this sale are put on hold. They can't be withdrawn or swept until
          you clear the dispute. Anything already paid out stays paid.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={action?.kind === "resolve"}
        title="Clear this dispute?"
        confirmLabel="Clear dispute"
        onClose={close}
        onConfirm={async () => {
          await api(`/admin/transactions/${row.id}/resolve`, { method: "POST", auth: true })
          await action.reload()
        }}
      >
        <p>{describe}</p>
        <p className="mt-2">The held shares go back to the creator's and site intermediary's available balances.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={action?.kind === "retry"}
        title="Retry this payout?"
        confirmLabel="Retry payout"
        onClose={close}
        onConfirm={async () => {
          await api(`/admin/withdrawals/${row.id}/retry`, { method: "POST", auth: true })
          await action.reload()
        }}
      >
        {row && action.kind === "retry" && (
          <p>
            Sends {ksh(row.amount)} to {row.recipient_name} by M-Pesa again, if that much is still in their available balance.
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}
