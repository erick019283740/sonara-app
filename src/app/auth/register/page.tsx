/**
 * Register Page
 * Clean UI with role selection
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Card, CardBody } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [selectedRole, setSelectedRole] = useState<"listener" | "artist">("listener");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            role: selectedRole,
          },
        },
      });

      if (error) throw error;

      router.push("/feed");
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Registration failed";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardBody className="space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <h1 className="text-3xl font-bold text-white">Create account</h1>
            <p className="text-zinc-400">Join SONARA</p>
          </div>

          {/* Role Selection */}
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant={selectedRole === "listener" ? "primary" : "secondary"}
              onClick={() => setSelectedRole("listener")}
            >
              Listener
            </Button>
            <Button
              variant={selectedRole === "artist" ? "primary" : "secondary"}
              onClick={() => setSelectedRole("artist")}
            >
              Artist
            </Button>
          </div>

          {/* Form */}
          <form onSubmit={handleRegister} className="space-y-4">
            <Input
              label="Full Name"
              placeholder="John Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
            <Input
              type="email"
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              type="password"
              label="Password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />

            {error && (
              <p className="text-sm text-red-500 text-center">{error}</p>
            )}

            <Button type="submit" fullWidth loading={loading} size="lg">
              Create Account
            </Button>
          </form>

          {/* Footer */}
          <p className="text-center text-sm text-zinc-400">
            Already have an account?{" "}
            <button
              onClick={() => router.push("/auth/login")}
              className="text-violet-400 hover:text-violet-300 transition-colors"
            >
              Sign in
            </button>
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
