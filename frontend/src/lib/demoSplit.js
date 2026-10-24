// The fixed split (CLAUDE.md rule 4, migration 0020), the same rule as the server's
// backend/app/sales.py, for the /#/demo walkthrough only. Of the price: the site
// intermediary gets floor(15%), the Conservation & sustainability fund floor(5%), the
// creator the rest; no intermediary on the sale -> creator 95%, fund floor(5%). The photo
// fee goes to the creator in full, never split. Whole shillings; the parts always add up.
export const INTERMEDIARY_PCT = 15
export const FUND_PCT = 5

export function split({ price, photoFee = 0, withIntermediary }) {
  const intermediary = withIntermediary ? Math.floor((price * INTERMEDIARY_PCT) / 100) : 0
  const fund = Math.floor((price * FUND_PCT) / 100)
  const creatorProduct = price - intermediary - fund
  return { price, photoFee, intermediary, fund, creatorProduct, creator: creatorProduct + photoFee, total: price + photoFee }
}
