// Amounts come from the API as decimal strings ("70.00"). M-Pesa moves whole
// shillings, so cents only show when there actually are some.
export function ksh(value) {
  const n = Number(value ?? 0)
  const whole = Number.isInteger(n)
  return `KSh ${n.toLocaleString("en-KE", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

const timeFormat = new Intl.DateTimeFormat("en-KE", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Africa/Nairobi",
})
const dateFormat = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  timeZone: "Africa/Nairobi",
})

export const eatTime = (iso) => timeFormat.format(new Date(iso))
export const eatDate = (iso) => dateFormat.format(new Date(iso))
export const eatDateTime = (iso) => `${eatDate(iso)}, ${eatTime(iso)}`
