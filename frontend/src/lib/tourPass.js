// The tour pass (SCOPE_V2 MUST 3 and 17): the tourist's join to a guide's tour, saved on
// their own phone until midnight EAT, so every stall's checkout fills in the guide. It
// holds the join token the server issued when they joined (the server counts joins; a
// code alone earns the guide nothing). localStorage can be missing or throw (private
// mode, blocked storage); then there's simply no pass and the tourist can still type the
// code at checkout, which joins the tour there.

const KEY = "sawa.tourPass"

// The next midnight in Nairobi (UTC+3, no daylight saving), as a timestamp.
function nextMidnightEAT(now = Date.now()) {
  const eat = new Date(now + 3 * 3600 * 1000)
  const midnightUtc = Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate() + 1)
  return midnightUtc - 3 * 3600 * 1000
}

// Whether this browser can keep a pass at all, checked before joining a tour so a join
// (which takes a seat) is never wasted on a phone that can't remember it.
export function canSaveTourPass() {
  try {
    localStorage.setItem(`${KEY}.probe`, "1")
    localStorage.removeItem(`${KEY}.probe`)
    return true
  } catch {
    return false
  }
}

export function saveTourPass(code, firstName, joinToken) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, firstName, joinToken, until: nextMidnightEAT() }))
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
