import type { Config } from "tailwindcss";

/**
 * CorkBack design tokens, locked from Figma "Foundations · Paper and Ink".
 * Three foundations + one accent + a limited-role navy. See .kiro/steering/design-tokens.md.
 */
const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "#FFFDF8", // app background
        card: "#FFFFFF", // card surface
        board: "#E5DDCC", // card border / board tone
        ink: "#1E1E1C", // primary text
        "dark-red": "#8C2B1F", // pins, selected chips, "Back", one main action per screen
        "deep-navy": "#1F2E4D", // limited role: View profile/posting, @handles, ocean labels, desktop links
      },
      fontFamily: {
        // All product text is Kalam. Regular for plain, Bold for bold.
        // Self-hosted via next/font (CSS variable --font-kalam), no external request.
        kalam: ["var(--font-kalam)", "cursive"],
      },
      borderRadius: {
        // 50px primary controls, 13px corners, 24px mobile edges, 8/12/20/28 rhythm
        control: "50px",
        card: "13px",
        edge: "24px",
      },
      borderWidth: {
        // Fields and category chips use a 2px navy border.
        2: "2px",
      },
    },
  },
  plugins: [],
};

export default config;
