// Matches the fixed example in docs/DEMO_SCRIPT.md — "Talek gate · beadwork".
export const demoTransaction = {
  site: "Talek gate · beadwork",
  total: 410,
  components: [
    {
      key: "product",
      label: "Product",
      amount: 380,
      breakdown: [
        { label: "Maker", amount: 266, highlight: true },
        { label: "Driver referral", amount: 114 },
      ],
    },
    {
      key: "photo",
      label: "Photo consent",
      amount: 30,
      breakdown: [{ label: "Maker — not split", amount: 30, highlight: true }],
    },
  ],
}
