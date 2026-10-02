"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import config from "@/config";

// Messages for the ?error= codes NextAuth adds when it redirects here
const AUTH_ERRORS = {
  CredentialsSignin: "Invalid email or password",
  OAuthSignin: "Couldn't start sign-in with that provider. Please try again.",
  OAuthCallback: "Sign-in with that provider failed. Please try again.",
  OAuthAccountNotLinked: "This email is already registered. Sign in with your password instead.",
  SessionRequired: "Please sign in to continue.",
};

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [callbackUrl, setCallbackUrl] = useState(config.auth.callbackUrl);
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (code) setError(AUTH_ERRORS[code] || "Sign-in failed. Please try again.");
    // Only follow same-site paths back after sign-in
    const back = params.get("callbackUrl");
    if (back) {
      try {
        const url = new URL(back, window.location.origin);
        if (url.origin === window.location.origin) setCallbackUrl(url.pathname + url.search);
      } catch {
        // malformed callbackUrl: keep the default
      }
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password");
      } else {
        router.push(callbackUrl);
      }
    } catch (error) {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    signIn("google", { callbackUrl });
  };

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand Section */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary mb-2">Raasta-AI</h1>
          <p className="text-neutral/70">Welcome back! Sign in to your account</p>
        </div>

        {/* Sign In Card */}
        <div className="card bg-base-100 shadow-xl border border-base-300">
          <div className="card-body p-8">
            <h2 className="card-title text-2xl font-bold text-neutral mb-6 justify-center">
              Sign In
            </h2>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Error Message */}
              {error && (
                <div className="alert alert-error" role="alert">
                  <span>{error}</span>
                </div>
              )}

              {/* Email Field */}
              <div className="form-control">
                <label className="label" htmlFor="signin-email">
                  <span className="label-text font-medium text-neutral">Email</span>
                </label>
                <input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  placeholder="Enter your email"
                  className="input input-bordered w-full focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 border-base-300"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              {/* Password Field */}
              <div className="form-control">
                <label className="label" htmlFor="signin-password">
                  <span className="label-text font-medium text-neutral">Password</span>
                </label>
                <input
                  id="signin-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="input input-bordered w-full focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 border-base-300"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {/* Forgot Password */}
              <div className="flex items-center justify-end">
                <Link
                  href="/forgot-password"
                  className="link link-primary text-sm hover:text-primary/80"
                >
                  Forgot password?
                </Link>
              </div>

              {/* Sign In Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="btn btn-primary w-full text-white font-medium"
              >
                {isLoading ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Signing In...
                  </>
                ) : (
                  "Sign In"
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="divider text-neutral/50">or</div>

            {/* Social Sign In */}
            <div className="space-y-3">
              <button 
                type="button"
                onClick={handleGoogleSignIn}
                className="btn btn-outline w-full border-base-300 hover:bg-base-200 hover:border-base-300"
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </button>
            </div>

            {/* Sign Up Link */}
            <div className="text-center mt-6">
              <p className="text-neutral/70">
                Don&apos;t have an account?{" "}
                <Link
                  href="/signup"
                  className="link link-primary font-medium hover:text-primary/80"
                >
                  Sign up
                </Link>
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-8 text-neutral/50 text-sm">
          <p>
            By signing in, you agree to our{" "}
            <Link href="/tos" className="link link-primary">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/privacy-policy" className="link link-primary">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
