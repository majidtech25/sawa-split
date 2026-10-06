// Matches the fixed example in docs/DEMO_SCRIPT.md — "Talek gate · beadwork".
export const demoTransaction = {
  site: "Talek gate · beadwork",
  total: 110,
  components: [
    {
      key: "product",
      label: "Product",
      amount: 100,
      breakdown: [
        { label: "Maker", amount: 70, highlight: true },
        { label: "Driver referral", amount: 30 },
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
