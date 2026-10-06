// Motion budget: one orchestrated moment (hero load + road draw, in landing-tokens.css),
// one scroll-linked road (the pipeline), and otherwise only motion that answers an action.
// Transform and opacity only.
export const ease = [0.22, 1, 0.36, 1];
export const spring = { type: "spring", stiffness: 420, damping: 36 };
