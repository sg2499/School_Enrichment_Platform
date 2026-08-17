import type { Config } from "tailwindcss";

// Palette/type-scale placeholder -- ENGINEERING_OPERATING_SYSTEM.md Section
// 4a calls for a real, deliberate design system (not framework defaults)
// before this goes in front of students. Phase 1's job is proving the
// three-role shell boots and routes correctly; a proper visual identity
// pass belongs to Phase 2 onward, once there's real content to design
// around.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e40af",
        },
      },
    },
  },
  plugins: [],
};

export default config;
