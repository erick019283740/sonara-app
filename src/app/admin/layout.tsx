import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { requireAdminUser } from "@/lib/admin/auth";

type AdminLayoutProps = {
  children: ReactNode;
};

export default async function AdminLayout({ children }: AdminLayoutProps) {
  try {
    await requireAdminUser();
  } catch {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </div>
    </div>
  );
}
