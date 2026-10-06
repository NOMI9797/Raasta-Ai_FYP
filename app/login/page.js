"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { m } from "framer-motion";
import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react";
import config from "@/config";
import { AuthShell, GoogleIcon, SecureNote } from "@/components/auth/AuthShell";

const fieldMotion = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("idle");
  const [shake, setShake] = useState(0);
  const router = useRouter();
  const validate = (field) => { let message = ""; if (field === "email" && !emailPattern.test(email)) message = "Enter a valid email address"; if (field === "password" && !password) message = "Password is required"; setErrors((current) => ({ ...current, [field]: message })); return !message; };
  const fail = (message) => { setFormError(message); setStatus("idle"); setShake((value) => value + 1); };
  const submit = async (event) => { event.preventDefault(); setFormError(""); const valid = ["email", "password"].map(validate).every(Boolean); if (!valid) return fail("Please correct the highlighted fields"); setStatus("loading"); try { const result = await signIn("credentials", { email, password, redirect: false }); if (result?.error) return fail("Invalid email or password"); setStatus("success"); await new Promise((resolve) => window.setTimeout(resolve, 650)); router.push(config.auth.callbackUrl); } catch { fail("Something went wrong. Please try again."); } };
  const inputClass = "h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/25";
  return <AuthShell>
    <div><h1 className="text-[clamp(32px,4vw,44px)]">Welcome back</h1><p className="mt-2 text-sm leading-[1.6] text-muted">Sign in to continue managing your outreach and hiring.</p></div>
    <m.form animate={shake ? { x: [0, -4, 4, -4, 4, 0] } : {}} className="mt-8 space-y-5" key={shake} noValidate onSubmit={submit} transition={{ duration: 0.3 }}>
      <m.label animate="visible" className="block" initial="hidden" transition={{ delay: 0.06 }} variants={fieldMotion}><span className="mb-1.5 block text-[13px] font-medium">Email</span><input aria-invalid={Boolean(errors.email)} className={inputClass} onBlur={() => validate("email")} onChange={(event) => { setEmail(event.target.value); setErrors((current) => ({ ...current, email: "" })); }} placeholder="you@example.com" type="email" value={email}/>{errors.email ? <span className="mt-1 block text-[13px] text-red-600">{errors.email}</span> : null}</m.label>
      <m.label animate="visible" className="block" initial="hidden" transition={{ delay: 0.12 }} variants={fieldMotion}><span className="mb-1.5 block text-[13px] font-medium">Password</span><span className="relative block"><input aria-invalid={Boolean(errors.password)} className={`${inputClass} pr-11`} onBlur={() => validate("password")} onChange={(event) => { setPassword(event.target.value); setErrors((current) => ({ ...current, password: "" })); }} placeholder="Enter your password" type={showPassword ? "text" : "password"} value={password}/><button aria-label={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-ink" onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span>{errors.password ? <span className="mt-1 block text-[13px] text-red-600">{errors.password}</span> : null}</m.label>
      <m.div animate="visible" className="flex items-center justify-between gap-4" initial="hidden" transition={{ delay: 0.18 }} variants={fieldMotion}><label className="flex cursor-pointer items-center gap-2 text-sm text-muted"><span className="relative grid size-5 place-items-center"><input aria-label="Remember me" checked={remember} className="peer size-5 appearance-none rounded-[5px] border border-border bg-surface checked:border-primary checked:bg-primary" onChange={(event) => setRemember(event.target.checked)} type="checkbox"/><Check className="pointer-events-none absolute size-3.5 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3}/></span>Remember me</label><Link className="text-sm font-medium text-primary hover:underline" href="/forgot-password">Forgot password?</Link></m.div>
      {formError ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700" role="alert">{formError}</p> : null}
      <button className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-medium text-on-primary transition-transform hover:-translate-y-px disabled:opacity-60" disabled={status !== "idle"} type="submit">{status === "loading" ? <><LoaderCircle className="size-4 animate-spin"/>Signing in...</> : status === "success" ? <m.span animate={{ scale: 1 }} initial={{ scale: 0 }}><Check className="size-5"/></m.span> : "Sign in"}</button>
    </m.form>
    <div className="my-5 flex items-center gap-3 text-[13px] text-muted"><span className="h-px flex-1 bg-border"/>or<span className="h-px flex-1 bg-border"/></div>
    <button className="flex h-11 w-full items-center justify-center gap-3 rounded-[10px] border border-border bg-surface px-5 text-sm font-medium text-ink hover:bg-bg" onClick={() => signIn("google", { callbackUrl: config.auth.callbackUrl })} type="button"><GoogleIcon/>Continue with Google</button>
    <p className="mt-6 text-center text-sm text-muted">Don&apos;t have an account? <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/signup">Create one</Link></p><SecureNote/>
  </AuthShell>;
}
