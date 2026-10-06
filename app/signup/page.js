"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { m } from "framer-motion";
import { Check, Eye, EyeOff, LoaderCircle } from "lucide-react";
import config from "@/config";
import { AuthShell, GoogleIcon, SecureNote } from "@/components/auth/AuthShell";

const initialForm = { firstName: "", lastName: "", email: "", password: "", confirmPassword: "", agreeToTerms: false, receiveUpdates: false };
const fieldMotion = { hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0 } };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Checkbox({ checked, onChange, children, name }) {
  return <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-muted"><span className="relative mt-0.5 grid size-5 shrink-0 place-items-center"><input aria-label={name} checked={checked} className="peer size-5 appearance-none rounded-[5px] border border-border bg-surface checked:border-primary checked:bg-primary" onChange={onChange} type="checkbox"/><Check className="pointer-events-none absolute size-3.5 text-white opacity-0 peer-checked:opacity-100" strokeWidth={3}/></span><span>{children}</span></label>;
}

export default function SignUp() {
  const [form, setForm] = useState(initialForm);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState("idle");
  const [showPassword, setShowPassword] = useState(false);
  const [shake, setShake] = useState(0);
  const router = useRouter();
  const rules = [
    { label: "At least 8 characters", met: form.password.length >= 8 },
    { label: "One uppercase letter", met: /[A-Z]/.test(form.password) },
    { label: "One number", met: /\d/.test(form.password) },
  ];
  const strength = rules.filter((rule) => rule.met).length;
  const setValue = (field, value) => { setForm((current) => ({ ...current, [field]: value })); setErrors((current) => ({ ...current, [field]: "" })); };
  const validateField = (field) => {
    let message = ""; const value = form[field];
    if ((field === "firstName" || field === "lastName") && !value.trim()) message = `${field === "firstName" ? "First" : "Last"} name is required`;
    if (field === "email" && !emailPattern.test(value)) message = "Enter a valid email address";
    if (field === "password" && !rules.every((rule) => rule.met)) message = "Password does not meet all requirements";
    if (field === "confirmPassword" && value !== form.password) message = "Passwords do not match";
    setErrors((current) => ({ ...current, [field]: message })); return !message;
  };
  const fail = (message) => { setFormError(message); setShake((value) => value + 1); setStatus("idle"); };
  const handleSubmit = async (event) => {
    event.preventDefault(); setFormError("");
    const valid = ["firstName", "lastName", "email", "password", "confirmPassword"].map(validateField).every(Boolean);
    if (!valid) return fail("Please correct the highlighted fields");
    if (!form.agreeToTerms) { setErrors((current) => ({ ...current, agreeToTerms: "You must agree to the Terms of Service" })); return fail("Please accept the terms to continue"); }
    setStatus("loading");
    try {
      const response = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, email: form.email, password: form.password }) });
      const data = await response.json();
      if (!response.ok) return fail(data.error || "Registration failed");
      const result = await signIn("credentials", { email: form.email, password: form.password, redirect: false });
      setStatus("success");
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      router.push(result?.error ? "/login" : "/onboarding");
    } catch { fail("Something went wrong. Please try again."); }
  };
  const inputClass = "h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-sm text-ink outline-none placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/25";
  return <AuthShell>
    <div><h1 className="text-[clamp(32px,4vw,44px)]">Create your account</h1><p className="mt-2 text-sm leading-[1.6] text-muted">Start automating outreach and hiring in minutes.</p></div>
    <m.form animate={shake ? { x: [0, -4, 4, -4, 4, 0] } : {}} className="mt-8 space-y-4" key={shake} noValidate onSubmit={handleSubmit} transition={{ duration: 0.3 }}>
      <m.div animate="visible" className="grid gap-4 sm:grid-cols-2" initial="hidden" transition={{ staggerChildren: 0.06 }}>
        {[['firstName','First name','First name'],['lastName','Last name','Last name']].map(([field,label,placeholder]) => <m.label className="block" key={field} variants={fieldMotion}><span className="mb-1.5 block text-[13px] font-medium">{label}</span><input aria-invalid={Boolean(errors[field])} className={inputClass} onBlur={() => validateField(field)} onChange={(event) => setValue(field,event.target.value)} placeholder={placeholder} value={form[field]}/>{errors[field] ? <span className="mt-1 block text-[13px] text-red-600">{errors[field]}</span> : null}</m.label>)}
      </m.div>
      <m.label animate="visible" className="block" initial="hidden" transition={{ delay: 0.12 }} variants={fieldMotion}><span className="mb-1.5 block text-[13px] font-medium">Email</span><input aria-invalid={Boolean(errors.email)} className={inputClass} onBlur={() => validateField("email")} onChange={(event) => setValue("email",event.target.value)} placeholder="you@example.com" type="email" value={form.email}/>{errors.email ? <span className="mt-1 block text-[13px] text-red-600">{errors.email}</span> : null}</m.label>
      <m.div animate="visible" initial="hidden" transition={{ delay: 0.18 }} variants={fieldMotion}><label className="block"><span className="mb-1.5 block text-[13px] font-medium">Password</span><span className="relative block"><input aria-invalid={Boolean(errors.password)} className={`${inputClass} pr-11`} onBlur={() => validateField("password")} onChange={(event) => setValue("password",event.target.value)} placeholder="Create a strong password" type={showPassword ? "text" : "password"} value={form.password}/><button aria-label={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-ink" onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></span>{errors.password ? <span className="mt-1 block text-[13px] text-red-600">{errors.password}</span> : null}</label>
        <div className="mt-3 grid grid-cols-3 gap-1.5" aria-label="Password strength">{[0,1,2].map((segment) => <span className={`h-1.5 rounded-full ${strength > segment ? "bg-emerald-500" : "bg-border"}`} key={segment}/>)}</div>
        <div className="mt-2 grid gap-1">{rules.map((rule) => <span className={`flex items-center gap-2 text-[13px] ${rule.met ? "text-emerald-700" : "text-muted"}`} key={rule.label}><span className={`grid size-4 place-items-center rounded-full ${rule.met ? "bg-emerald-100" : "bg-bg"}`}><Check size={11}/></span>{rule.label}</span>)}</div>
      </m.div>
      <m.label animate="visible" className="block" initial="hidden" transition={{ delay: 0.24 }} variants={fieldMotion}><span className="mb-1.5 block text-[13px] font-medium">Confirm password</span><input aria-invalid={Boolean(errors.confirmPassword)} className={inputClass} onBlur={() => validateField("confirmPassword")} onChange={(event) => setValue("confirmPassword",event.target.value)} placeholder="Repeat your password" type={showPassword ? "text" : "password"} value={form.confirmPassword}/>{errors.confirmPassword ? <span className="mt-1 block text-[13px] text-red-600">{errors.confirmPassword}</span> : null}</m.label>
      <m.div animate="visible" className="space-y-2" initial="hidden" transition={{ delay: 0.3 }} variants={fieldMotion}><Checkbox checked={form.agreeToTerms} name="Agree to terms" onChange={(event) => setValue("agreeToTerms",event.target.checked)}>I agree to the <Link className="font-medium text-primary underline underline-offset-4" href="/tos">Terms of Service</Link> and <Link className="font-medium text-primary underline underline-offset-4" href="/privacy-policy">Privacy Policy</Link></Checkbox>{errors.agreeToTerms ? <span className="block text-[13px] text-red-600">{errors.agreeToTerms}</span> : null}<Checkbox checked={form.receiveUpdates} name="Product updates" onChange={(event) => setValue("receiveUpdates",event.target.checked)}>Send me occasional product updates</Checkbox></m.div>
      {formError ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-[13px] text-red-700" role="alert">{formError}</p> : null}
      <button className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-primary px-5 text-sm font-medium text-on-primary transition-transform hover:-translate-y-px disabled:opacity-60" disabled={status !== "idle"} type="submit">{status === "loading" ? <><LoaderCircle className="size-4 animate-spin"/>Creating account...</> : status === "success" ? <m.span animate={{ scale: 1 }} initial={{ scale: 0 }}><Check className="size-5"/></m.span> : "Create account"}</button>
    </m.form>
    <div className="my-5 flex items-center gap-3 text-[13px] text-muted"><span className="h-px flex-1 bg-border"/>or<span className="h-px flex-1 bg-border"/></div>
    <button className="flex h-11 w-full items-center justify-center gap-3 rounded-[10px] border border-border bg-surface px-5 text-sm font-medium text-ink hover:bg-bg" onClick={() => signIn("google", { callbackUrl: config.auth.callbackUrl })} type="button"><GoogleIcon/>Continue with Google</button>
    <p className="mt-6 text-center text-sm text-muted">Already have an account? <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/login">Sign in</Link></p><SecureNote/>
  </AuthShell>;
}
