"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    // Password reset functionality will be added later
    console.log("Password reset request for:", email);
    setIsSubmitted(true);
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen bg-base-100 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo/Brand Section */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-primary mb-2">Reachly</h1>
          </div>

          {/* Success Card */}
          <div className="card bg-base-100 shadow-xl border border-base-300">
            <div className="card-body p-8 text-center">
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-success" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </div>
              
              <h2 className="text-2xl font-bold text-neutral mb-4">Check Your Email</h2>
              
              <p className="text-neutral/70 mb-6">
                We&apos;ve sent a password reset link to <span className="font-medium text-neutral">{email}</span>
              </p>
              
              <p className="text-sm text-neutral/60 mb-8">
                If you don&apos;t see it in your inbox, check your spam folder or try again with a different email address.
              </p>

              <div className="space-y-4">
                <button 
                  onClick={() => setIsSubmitted(false)}
                  className="btn btn-outline w-full"
                >
                  Try Different Email
                </button>
                
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
          <h1 className="text-4xl font-bold text-primary mb-2">Reachly</h1>
          <p className="text-neutral/70">Reset your password</p>
        </div>

        {/* Forgot Password Card */}
        <div className="card bg-base-100 shadow-xl border border-base-300">
          <div className="card-body p-8">
            <h2 className="card-title text-2xl font-bold text-neutral mb-2 justify-center">
              Forgot Password?
            </h2>
            
            <p className="text-neutral/70 text-center mb-6">
              No worries! Enter your email address and we&apos;ll send you a link to reset your password.
            </p>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Email Field */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium text-neutral">Email Address</span>
                </label>
                <input
                  type="email"
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
                className="btn btn-primary w-full text-white font-medium hover:scale-105 transition-transform"
              >
                Send Reset Link
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
            <Link href="/contact" className="link link-primary">
              Contact Support
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
