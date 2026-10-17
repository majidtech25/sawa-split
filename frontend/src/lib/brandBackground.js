// The navy-to-teal background with a faint tile of the logo's bead colours: the homepage
// hero and /#/demo only (a deliberate exception to "no gradients", CLAUDE.md 7.1). Text
// on it sits over the navy end, white, well above 4.5:1; the lightest teal is never
// behind text.
const BEADS = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" fill-opacity="0.15">' +
    '<circle cx="8" cy="8" r="4" fill="#E4572E"/><circle cx="40" cy="8" r="4" fill="#FFB627"/>' +
    '<circle cx="24" cy="40" r="4" fill="#2E86DE"/><circle cx="56" cy="40" r="4" fill="#3BB273"/></svg>',
)

export const BRAND_BACKGROUND = {
  backgroundColor: "#1B2A41",
  backgroundImage: `url("data:image/svg+xml,${BEADS}"), linear-gradient(160deg, #1B2A41 0%, #1B2A41 38%, #1468A8 68%, #1FB5A8 100%)`,
}
