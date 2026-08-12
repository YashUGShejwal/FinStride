import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Mail, Lock, User as UserIcon, ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleIcon } from "@/components/GoogleIcon";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({ component: SignupPage });

function SignupPage() {
  const { signUp, signInWithGoogle } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signUp(email, pw, name);
      toast.success("Account ready");
      nav({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message ?? "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      toast.error(err.message ?? "Google sign-in failed");
      setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <LogoMark className="size-11" />
          <div>
            <h1 className="text-2xl font-display font-semibold tracking-tight">Create account</h1>
            <p className="text-xs text-muted-foreground">Your money, your rules.</p>
          </div>
        </div>

        <div className="glass-strong rounded-2xl p-6 md:p-8">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full h-11 rounded-xl border border-glass-border bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center gap-3 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GoogleIcon className="size-4" />
            {googleLoading ? "Redirecting…" : "Continue with Google"}
          </button>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-glass-border" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
              or continue with email
            </span>
            <div className="h-px flex-1 bg-glass-border" />
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="name" className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
              <div className="relative mt-1.5">
                <UserIcon className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)}
                  className="pl-9 bg-input/40 border-glass-border h-11" placeholder="Your name" />
              </div>
            </div>
            <div>
              <Label htmlFor="email" className="text-xs uppercase tracking-wider text-muted-foreground">Email</Label>
              <div className="relative mt-1.5">
                <Mail className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 bg-input/40 border-glass-border h-11" placeholder="you@domain.com" />
              </div>
            </div>
            <div>
              <Label htmlFor="pw" className="text-xs uppercase tracking-wider text-muted-foreground">Password</Label>
              <div className="relative mt-1.5">
                <Lock className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input id="pw" type="password" required value={pw} onChange={(e) => setPw(e.target.value)}
                  className="pl-9 bg-input/40 border-glass-border h-11" placeholder="Min 6 characters" />
              </div>
            </div>

            <Button type="submit" disabled={loading}
              className="w-full h-11 gradient-accent text-accent-foreground border-0 font-medium gap-2 glow">
              {loading ? "Creating…" : <>Create account <ArrowRight className="size-4" /></>}
            </Button>
          </form>

          <p className="mt-6 text-sm text-center text-muted-foreground">
            Already a member?{" "}
            <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
