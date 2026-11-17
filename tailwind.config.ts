import type { Config } from "tailwindcss";

// shadcn stores complete OKLCH colors; color-mix retains Tailwind 3 opacity modifiers.
const shadcnColor = (token: string) =>
  `color-mix(in oklch, var(--${token}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: shadcnColor("background"),
        foreground: shadcnColor("foreground"),
        card: {
          DEFAULT: shadcnColor("card"),
          foreground: shadcnColor("card-foreground"),
        },
        popover: {
          DEFAULT: shadcnColor("popover"),
          foreground: shadcnColor("popover-foreground"),
        },
        primary: {
          DEFAULT: shadcnColor("primary"),
          foreground: shadcnColor("primary-foreground"),
        },
        secondary: {
          DEFAULT: shadcnColor("secondary"),
          foreground: shadcnColor("secondary-foreground"),
        },
        muted: {
          DEFAULT: shadcnColor("muted"),
          foreground: shadcnColor("muted-foreground"),
        },
        accent: {
          DEFAULT: shadcnColor("accent"),
          foreground: shadcnColor("accent-foreground"),
        },
        destructive: shadcnColor("destructive"),
        border: shadcnColor("border"),
        input: shadcnColor("input"),
        ring: shadcnColor("ring"),
        chart: {
          1: shadcnColor("chart-1"),
          2: shadcnColor("chart-2"),
          3: shadcnColor("chart-3"),
          4: shadcnColor("chart-4"),
          5: shadcnColor("chart-5"),
        },
        sidebar: {
          DEFAULT: shadcnColor("sidebar"),
          foreground: shadcnColor("sidebar-foreground"),
          primary: shadcnColor("sidebar-primary"),
          "primary-foreground": shadcnColor("sidebar-primary-foreground"),
          accent: shadcnColor("sidebar-accent"),
          "accent-foreground": shadcnColor("sidebar-accent-foreground"),
          border: shadcnColor("sidebar-border"),
          ring: shadcnColor("sidebar-ring"),
        },
        /* Legacy palette — kept so pages not yet redesigned still build. */
        maroon: { DEFAULT: "#7B1C2E", dark: "#5A1220", light: "#A83048" },
        gold: { DEFAULT: "#C9A84C", light: "#E6C97A", pale: "#F5EED5", ink: "#80601F" },
        cream: "#FDF8F0",
        ivory: "#FAF4E8",
        ink: { DEFAULT: "#2A1A10", mid: "#6B4C3B", light: "#80614E" },

        /*
         * `carbon` = the theme's primary deep maroon "ink".
         * It drives the bands, headings, buttons and borders across the
         * redesigned pages. (Kept this token name so the component files
         * don't all need editing — change the value here to re-theme.)
         */
        carbon: { DEFAULT: "#7B1C2E", dark: "#3E0C17" },
        /* `paper` = warm ivory used for the soft alternating section bands. */
        paper: "#FBF7F1",
      },
      fontFamily: {
        sans: ["var(--font-assistant)", "Arial", "sans-serif"],
        display: ["var(--font-assistant)", "sans-serif"],
        body: ["var(--font-assistant)", "sans-serif"],
        serif: ["var(--font-assistant)", "sans-serif"],
      },
      keyframes: {
        fadeDown: {
          "0%": { opacity: "0", transform: "translateY(-6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(18px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        fadeDown: "fadeDown 0.15s ease",
        fadeUp: "fadeUp 0.8s cubic-bezier(0.22,1,0.36,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
