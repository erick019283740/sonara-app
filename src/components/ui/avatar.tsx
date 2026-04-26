/**
 * Avatar Component
 * User/Artist avatars with fallback
 */

import Image from "next/image";

interface Props {
  src?: string;
  alt: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

export function Avatar({ src, alt, size = "md", className = "" }: Props) {
  const sizes = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
    xl: "w-24 h-24",
  };

  const initials = alt
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className={`${sizes[size]} rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={alt}
          width={96}
          height={96}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className="text-zinc-400 font-medium">{initials}</span>
      )}
    </div>
  );
}
