import type { Config } from "tailwindcss";

/**
 * School Enrichment design tokens -- "Ink & Amber".
 *
 * Phase 1 shipped framework-default styling on purpose; this file is the
 * deliberate design system that replaces it. The identity is intentionally
 * unlike typical SaaS-blue edtech: a deep indigo "scholar's ink" primary,
 * a warm saffron/amber accent for energy and calls to action, jade for
 * positive/success states, coral for problems, all sitting on warm paper
 * neutrals rather than cold grey.
 *
 * Rules of use:
 *  - Reach for the semantic roles (surface/content/line) for chrome and
 *    text, and the named scales (brand/saffron/jade/coral) for expressive
 *    moments. Avoid raw hex in components.
 *  - Contrast targets: content.DEFAULT and content.muted both clear WCAG AA
 *    on surface.DEFAULT and surface.muted; saffron is used as a *surface*
 *    or with ink text, never as small text on white.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Primary -- deep indigo "ink". 700/900 are the brand anchors.
        brand: {
          50: "#F3F2FC",
          100: "#E7E5F8",
          200: "#CFCBF0",
          300: "#ADA5E4",
          400: "#8579D2",
          500: "#6355BC",
          600: "#4E42A0",
          700: "#3C3489",
          800: "#2E2870",
          900: "#26215C",
          950: "#171338",
        },
        // Accent -- warm saffron/amber. Energy, progress, primary CTAs.
        saffron: {
          50: "#FFF9EC",
          100: "#FEEFCB",
          200: "#FDDC92",
          300: "#FBC559",
          400: "#F9AB2B",
          500: "#F08D0C",
          600: "#D06B06",
          700: "#A84C0A",
          800: "#883C10",
          900: "#70320F",
        },
        // Support -- jade. Mastery, completion, "all good" states.
        jade: {
          50: "#EBFBF3",
          100: "#CFF5E2",
          200: "#A1E9C7",
          300: "#68D5A8",
          400: "#37BB8C",
          500: "#169D74",
          600: "#0A7D5C",
          700: "#08634A",
          800: "#094F3D",
          900: "#093F33",
        },
        // Support -- coral. Errors, overdue, destructive.
        coral: {
          50: "#FFF4F1",
          100: "#FFE3DB",
          200: "#FFC6B6",
          300: "#FFA087",
          400: "#F87557",
          500: "#E55130",
          600: "#C43C1F",
          700: "#9E301A",
          800: "#7F2A19",
          900: "#682518",
        },
        // Neutral -- violet-tinted ink greys for text and dark chrome.
        ink: {
          50: "#F7F7FA",
          100: "#EFEFF4",
          200: "#E2E1EB",
          300: "#CAC8D8",
          400: "#9E9CB2",
          500: "#75738C",
          600: "#57556D",
          700: "#434157",
          800: "#2D2C3D",
          900: "#1C1B29",
          950: "#111019",
        },
        // Neutral -- warm paper for surfaces and page canvas.
        paper: {
          50: "#FFFFFF",
          100: "#FDFCFA",
          200: "#FAF8F4",
          300: "#F4F1EA",
          400: "#EBE7DD",
          500: "#DED9CC",
        },

        // ---- Semantic roles (prefer these in components) ----
        canvas: {
          DEFAULT: "#FAF8F4",
          deep: "#F4F1EA",
          dark: "#1C1B29",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          muted: "#FAF8F4",
          sunken: "#F4F1EA",
          brand: "#F3F2FC",
          accent: "#FFF9EC",
          inverse: "#26215C",
        },
        line: {
          DEFAULT: "#E8E4DB",
          strong: "#D7D2C6",
          brand: "#CFCBF0",
          inverse: "rgba(255,255,255,0.14)",
        },
        // Text ramp. Every step below is measured against surface.DEFAULT
        // (#FFFFFF): muted 8.6:1, subtle 6.4:1, faint 4.6:1. `faint` is the
        // floor -- it is the placeholder/decorative-icon step and still
        // clears WCAG AA for body text, because "quiet" must never mean
        // "unreadable on a classroom projector or a cheap school laptop".
        content: {
          DEFAULT: "#1C1B29",
          muted: "#4B4962",
          subtle: "#5E5C77",
          faint: "#74728D",
          brand: "#3C3489",
          inverse: "#FFFFFF",
          "inverse-muted": "rgba(255,255,255,0.78)",
        },
      },

      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        display: ["var(--font-display)", "Iowan Old Style", "Georgia", "serif"],
      },

      fontSize: {
        // Editorial display scale for hero moments and page titles.
        "display-2xl": ["4.25rem", { lineHeight: "1.02", letterSpacing: "-0.032em" }],
        "display-xl": ["3.25rem", { lineHeight: "1.05", letterSpacing: "-0.028em" }],
        "display-lg": ["2.5rem", { lineHeight: "1.1", letterSpacing: "-0.024em" }],
        "display-md": ["2rem", { lineHeight: "1.15", letterSpacing: "-0.02em" }],
        "display-sm": ["1.5rem", { lineHeight: "1.25", letterSpacing: "-0.015em" }],
        // Small, wide labels for eyebrows and chips.
        eyebrow: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.14em" }],
      },

      letterSpacing: {
        eyebrow: "0.14em",
      },

      spacing: {
        18: "4.5rem",
        22: "5.5rem",
        30: "7.5rem",
        "sidebar": "17.5rem",
      },

      maxWidth: {
        shell: "84rem",
        prose: "68ch",
      },

      borderRadius: {
        xs: "0.25rem",
        "4xl": "2rem",
        "5xl": "2.75rem",
      },

      boxShadow: {
        xs: "0 1px 2px rgba(28,27,41,0.06)",
        card: "0 1px 2px rgba(28,27,41,0.04), 0 10px 30px -18px rgba(28,27,41,0.35)",
        "card-hover": "0 2px 4px rgba(28,27,41,0.05), 0 22px 44px -20px rgba(38,33,92,0.38)",
        panel: "0 1px 2px rgba(28,27,41,0.05), 0 30px 60px -30px rgba(28,27,41,0.45)",
        brand: "0 12px 30px -14px rgba(60,52,137,0.75)",
        accent: "0 12px 28px -14px rgba(208,107,6,0.7)",
        focus: "0 0 0 4px rgba(99,85,188,0.24)",
        "focus-accent": "0 0 0 4px rgba(249,171,43,0.32)",
        // Input focus: a ring *and* a cast shadow, so a focused field reads
        // as physically lifted off the card rather than just re-bordered.
        "focus-field": "0 0 0 4px rgba(99,85,188,0.18), 0 14px 28px -16px rgba(60,52,137,0.85)",
        hairline: "inset 0 1px 0 rgba(255,255,255,0.55)",
      },

      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #3C3489 0%, #26215C 55%, #171338 100%)",
        "brand-sheen": "linear-gradient(140deg, #6355BC 0%, #3C3489 45%, #26215C 100%)",
        "accent-gradient": "linear-gradient(135deg, #FBC559 0%, #F08D0C 60%, #D06B06 100%)",
        "jade-gradient": "linear-gradient(135deg, #37BB8C 0%, #0A7D5C 100%)",
        "canvas-glow":
          "radial-gradient(1100px 520px at 8% -10%, rgba(99,85,188,0.13), transparent 62%), radial-gradient(820px 460px at 96% 4%, rgba(249,171,43,0.16), transparent 60%), radial-gradient(900px 620px at 60% 108%, rgba(23,155,116,0.10), transparent 62%)",
      },

      transitionTimingFunction: {
        spring: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
      },

      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-12px)" },
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "50%": { transform: "translate3d(18px,-22px,0) scale(1.06)" },
        },
        // Three drift paths of different shapes, run at co-prime-ish
        // durations (23s/31s/43s/53s). The composite never visibly repeats,
        // which is the difference between "atmosphere" and "template
        // animation on a 6-second loop".
        "drift-alt": {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1)" },
          "30%": { transform: "translate3d(-28px,20px,0) scale(1.09)" },
          "65%": { transform: "translate3d(16px,30px,0) scale(0.94)" },
        },
        "drift-wide": {
          "0%, 100%": { transform: "translate3d(0,0,0) scale(1.02)" },
          "25%": { transform: "translate3d(36px,14px,0) scale(0.93)" },
          "55%": { transform: "translate3d(8px,-34px,0) scale(1.12)" },
          "80%": { transform: "translate3d(-26px,-10px,0) scale(0.99)" },
        },
        "aurora-breathe": {
          "0%, 100%": { opacity: "0.55" },
          "50%": { opacity: "1" },
        },
        // Light sweeping across a button while it works.
        sweep: {
          from: { transform: "translateX(-140%)" },
          to: { transform: "translateX(360%)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "spin-slow": {
          to: { transform: "rotate(360deg)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.65" },
          "70%": { transform: "scale(1.5)", opacity: "0" },
          "100%": { transform: "scale(1.5)", opacity: "0" },
        },
        "dash-draw": {
          from: { strokeDashoffset: "620" },
          to: { strokeDashoffset: "0" },
        },
      },

      animation: {
        "fade-up": "fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.5s ease-out both",
        "scale-in": "scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        float: "float 7s ease-in-out infinite",
        drift: "drift 18s ease-in-out infinite",
        "drift-alt": "drift-alt 31s ease-in-out infinite",
        "drift-wide": "drift-wide 43s ease-in-out infinite",
        "aurora-breathe": "aurora-breathe 23s ease-in-out infinite",
        sweep: "sweep 1.7s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        shimmer: "shimmer 2.2s ease-in-out infinite",
        "spin-slow": "spin-slow 32s linear infinite",
        "pulse-ring": "pulse-ring 2.6s cubic-bezier(0.16, 1, 0.3, 1) infinite",
        "dash-draw": "dash-draw 2.4s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
