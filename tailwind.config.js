/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0a0c',
        card: '#141418',
        raise: '#1d1d23',
        line: '#2a2a33',
        ink: '#f4f4f6',
        mute: '#8d8d99',
        accent: '#c6ff3d',
        'accent-ink': '#0a0a0c',
        warn: '#ffb020',
        bad: '#ff6b6b',
      },
      boxShadow: { glow: '0 10px 32px -10px rgba(198,255,61,.55)' },
    },
  },
  plugins: [],
};
