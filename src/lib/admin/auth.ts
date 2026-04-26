import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export type AdminUser = {
  id: string;
  email: string | null;
  role: "admin";
};

export class AdminAuthError extends Error {
  public readonly status: number;

  constructor(message: string, status = 403) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

function parseAdminEmails(envValue: string | undefined): Set<string> {
  if (!envValue) return new Set();
  return new Set(
    envValue
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

const ADMIN_EMAILS = parseAdminEmails(process.env.ADMIN_EMAILS);

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

async function isAdminByProfile(userId: string): Promise<boolean> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle<{ role?: string | null }>();

  if (error) {
    // Graceful fallback when profile table is not yet provisioned.
    if (String(error.message || "").toLowerCase().includes("schema cache")) {
      return false;
    }
    return false;
  }
  return String(data?.role ?? "").toLowerCase() === "admin";
}

function isAdminByEmail(email: string | null): boolean {
  if (!email) return false;
  if (ADMIN_EMAILS.size === 0) return false;
  return ADMIN_EMAILS.has(normalizeEmail(email));
}

export async function requireAdminUser(): Promise<AdminUser> {
  const supabase = await createServerSupabase();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AdminAuthError("Unauthorized", 401);
  }

  const allowedByEmail = isAdminByEmail(user.email ?? null);
  const allowedByProfile = await isAdminByProfile(user.id);

  if (!allowedByEmail && !allowedByProfile) {
    throw new AdminAuthError("Forbidden", 403);
  }

  return {
    id: user.id,
    email: user.email ?? null,
    role: "admin",
  };
}

export async function withAdminGuard<T>(
  handler: (ctx: { admin: AdminUser }) => Promise<T>,
): Promise<T> {
  const admin = await requireAdminUser();
  return handler({ admin });
}

export async function requireAdminApi(): Promise<{ admin: AdminUser }> {
  const admin = await requireAdminUser();
  return { admin };
}

export function adminErrorResponse(error: unknown) {
  if (error instanceof AdminAuthError) {
    return NextResponse.json(
      { error: error.message, status: error.status },
      { status: error.status },
    );
  }

  return NextResponse.json(
    { error: "Internal server error", status: 500 },
    { status: 500 },
  );
}
