import themes from "daisyui/src/theming/themes";

const config = {
  appName: "Raasta-AI",
  appDescription:
    "AI-powered LinkedIn outreach and recruitment automation. Run your entire B2B sales and hiring pipeline on autopilot.",
  domainName: "reachly.ai",
  crisp: {
    id: "",
    onlyShowOnRoutes: ["/"],
  },
  stripe: {
    plans: [
      {
        priceId:
          process.env.NODE_ENV === "development"
            ? "price_1Niyy5AxyNprDp7iZIqEyD2h"
            : "price_starter",
        name: "Starter",
        description: "Perfect for solo sales reps and recruiters",
        price: 49,
        priceAnchor: 79,
        features: [
          { name: "1 LinkedIn account" },
          { name: "Up to 3 active campaigns" },
          { name: "AI message generation" },
          { name: "Automated invite & follow-up" },
          { name: "Basic analytics" },
        ],
      },
      {
        isFeatured: true,
        priceId:
          process.env.NODE_ENV === "development"
            ? "price_1O5KtcAxyNprDp7iftKnrrpw"
            : "price_pro",
        name: "Pro",
        description: "For teams serious about scaling outreach",
        price: 99,
        priceAnchor: 149,
        features: [
          { name: "Up to 5 LinkedIn accounts" },
          { name: "Unlimited campaigns" },
          { name: "AI agentic mode (full autopilot)" },
          { name: "Recruiter pipeline & CV parsing" },
          { name: "Advanced analytics & reporting" },
          { name: "Priority support" },
        ],
      },
    ],
  },
  aws: {
    bucket: "bucket-name",
    bucketUrl: `https://bucket-name.s3.amazonaws.com/`,
    cdn: "https://cdn-id.cloudfront.net/",
  },
  mailgun: {
    subdomain: "mg",
    fromNoReply: `Raasta-AI <noreply@mg.reachly.ai>`,
    fromAdmin: `Raasta-AI Team <hello@mg.reachly.ai>`,
    supportEmail: "support@reachly.ai",
    forwardRepliesTo: "support@reachly.ai",
  },
  colors: {
    theme: "reachly",
    main: "#6366F1",
  },
  auth: {
    loginUrl: "/api/auth/signin",
    callbackUrl: "/dashboard",
  },
};

export default config;
