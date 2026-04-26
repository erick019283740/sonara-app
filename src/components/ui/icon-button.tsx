/**
 * Icon Button Component
 * Clean, minimal icon buttons with hover states
 */

import { forwardRef, type ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "ghost" | "solid";
  size?: "sm" | "md" | "lg";
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "ghost", size = "md", className = "", children, ...props }, ref) => {
    const baseStyles = "rounded-full flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-violet-500";
    
    const variants: Record<string, string> = {
      ghost: "hover:bg-zinc-800 text-zinc-400 hover:text-white",
      solid: "bg-violet-600 hover:bg-violet-700 text-white",
    };

    const sizes: Record<string, string> = {
      sm: "p-1.5",
      md: "p-2",
      lg: "p-3",
    };

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

IconButton.displayName = "IconButton";
