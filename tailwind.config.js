module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./styles/globals.css",
  ],
  theme: {
    extend: {
      backgroundImage: {
        gradient:
          "linear-gradient(60deg, #f79533, #f37055, #ef4e7b, #a166ab, #5073b8, #1098ad, #07b39b, #6fba82)",
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
    themes: [
      {
        reachly: {
          "primary": "#F87941",        // Precious Persimmon - main brand color
          "primary-focus": "#e6693a",  // Darker shade for focus states
          "primary-content": "#ffffff", // White text on primary
          "secondary": "#F9B095",      // No Way Rosé - softer accent
          "secondary-focus": "#f7a285", // Darker shade for focus
          "secondary-content": "#2F3035", // Dark text on secondary
          "accent": "#E6E4E6",         // Violet Essence - subtle highlight
          "accent-focus": "#d6d4d6",   // Darker shade for focus
          "accent-content": "#2F3035", // Dark text on accent
          "neutral": "#2F3035",        // Night Black - text and borders
          "neutral-focus": "#252529",  // Darker shade for focus
          "neutral-content": "#FDFCFC", // Light text on neutral
          "base-100": "#FDFCFC",       // Brilliance - main background
          "base-200": "#E6E4E6",       // Violet Essence - secondary background
          "base-300": "#B1B1B1",       // Palladium - tertiary background
          "base-content": "#2F3035",   // Dark text on light background
          "info": "#5073b8",           // Info blue
          "success": "#07b39b",        // Success green
          "warning": "#f79533",        // Warning orange
          "error": "#ef4e7b",          // Error pink
          
          // Custom border radius for rounded but not full round
          "--rounded-box": "0.75rem",
          "--rounded-btn": "0.5rem", 
          "--rounded-badge": "0.375rem",
          "--animation-btn": "0.25s",
          "--animation-input": "0.2s",
          "--btn-focus-scale": "0.95",
          "--border-btn": "1px",
          "--tab-border": "1px",
          "--tab-radius": "0.5rem",
        },
      },
      {
        "reachly-dark": {
          "primary": "#F87941",        // Keep same Precious Persimmon - main brand color
          "primary-focus": "#e6693a",  // Darker shade for focus states
          "primary-content": "#ffffff", // White text on primary
          "secondary": "#F9B095",      // Keep same No Way Rosé - softer accent
          "secondary-focus": "#f7a285", // Darker shade for focus
          "secondary-content": "#1a1a1a", // Dark text on secondary
          "accent": "#E6E4E6",         // Keep same Violet Essence - subtle highlight
          "accent-focus": "#d6d4d6",   // Darker shade for focus
          "accent-content": "#1a1a1a", // Dark text on accent
          "neutral": "#FDFCFC",        // Light text for dark mode
          "neutral-focus": "#e8e8e8",  // Slightly darker
          "neutral-content": "#2F3035", // Dark backgrounds
          "base-100": "#1a1a1a",       // Dark background
          "base-200": "#2F3035",       // Night Black as secondary background
          "base-300": "#404040",       // Darker tertiary background
          "base-content": "#FDFCFC",   // Light text on dark background
          "info": "#5073b8",           // Keep same info blue
          "success": "#07b39b",        // Keep same success green
          "warning": "#f79533",        // Keep same warning orange
          "error": "#ef4e7b",          // Keep same error pink
          
          // Custom border radius for rounded but not full round
          "--rounded-box": "0.75rem",
          "--rounded-btn": "0.5rem", 
          "--rounded-badge": "0.375rem",
          "--animation-btn": "0.25s",
          "--animation-input": "0.2s",
          "--btn-focus-scale": "0.95",
          "--border-btn": "1px",
          "--tab-border": "1px",
          "--tab-radius": "0.5rem",
        },
      },
    ],
  },
};
