/** @type {import('tailwindcss').Config} */
const neutrals = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((shade) => [
    shade,
    `rgb(var(--neutral-${shade}) / <alpha-value>)`,
  ]),
);
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        white: "rgb(var(--surface-bg) / <alpha-value>)",
        slate: neutrals,
        stone: neutrals,
        background: "rgb(var(--page-bg) / <alpha-value>)",
        surface: "rgb(var(--surface-bg) / <alpha-value>)",
        card: "rgb(var(--surface-bg) / <alpha-value>)",
        border: "rgb(var(--neutral-200) / <alpha-value>)",
        primary: {
          DEFAULT: "rgb(var(--action-bg) / <alpha-value>)",
          hover: "rgb(var(--action-hover) / <alpha-value>)",
        },
        "on-primary": "rgb(var(--action-fg) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
