/**
 * Badge Component
 * Small status indicators
 */

import { type ReactNode } from "react";

interface Props {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  className?: string;
}

export function Badge({ children, variant = "default", className = "" }: Props) {
  const variants: Record<string, string> = {
    default: "bg-zinc-700 text-zinc-300",
    success: "bg-green-600/20 text-green-400 border border-green-600/30",
    warning: "bg-yellow-600/20 text-yellow-400 border border-yellow-600/30",
    danger: "bg-red-600/20 text-red-400 border border-red-600/30",
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
