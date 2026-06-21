/** @type {import('tailwindcss').Config} */
// Colors resolve through CSS variables (space-separated RGB triples) so the whole
// palette can be re-themed at runtime by swapping the variables. The default
// (`:root`) values in styles.css are byte-identical to the previous hard-coded
// dark hex, so the dark theme renders exactly as before; the `.light` class
// overrides the same variables for light mode.
const c = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ["./renderer/index.html", "./renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          900: c("--c-canvas-900"),
          800: c("--c-canvas-800"),
          700: c("--c-canvas-700"),
          600: c("--c-canvas-600"),
          500: c("--c-canvas-500"),
        },
        ink: {
          50: c("--c-ink-50"),
          100: c("--c-ink-100"),
          200: c("--c-ink-200"),
          300: c("--c-ink-300"),
          400: c("--c-ink-400"),
          500: c("--c-ink-500"),
        },
        accent: {
          400: c("--c-accent-400"),
          500: c("--c-accent-500"),
          600: c("--c-accent-600"),
        },
        ok: c("--c-ok"),
        warn: c("--c-warn"),
        bad: c("--c-bad"),
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        mono: ["JetBrains Mono", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.02) inset, 0 20px 40px -20px rgba(0,0,0,0.7)",
        ring: "0 0 0 1px rgba(255,255,255,0.06)",
      },
    },
  },
  plugins: [],
};
