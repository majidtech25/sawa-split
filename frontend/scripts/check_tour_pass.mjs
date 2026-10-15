// Checks src/lib/tourPass.js with a stand-in localStorage (SCOPE_V2 MUST 3, 16, 17):
// a saved pass reads back with its join token, "No, I'm done" (clearTourPass) really
// removes it, and a browser without storage simply has no pass. Prints "ok" or the
// first failure. Run from anywhere: node frontend/scripts/check_tour_pass.mjs

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { canSaveTourPass, clearTourPass, readTourPass, saveTourPass } = await import("../src/lib/tourPass.js")

function expect(what, ok) {
  if (!ok) {
    console.log(`FAIL: ${what}`)
    process.exit(1)
  }
}

expect("no pass to begin with", readTourPass() === null)
expect("storage works", canSaveTourPass())
expect("the probe leaves nothing behind", store.size === 0)
expect("saves", saveTourPass("JAMES", "James", "tok-123"))
const pass = readTourPass()
expect("reads back code, name and join token", pass?.code === "JAMES" && pass.firstName === "James" && pass.joinToken === "tok-123")
expect("lasts until a midnight within the next day", pass.until > Date.now() && pass.until <= Date.now() + 24 * 3600 * 1000)
clearTourPass()
expect("\"No, I'm done\" clears it", readTourPass() === null && store.size === 0)

saveTourPass("JAMES", "James", "tok-123")
store.set("sawa.tourPass", JSON.stringify({ ...JSON.parse(store.get("sawa.tourPass")), until: Date.now() - 1 }))
expect("an expired pass (past midnight) is dropped", readTourPass() === null && store.size === 0)

globalThis.localStorage = {
  getItem: () => {
    throw new Error("blocked")
  },
  setItem: () => {
    throw new Error("blocked")
  },
  removeItem: () => {
    throw new Error("blocked")
  },
}
expect("blocked storage: can't save, and says so", !canSaveTourPass() && !saveTourPass("JAMES", "James", "t"))
expect("blocked storage: no pass, no crash", readTourPass() === null)
clearTourPass()

console.log("ok")
