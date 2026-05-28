import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "success" | "outline" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

const variants = {
  primary:   "bg-primary-500 text-white hover:bg-primary-600 active:bg-primary-700 shadow-sm hover:shadow",
  success:   "bg-success-500 text-white hover:bg-success-600 active:bg-success-700 shadow-sm hover:shadow",
  outline:   "bg-white border border-primary-500 text-primary-600 hover:bg-primary-50",
  secondary: "bg-white text-ink border border-surface-border hover:bg-surface-alt",
  ghost:     "text-ink hover:bg-surface-alt",
  danger:    "bg-red-500 text-white hover:bg-red-600 shadow-sm",
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
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed focus:outline-none focus:ring-4 focus:ring-primary-500/20",
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
