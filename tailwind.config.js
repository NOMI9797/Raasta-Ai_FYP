module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/globals.css",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic kebab-case tokens
        'canvas-dark': '#080B13',
        'canvas-light': '#F8FAFC',
        'surface-dark': '#0F1629',
        'surface-dark-hover': '#161F38',
        'surface-light': '#FFFFFF',
        'brand-primary': '#6366F1',
        'brand-primary-hover': '#4F46E5',
        'brand-violet': '#7C3AED',
        'brand-accent': '#22C55E',
        'text-heading-dark': '#FFFFFF',
        'text-body-dark': '#94A3B8',
        'text-heading-light': '#0F172A',
        'text-body-light': '#64748B',

        // CamelCase aliases to prevent breaking redesign components
        darkCanvas: '#080B13',
        lightCanvas: '#F8FAFC',
        surfaceDark: '#0F1629',
        surfaceLight: '#FFFFFF',
        brandPrimary: '#6366F1',
        brandPrimaryDark: '#7C3AED',
        accentSuccess: '#22C55E',
        accentCyan: '#06B6D4',
        borderDark: 'rgba(255, 255, 255, 0.08)',
        borderLight: '#E2E8F0',
      },
      fontFamily: {
        heading: ["var(--font-heading)", '"Space Grotesk"', 'sans-serif'],
        sans: ["var(--font-sans)", '"Plus Jakarta Sans"', 'sans-serif'],
        mono: ["var(--font-mono)", '"JetBrains Mono"', 'monospace'],
      },
      backgroundImage: {
        gradient:
          "linear-gradient(60deg, #6366F1, #4F46E5, #4338CA, #a166ab, #5073b8, #1098ad, #07b39b, #6fba82)",
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
        '4xl': '32px',
      },
      boxShadow: {
        'brand-glow': '0 0 40px -10px rgba(99, 102, 241, 0.45)',
        'card-soft': '0 20px 40px -15px rgba(0, 0, 0, 0.05), 0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      },
      animation: {
        opacity: "opacity 0.25s ease-in-out",
        appearFromRight: "appearFromRight 300ms ease-in-out",
        wiggle: "wiggle 1.5s ease-in-out infinite",
        popup: "popup 0.25s ease-in-out",
        shimmer: "shimmer 3s ease-out infinite alternate",
      },
      keyframes: {
        opacity: {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        appearFromRight: {
          "0%": { opacity: 0.3, transform: "translate(15%, 0px);" },
          "100%": { opacity: 1, transform: "translate(0);" },
        },
        wiggle: {
          "0%, 20%, 80%, 100%": {
            transform: "rotate(0deg)",
          },
          "30%, 60%": {
            transform: "rotate(-2deg)",
          },
          "40%, 70%": {
            transform: "rotate(2deg)",
          },
          "45%": {
            transform: "rotate(-4deg)",
          },
          "55%": {
            transform: "rotate(4deg)",
          },
        },
        popup: {
          "0%": { transform: "scale(0.8)", opacity: 0.8 },
          "50%": { transform: "scale(1.1)", opacity: 1 },
          "100%": { transform: "scale(1)", opacity: 1 },
        },
        shimmer: {
          "0%": { backgroundPosition: "0 50%" },
          "50%": { backgroundPosition: "100% 50%" },
          "100%": { backgroundPosition: "0% 50%" },
        },
      },
    },
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: false,
    base: false,
  },
};