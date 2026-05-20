import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Sparkles, Mail, Lock, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, pw);
      toast.success("Welcome back");
      nav({ to: "/dashboard" });
    } catch (err: any) {
      toast.error(err.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="size-11 rounded-2xl gradient-primary grid place-items-center glow">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">FinStride</h1>
            <p className="text-xs text-muted-foreground">Discipline. Runway. Edge.</p>
          </div>
        </div>

        <div className="glass-strong rounded-2xl p-6 md:p-8">
          <h2 className="text-xl font-semibold">Sign in</h2>
          <p className="text-sm text-muted-foreground mt-1">Access your cashflow command deck.</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
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
                  className="pl-9 bg-input/40 border-glass-border h-11" placeholder="••••••••" />
              </div>
            </div>

            <Button type="submit" disabled={loading}
              className="w-full h-11 gradient-primary text-primary-foreground border-0 font-medium gap-2 glow">
              {loading ? "Signing in…" : <>Sign in <ArrowRight className="size-4" /></>}
            </Button>
          </form>

          <p className="mt-6 text-sm text-center text-muted-foreground">
            New here?{" "}
            <Link to="/signup" className="text-primary hover:underline">Create an account</Link>
          </p>
        </div>

        <p className="mt-6 text-[11px] text-center text-muted-foreground">
          Wired for Supabase Auth — email / password.
        </p>
      </div>
    </div>
  );
}
