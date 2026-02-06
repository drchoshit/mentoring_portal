/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f1faf7',
          100: '#daf2e8',
          200: '#b2e4d3',
          300: '#7fd0b7',
          400: '#4fb898',
          500: '#2b9d7f',
          600: '#1f8067',
          700: '#176552',
          800: '#0f3b2f',
          900: '#0a2a21'
        },
        gold: {
          100: '#fbf4dd',
          200: '#f5e5b4',
          300: '#e5cc86',
          400: '#d6c07a',
          500: '#b59a55'
        }
      }
    }
  },
  plugins: [],
};
