"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Mail, Lock, User, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.11A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.6H1.26a12 12 0 0 0 0 10.8z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.35.6 4.6 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.26 6.6l4.01 3.11C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);

  const getBackendUrl = () => {
    if (process.env.NEXT_PUBLIC_BACKEND_URL) {
      return process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/$/, "");
    }
    if (typeof window === "undefined") return "";
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const port = 8000;
    return `${protocol}//${host}:${port}`;
  };

  useEffect(() => {
    fetch(`${getBackendUrl()}/api/auth/status`)
      .then((r) => r.json())
      .then((d) => setGoogleConfigured(!!d.google_configured))
      .catch(() => setGoogleConfigured(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const path = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const r = await fetch(`${getBackendUrl()}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(mode === "signup" ? { email, password, name } : { email, password }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || "Something went wrong.");

      toast.success(mode === "signup" ? `Welcome, ${data.user.name}.` : "Welcome back.");
      router.push("/camera");
    } catch (err: any) {
      toast.error(err.message || "Failed to sign in.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = () => {
    if (!googleConfigured) {
      toast.error("Google sign-in isn't configured on this server yet.");
      return;
    }
    window.location.href = `${getBackendUrl()}/api/auth/google/login`;
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6 py-16 relative overflow-hidden">

      {/* subtle grid, matches hero section treatment */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.15]">
        {[...Array(8)].map((_, i) => (
          <div key={`h-${i}`} className="absolute h-px bg-white/10 left-0 right-0" style={{ top: `${12.5 * (i + 1)}%` }} />
        ))}
        {[...Array(12)].map((_, i) => (
          <div key={`v-${i}`} className="absolute w-px bg-white/10 top-0 bottom-0" style={{ left: `${8.33 * (i + 1)}%` }} />
        ))}
      </div>

      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-baseline gap-2 group">
            <span className="font-display text-3xl tracking-tight text-white">ForgetMeNot</span>
            <span className="font-mono text-xs text-white/50">AI Memory</span>
          </Link>
        </div>

        <div className="border border-white/10 bg-white/[0.05] backdrop-blur-2xl rounded-3xl p-8 shadow-2xl">
          {/* Mode switch */}
          <div className="grid grid-cols-2 gap-1 p-1 mb-6 rounded-full bg-black/40 border border-white/10">
            <button
              onClick={() => setMode("login")}
              className={`h-9 rounded-full text-sm font-medium transition-all ${
                mode === "login" ? "bg-white text-black" : "text-white/60 hover:text-white"
              }`}
            >
              Log in
            </button>
            <button
              onClick={() => setMode("signup")}
              className={`h-9 rounded-full text-sm font-medium transition-all ${
                mode === "signup" ? "bg-white text-black" : "text-white/60 hover:text-white"
              }`}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === "signup" && (
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <Input
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-black/30 border-white/10 text-sm h-11 rounded-xl pl-10"
                />
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="bg-black/30 border-white/10 text-sm h-11 rounded-xl pl-10"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                className="bg-black/30 border-white/10 text-sm h-11 rounded-xl pl-10"
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="h-11 rounded-xl bg-white hover:bg-neutral-200 text-black font-medium mt-2 flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === "signup" ? "Create account" : "Log in"}
            </Button>

            {mode === "signup" && (
              <p className="flex items-start gap-1.5 text-[11px] text-white/40 leading-relaxed">
                <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Email verification is auto-confirmed in this demo build (no email service is configured yet).
              </p>
            )}
          </form>

          <div className="flex items-center gap-3 my-6">
            <div className="h-px bg-white/10 flex-1" />
            <span className="text-[11px] font-mono text-white/40 uppercase">or</span>
            <div className="h-px bg-white/10 flex-1" />
          </div>

          <button
            onClick={handleGoogle}
            className={`w-full h-11 rounded-xl border border-white/10 flex items-center justify-center gap-3 text-sm font-medium transition-colors ${
              googleConfigured ? "bg-white/5 hover:bg-white/10 text-white" : "bg-white/[0.02] text-white/30 cursor-not-allowed"
            }`}
          >
            <GoogleIcon className="w-4 h-4" />
            Continue with Google
          </button>
          {!googleConfigured && (
            <p className="text-[10px] text-white/30 text-center mt-2 font-mono">
              Google sign-in not configured on this server yet.
            </p>
          )}
        </div>

        <p className="text-center text-xs text-white/30 mt-6">
          <Link href="/" className="hover:text-white/60 transition-colors">Back to landing page</Link>
        </p>
      </div>
    </div>
  );
}
