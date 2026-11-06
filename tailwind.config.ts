import type { Config } from "tailwindcss";

// `<alpha-value>` lets opacity modifiers like bg-accent/10 work with the CSS variable tokens.
const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        muted: token("muted"),
        border: token("border"),
        fg: token("fg"),
        subtle: token("subtle"),
        accent: token("accent"),
        "accent-fg": token("accent-fg"),
        "accent-muted": token("accent-muted"),
        good: token("good"),
        "good-muted": token("good-muted"),
        warn: token("warn"),
        "warn-muted": token("warn-muted"),
        bad: token("bad"),
        "bad-muted": token("bad-muted"),
        hl: token("hl"),
        brand: token("brand"),
        "on-fill": token("on-fill"),
        "good-on": token("good-on"), "warn-on": token("warn-on"), "bad-on": token("bad-on"),
        "p-mint": token("p-mint"), "p-mint-fg": token("p-mint-fg"),
        "p-butter": token("p-butter"), "p-butter-fg": token("p-butter-fg"),
        "p-sky": token("p-sky"), "p-sky-fg": token("p-sky-fg"),
        "p-rose": token("p-rose"), "p-rose-fg": token("p-rose-fg"),
      },
      // Fills are pastel, text is the deeper shade of the same hue: bg-accent is the pastel blue fill while
      // text-accent / border-accent / ring-accent stay readable. Same for good, warn and bad.
      backgroundColor: {
        accent: token("accent-fill"),
        good: token("good-fill"),
        warn: token("warn-fill"),
        bad: token("bad-fill"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: { xl: "0.9rem" },
    },
  },
  plugins: [],
};
export default config;
