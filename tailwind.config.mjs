/** @type {import('tailwindcss').Config} */
export default {
  content: ['./*.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hud: {
          bg: 'rgba(20, 22, 26, 0.92)',
          border: 'rgba(255, 255, 255, 0.08)',
          icon: 'rgba(220, 224, 232, 0.85)',
          'icon-active': '#4ade80',
          'icon-off': 'rgba(160, 165, 175, 0.55)'
        }
      }
    }
  },
  plugins: []
};
