const config = {
  plugins: {
    // `base` makes Tailwind resolve and scan from this folder even when the dev server is
    // started from the parent folder (otherwise: "Can't resolve 'tailwindcss'").
    "@tailwindcss/postcss": { base: import.meta.dirname },
  },
};

export default config;
