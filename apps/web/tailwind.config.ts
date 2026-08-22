import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Design system Kontrolia (docs/design-system.md)
        bg: "#f7f7f5",
        surface: "#ffffff",
        surface2: "#f4f4f2",
        line: "#e7e5e4",
        line2: "#d6d3d1",
        cream: "#1c1917",
        muted: "#57534e",
        dim: "#a8a29e",
        amber: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          300: "#fcd34d",
          400: "#fbbf24",
          500: "#eab308",
          600: "#d97706",
          700: "#b45309",
        },
      },
      fontFamily: {
        display: [
          '"Plus Jakarta Sans"',
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        sans: [
          '"Plus Jakarta Sans"',
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 10px 35px -12px rgba(217, 119, 6, 0.35)",
        card: "0 1px 2px rgba(0,0,0,0.05), 0 8px 24px -12px rgba(0,0,0,0.12)",
      },
      backgroundImage: {
        "grid-faint":
          "linear-gradient(to right, rgba(217,119,6,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(217,119,6,0.08) 1px, transparent 1px)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.6s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
