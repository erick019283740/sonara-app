/**
 * Reusable Card Component
 * Glassmorphism, rounded corners, clean spacing
 */

import { type ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glass?: boolean;
}

export function Card({ children, className = "", hover = false, glass = false }: Props) {
  const baseStyles = "rounded-xl border border-white/10 bg-zinc-900/50 backdrop-blur-sm";
  const hoverStyles = hover ? "hover:border-white/20 hover:bg-zinc-800/50 transition-all duration-200" : "";
  const glassStyles = glass ? "bg-zinc-900/30 backdrop-blur-md" : "";

  return (
    <div className={`${baseStyles} ${hoverStyles} ${glassStyles} ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 border-b border-white/10 ${className}`}>{children}</div>;
}

export function CardBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

export function CardFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`p-4 border-t border-white/10 ${className}`}>{children}</div>;
}
