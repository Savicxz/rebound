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
        slate: neutrals,
        stone: neutrals,
        background: "rgb(var(--page-bg) / <alpha-value>)",
        surface: "rgb(var(--surface-bg) / <alpha-value>)",
        card: "rgb(var(--surface-bg) / <alpha-value>)",
        border: "rgb(var(--neutral-200) / <alpha-value>)",
        primary: {
          DEFAULT: "#3157d5",
          hover: "#1d4ed8",
        },
        accent: "#38bdf8",
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ef4444",
      },
    },
  },
  plugins: [],
};
