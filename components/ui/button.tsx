import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "success" | "outline" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

// Sistema de design: primário = acento sólido; secundário = borda; fantasma = só texto.
// "outline" é o secundário com texto no acento (ação destacada sem competir com o primário).
const variants = {
  primary:   "bg-acento text-white hover:bg-acento-hover",
  success:   "bg-ok text-white hover:bg-success-600",
  outline:   "bg-white border border-surface-border text-acento hover:bg-acento-claro hover:border-acento/40",
  secondary: "bg-white text-ink border border-surface-border hover:bg-surface-page",
  ghost:     "text-ink-muted hover:text-ink hover:bg-surface-page",
  danger:    "bg-atrasado text-white hover:brightness-95",
};

const sizes = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-5 py-3 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-acento focus-visible:ring-offset-2",
        sizes[size],
        variants[variant],
        className
      )}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}
