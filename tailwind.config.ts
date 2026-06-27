import type { Config } from 'tailwindcss';

// All palette colors resolve to CSS variables (channel triplets) so themes can be
// swapped at runtime by setting `data-theme` on <html>. See src/index.css.
const withVar = (name: string) => `rgb(var(${name}) / <alpha-value>)`;
const ramp = (prefix: string, steps: number[]) =>
  Object.fromEntries(steps.map((s) => [s, withVar(`--${prefix}-${s}`)]));

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // `slate` is the app-wide neutral (overrides Tailwind's cool default with
        // a themeable ramp); `brand` is the accent; mint/clay carry money meaning.
        slate: ramp('s', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        brand: ramp('b', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        mint: ramp('mint', [300, 400, 500]),
        clay: ramp('clay', [300, 400, 500]),
        // Semantic status colors — each theme tunes the channel triplet for its
        // canvas, so banners stay legible on both dark and light themes.
        success: withVar('--ok'),
        warning: withVar('--warn'),
        danger: withVar('--danger'),
        info: withVar('--info'),
      },
      fontFamily: {
        sans: ['"Hanken Grotesk Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Fraunces Variable"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
      // Purposeful micro-interactions only — keyed to the daily add ritual. Gated
      // behind `motion-safe:` at call sites so reduced-motion users get none.
      keyframes: {
        // Each keypad press gives the running amount a small confident bounce.
        'amount-pop': {
          '0%': { transform: 'scale(0.97)' },
          '55%': { transform: 'scale(1.035)' },
          '100%': { transform: 'scale(1)' },
        },
        // The tapped category coin acknowledges the save.
        'coin-pop': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.09)' },
          '100%': { transform: 'scale(1)' },
        },
        // Confirmation toast rises into place (X stays centered at -50%).
        'snack-in': {
          '0%': { opacity: '0', transform: 'translate(-50%, 14px)' },
          '100%': { opacity: '1', transform: 'translate(-50%, 0)' },
        },
      },
      animation: {
        'amount-pop': 'amount-pop 180ms ease-out',
        'coin-pop': 'coin-pop 320ms ease-out',
        'snack-in': 'snack-in 220ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
