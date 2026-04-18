/** @type {import('tailwindcss').Config} */
export default {
  content: ["./renderer/index.html", "./renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          900: "#07090e",
          800: "#0b0d12",
          700: "#11141b",
          600: "#161924",
          500: "#1f2431",
        },
        ink: {
          50: "#f4f6fb",
          100: "#e5e9f2",
          200: "#c9cfdd",
          300: "#9aa3b7",
          400: "#6e7689",
          500: "#4e5566",
        },
        accent: {
          400: "#7ab6ff",
          500: "#4a8ffd",
          600: "#2f6fe3",
        },
        ok: "#22c38a",
        warn: "#f6b44d",
        bad: "#ef5f6b",
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
