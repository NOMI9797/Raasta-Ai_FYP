"use client";

import Link from "next/link";
import { useState } from "react";
import config from "@/config";

const supportEmail = config.mailgun.supportEmail;

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Self-service reset emails aren't built yet: tell the user how to get help
  // instead of claiming a link was sent.
  const handleSubmit = (e) => {
    e.preventDefault();
    setIsSubmitted(true);
  };

  const supportHref = `mailto:${supportEmail}?subject=${encodeURIComponent(
    "Password reset request"
  )}&body=${encodeURIComponent(`Please reset the password for my Raasta-AI account: ${email}`)}`;

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo/Brand Section */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-primary mb-2">Raasta-AI</h1>
          </div>

          {/* Success Card */}
          <div className="card bg-base-100 shadow-xl border border-base-300">
            <div className="card-body p-8 text-center">
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-success" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              
              <h2 className="text-2xl font-bold text-neutral mb-4">Contact support to reset</h2>

              <p className="text-neutral/70 mb-6">
                Automatic reset emails aren&apos;t available yet. Email our support team and we&apos;ll
                reset the password for <span className="font-medium text-neutral">{email}</span>.
              </p>

              <div className="space-y-4">
                <a href={supportHref} className="btn btn-outline w-full">
                  Email {supportEmail}
                </a>
                
                <Link href="/signin" className="btn btn-primary w-full">
                  Back to Sign In
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Brand Section */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary mb-2">Raasta-AI</h1>
          <p className="text-neutral/70">Reset your password</p>
        </div>

        {/* Forgot Password Card */}
        <div className="card bg-base-100 shadow-xl border border-base-300">
          <div className="card-body p-8">
            <h2 className="card-title text-2xl font-bold text-neutral mb-2 justify-center">
              Forgot Password?
            </h2>
            
            <p className="text-neutral/70 text-center mb-6">
              Enter the email address you signed up with and we&apos;ll help you get back in.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Email Field */}
              <div className="form-control">
                <label className="label" htmlFor="forgot-email">
                  <span className="label-text font-medium text-neutral">Email Address</span>
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  placeholder="Enter your email address"
                  className="input input-bordered w-full focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 border-base-300"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              {/* Reset Button */}
              <button
                type="submit"
                className="btn btn-primary w-full text-white font-medium"
              >
                Continue
              </button>
            </form>

            {/* Back to Sign In */}
            <div className="text-center mt-6">
              <Link
                href="/signin"
                className="link link-primary font-medium hover:text-primary/80 flex items-center justify-center"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back to Sign In
              </Link>
            </div>
          </div>
        </div>

        {/* Help Text */}
        <div className="text-center mt-8 text-neutral/50 text-sm">
          <p>
            Need more help?{" "}
            <a href={`mailto:${supportEmail}`} className="link link-primary">
              Contact Support
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
