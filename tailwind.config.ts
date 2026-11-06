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
        "p-mint": token("p-mint"), "p-mint-fg": token("p-mint-fg"),
        "p-butter": token("p-butter"), "p-butter-fg": token("p-butter-fg"),
        "p-sky": token("p-sky"), "p-sky-fg": token("p-sky-fg"),
        "p-lavender": token("p-lavender"), "p-lavender-fg": token("p-lavender-fg"),
        "p-peach": token("p-peach"), "p-peach-fg": token("p-peach-fg"),
        "p-rose": token("p-rose"), "p-rose-fg": token("p-rose-fg"),
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
