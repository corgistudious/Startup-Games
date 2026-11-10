/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Button variants are composed dynamically (btn-${variant}); keep them in the build.
  safelist: ['btn-primary', 'btn-secondary', 'btn-outline', 'btn-ghost', 'btn-success', 'btn-danger', 'btn-sm', 'btn-lg', 'btn-shimmer'],
  theme: {
    extend: {
      colors: {
        sky: { 50: '#F0F9FF', 100: '#E0F2FE', 200: '#BAE6FD', 300: '#7DD3FC', 400: '#38BDF8', 500: '#0EA5E9', 600: '#0284C7', 700: '#0369A1', 800: '#075985', 900: '#0C4A6E' },
        ink: { 950: '#060B18', 900: '#0A1226', 850: '#0E1832', 800: '#121F3D', 700: '#1A2A4F', 600: '#253862', 500: '#3A4F7D', 400: '#64779F', 300: '#94A3C2', 200: '#C8D2E6', 100: '#E6EBF5' },
        gain: '#34D399',
        loss: '#F87171',
        warn: '#FBBF24',
      },
      fontFamily: {
        sans: ['"Be Vietnam Pro"', 'system-ui', 'sans-serif'],
        display: ['Lexend', '"Be Vietnam Pro"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
