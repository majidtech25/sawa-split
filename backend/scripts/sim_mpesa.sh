# Shared by the verify_* scripts (source it after defining q, json and BASE_URL).
# A simulated M-Pesa sale, with no STK Push and no money: scripts/simulate_mpesa_sale.py
# creates it exactly as POST /transactions/initiate would, then a simulated Daraja
# callback goes to the real endpoint at the sale's own signed URL, with the Amount
# Daraja would report (app/verification.py refuses anything else).

# stk_callback <callback_token> <checkout_request_id> <amount> <receipt> [result_code]
stk_callback() {
  curl -s -m 60 -X POST "$BASE_URL/daraja/stk-callback/$1" -H "Content-Type: application/json" -d "{
    \"Body\": {\"stkCallback\": {\"CheckoutRequestID\": \"$2\", \"ResultCode\": ${5:-0}, \"CallbackMetadata\": {\"Item\": [
      {\"Name\": \"Amount\", \"Value\": $3}, {\"Name\": \"MpesaReceiptNumber\", \"Value\": \"$4\"}]}}}}"
}

# mpesa_sale <producer_id> <product|-> <photo|-> [driver_id] -> prints the transaction id.
# Retries a step that fails outright (this dev network's pooler stalls now and then)
# and stops the run if the sale still can't be made, rather than testing without it.
mpesa_sale() {
  local sale="" id="" i
  for i in 1 2 3; do
    sale=$(PYTHONPATH=. .venv/bin/python scripts/simulate_mpesa_sale.py "$@" 2>/dev/null)
    id=$(echo "$sale" | json "['id']")
    [ -n "$id" ] && break
  done
  [ -n "$id" ] || { echo "FATAL: could not create a simulated M-Pesa sale" >&2; exit 1; }
  for i in 1 2 3; do
    stk_callback "$(echo "$sale" | json "['callback_token']")" "$(echo "$sale" | json "['checkout_request_id']")" \
      "$(python3 -c "import sys; print(int(float(sys.argv[1])))" "$(echo "$sale" | json "['total_amount']")")" "SIM${id:0:8}" >/dev/null
    [ "$(q "select status from transactions where id = '$id';")" = "confirmed" ] && break
  done
  echo "$id"
}

# callback_token <transaction_id>: the signed callback token, as the API computes it.
callback_token() { PYTHONPATH=. .venv/bin/python -c "import sys; from app import links; print(links.callback_token(sys.argv[1]))" "$1"; }
