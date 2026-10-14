// The tour pass (SCOPE_V2 MUST 3): a guide's referral code saved on the tourist's own
// phone until midnight EAT, so every stall's checkout fills it in. localStorage can be
// missing or throw (private mode, blocked storage); then there's simply no pass and the
// tourist can still type the code at checkout.

const KEY = "sawa.tourPass"

// The next midnight in Nairobi (UTC+3, no daylight saving), as a timestamp.
function nextMidnightEAT(now = Date.now()) {
  const eat = new Date(now + 3 * 3600 * 1000)
  const midnightUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate() + 1)
  return midnightUtc - 3 * 3600 * 1000
}

export function saveTourPass(code, firstName) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, firstName, until: nextMidnightEAT() }))
    return true
  } catch {
    return false
  }
}

export function readTourPass() {
  try {
    const pass = JSON.parse(localStorage.getItem(KEY))
    if (pass && pass.code && pass.until > Date.now()) return pass
    localStorage.removeItem(KEY)
  } catch {
    // no storage: no pass
  }
  return null
}

export function clearTourPass() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}
