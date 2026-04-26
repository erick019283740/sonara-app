"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type AdminShellProps = {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
};

type AdminNavItem = {
  href: string;
  label: string;
  shortLabel?: string;
};

const ADMIN_NAV: AdminNavItem[] = [
  { href: "/admin", label: "Overview", shortLabel: "Overview" },
  { href: "/admin/streams", label: "Streams", shortLabel: "Streams" },
  { href: "/admin/fraud", label: "Fraud", shortLabel: "Fraud" },
  { href: "/admin/earnings", label: "Earnings", shortLabel: "Earnings" },
  { href: "/admin/trending", label: "Trending", shortLabel: "Trending" },
];

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminShell({
  children,
  title = "Admin Dashboard",
  subtitle = "Real-time platform monitoring and controls",
  actions,
}: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <header className="rounded-2xl border border-white/10 bg-zinc-900/70 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-violet-300">
              SONARA Admin
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">{title}</h1>
            <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </header>

      <nav
        aria-label="Admin navigation"
        className="overflow-x-auto rounded-2xl border border-white/10 bg-zinc-900/50 p-2"
      >
        <ul className="flex min-w-max items-center gap-2">
          {ADMIN_NAV.map((item) => {
            const active = isActive(pathname, item.href);

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={[
                    "inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium transition",
                    active
                      ? "bg-violet-600 text-white shadow-sm shadow-violet-900/40"
                      : "text-zinc-300 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="sm:hidden">{item.shortLabel ?? item.label}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <main className="space-y-6">{children}</main>
    </div>
  );
}
