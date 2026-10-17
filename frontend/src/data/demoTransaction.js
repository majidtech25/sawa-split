// Matches the fixed example in docs/DEMO_SCRIPT.md — "Talek gate · beadwork": Wanjiru's
// KSh 100 product with James as guide (30%), plus KSh 10 photo consent.
export const demoTransaction = {
  site: "Talek gate · Wanjiru Beadwork",
  total: 110,
  components: [
    {
      key: "product",
      label: "Product",
      amount: 100,
      breakdown: [
        { label: "Maker · Wanjiru", amount: 70, highlight: true },
        { label: "Guide · James", amount: 30 },
      ],
    },
    {
      key: "photo",
      label: "Photo consent",
      amount: 10,
      breakdown: [{ label: "Maker — not split", amount: 10, highlight: true }],
    },
  ],
}
