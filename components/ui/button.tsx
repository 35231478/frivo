import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
}

const variants = {
  primary:   "bg-frivo-600 hover:bg-frivo-700 text-white",
  secondary: "bg-white hover:bg-gray-50 text-gray-700 border border-gray-300",
  ghost:     "hover:bg-gray-100 text-gray-700",
  danger:    "bg-red-600 hover:bg-red-700 text-white",
};

export function Button({
  variant = "primary",
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
        "inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed",
        variants[variant],
        className
      )}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}
