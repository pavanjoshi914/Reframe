import type { Config } from 'tailwindcss';

// Brand palette is sampled from the Reframe wordmark: a violet plum mark on
// near-black ink. `brand` is the violet ramp, `ink` the neutral ramp used for
// surfaces in both themes.
const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f4f1ff',
          100: '#ebe4ff',
          200: '#d9ccff',
          300: '#bfa6ff',
          400: '#a175ff',
          500: '#8b46f9',
          600: '#7c28ee',
          700: '#6b1bd2',
          800: '#5918ac',
          900: '#4a178a',
          950: '#2d0a5e'
        },
        ink: {
          50: '#f7f7f9',
          100: '#eeeef2',
          200: '#dcdce4',
          300: '#b9b9c8',
          400: '#8d8da3',
          500: '#6b6b82',
          600: '#54546a',
          700: '#414154',
          800: '#26262f',
          900: '#16161c',
          950: '#0a0b0e'
        }
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      maxWidth: {
        content: '72rem'
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' }
        }
      },
      animation: {
        'fade-up': 'fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both',
        float: 'float 6s ease-in-out infinite'
      }
    }
  },
  plugins: []
};

export default config;
