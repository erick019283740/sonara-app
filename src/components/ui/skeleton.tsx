/**
 * Skeleton Loading Component
 * Smooth loading states for all UI elements
 */

interface Props {
  className?: string;
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ className = "", variant = "rectangular", width, height }: Props) {
  const baseStyles = "animate-pulse bg-zinc-800 rounded";
  
  const variants: Record<string, string> = {
    text: "h-4 w-full",
    circular: "rounded-full",
    rectangular: "rounded-lg",
  };

  const style = {
    width: width !== undefined ? (typeof width === "number" ? `${width}px` : width) : undefined,
    height: height !== undefined ? (typeof height === "number" ? `${height}px` : height) : undefined,
  };

  return (
    <div
      className={`${baseStyles} ${variants[variant]} ${className}`}
      style={style}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="space-y-3 p-4 rounded-xl border border-white/10 bg-zinc-900/50">
      <Skeleton variant="rectangular" height={200} className="w-full" />
      <Skeleton variant="text" width="60%" />
      <Skeleton variant="text" width="40%" />
    </div>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-zinc-900/50">
          <Skeleton variant="circular" width={48} height={48} />
          <div className="flex-1 space-y-2">
            <Skeleton variant="text" width="70%" />
            <Skeleton variant="text" width="40%" />
          </div>
        </div>
      ))}
    </div>
  );
}
