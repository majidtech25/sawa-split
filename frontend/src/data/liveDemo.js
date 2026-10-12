// The live demo (Render + the demo Supabase project). The price card is Wanjiru
// Beadwork, KSh 100 product + KSh 10 photo consent, referred by James (QR-DRIVER-001),
// signed by the live API (POST /admin/price-cards) with its CHECKOUT_LINK_SECRET, so it
// only checks out against that API. Absolute, so "See it work" opens the live system
// from any copy of the site. Regenerate it if the demo project or that secret changes.
export const LIVE_APP_URL = "https://sawa-split.onrender.com"
export const LIVE_DEMO_PRICE_CARD = `${LIVE_APP_URL}/#/pay/2cfa6cbd-4b61-4f71-a632-907f511be41f?product=100&photo=10&driver=QR-DRIVER-001&sig=906b04a97b5e2debdcb88fa8ff77b028151690632037b31eb30c6251b09799d7`
