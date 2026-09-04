import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#08080a",       // near-black canvas
        obsidian: "#111115",   // panel surfaces
        ash: "#8a8a93",        // secondary text
        bone: "#eeeeef",       // primary text
        signal: "#7c5cff",     // single accent — indigo-violet, not the default terracotta/acid-green
        ember: "#ff6a3d",      // rare warm accent for alerts/highlights only
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
    },
  },
  plugins: [],
};
export default config;
