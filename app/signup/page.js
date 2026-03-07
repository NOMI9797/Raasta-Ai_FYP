"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import config from "@/config";

export default function SignUp() {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    agreeToTerms: false,
    receiveUpdates: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const router = useRouter();

  const handleChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    // Validation
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      setIsLoading(false);
      return;
    }

    if (formData.password.length < 6) {
      setError("Password must be at least 6 characters long");
      setIsLoading(false);
      return;
    }

    if (!formData.agreeToTerms) {
      setError("You must agree to the Terms of Service");
      setIsLoading(false);
      return;
    }

    try {
      // Register user
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          password: formData.password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Registration failed");
        return;
      }

      // Auto sign in after successful registration
      const signInResult = await signIn("credentials", {
        email: formData.email,
        password: formData.password,
        redirect: false,
      });

      if (signInResult?.error) {
        setSuccess(true);
        setTimeout(() => router.push("/signin"), 2000);
      } else {
        router.push(config.auth.callbackUrl);
      }
    } catch (error) {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignUp = () => {
    signIn("google", { callbackUrl: config.auth.callbackUrl });
  };

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand Section */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary mb-2">Reachly</h1>
          <p className="text-neutral/70">Create your account and start reaching out</p>
        </div>

        {/* Sign Up Card */}
        <div className="card bg-base-100 shadow-xl border border-base-300">
          <div className="card-body p-8">
            <h2 className="card-title text-2xl font-bold text-neutral mb-6 justify-center">
              Sign Up
            </h2>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Error/Success Messages */}
              {error && (
                <div className="alert alert-error">
                  <span>{error}</span>
                </div>
              )}
              {success && (
                <div className="alert alert-success">
                  <span>Account created successfully! Redirecting to sign in...</span>
                </div>
              )}

              {/* Name Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium text-neutral">First Name</span>
                  </label>
                  <input
                    type="text"
                    placeholder="John"
                    className="input input-bordered w-full focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 border-base-300"
                    value={formData.firstName}
                    onChange={(e) => handleChange("firstName", e.target.value)}
                    required
                  />
                </div>
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-medium text-neutral">Last Name</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Doe"
                    className="input input-bordered w-full focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 border-base-300"
                    value={formData.lastName}
                    onChange={(e) => handleChange("lastName", e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Email Field */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium text-neutral">Email</span>
                </label>
                <input
                  type="email"
                  placeholder="john@example.com"
                  className="input input-bordered w-full focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 border-base-300"
                  value={formData.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  required
                />
              </div>

              {/* Password Fields */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium text-neutral">Password</span>
                </label>
                <input
                  type="password"
                  placeholder="Create a strong password"
                  className="input input-bordered w-full focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 border-base-300"
                  value={formData.password}
                  onChange={(e) => handleChange("password", e.target.value)}
                  required
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium text-neutral">Confirm Password</span>
                </label>
                <input
                  type="password"
                  placeholder="Confirm your password"
                  className="input input-bordered w-full focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 border-base-300"
                  value={formData.confirmPassword}
                  onChange={(e) => handleChange("confirmPassword", e.target.value)}
                  required
                />
              </div>

              {/* Checkboxes */}
              <div className="space-y-3">
                <label className="label cursor-pointer justify-start">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-sm mr-3"
                    checked={formData.agreeToTerms}
                    onChange={(e) => handleChange("agreeToTerms", e.target.checked)}
                    required
                  />
                  <span className="label-text text-neutral/80 text-sm">
                    I agree to the{" "}
                    <Link href="/tos" className="link link-primary">
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link href="/privacy-policy" className="link link-primary">
                      Privacy Policy
                    </Link>
                  </span>
                </label>

                <label className="label cursor-pointer justify-start">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-sm mr-3"
                    checked={formData.receiveUpdates}
                    onChange={(e) => handleChange("receiveUpdates", e.target.checked)}
                  />
                  <span className="label-text text-neutral/80 text-sm">
                    I&apos;d like to receive product updates and marketing emails
                  </span>
                </label>
              </div>

              {/* Sign Up Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="btn btn-primary w-full text-white font-medium hover:scale-105 transition-transform mt-6"
              >
                {isLoading ? (
                  <>
                    <span className="loading loading-spinner loading-sm"></span>
                    Creating Account...
                  </>
                ) : (
                  "Create Account"
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="divider text-neutral/50">or</div>

            {/* Social Sign Up */}
            <div className="space-y-3">
              <button 
                type="button"
                onClick={handleGoogleSignUp}
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

              <button className="btn btn-outline w-full border-base-300 hover:bg-base-200 hover:border-base-300">
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.024-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.719-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.097.118.112.221.083.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.402.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.746-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24.009 12.017 24c6.624 0 11.99-5.367 11.99-12C24.007 5.367 18.641.001 12.017.001z"/>
                </svg>
                Continue with LinkedIn
              </button>
            </div>

            {/* Sign In Link */}
            <div className="text-center mt-6">
              <p className="text-neutral/70">
                Already have an account?{" "}
                <Link
                  href="/signin"
                  className="link link-primary font-medium hover:text-primary/80"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div className="text-center mt-6 text-neutral/50 text-sm">
          <p>🔒 Your data is secure and encrypted</p>
        </div>
      </div>
    </div>
  );
}
