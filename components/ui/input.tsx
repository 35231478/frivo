import { cn } from "@/lib/utils";
import type { InputHTMLAttributes } from "react";
import { forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => (
    <input
      ref={ref}
      {...props}
      className={cn(
        "w-full border rounded-lg px-3 py-2 text-sm bg-white transition-colors",
        "focus:outline-none focus:ring-2 focus:ring-frivo-500 focus:border-frivo-500",
        "disabled:opacity-50 disabled:bg-gray-50",
        "placeholder:text-gray-400",
        error ? "border-red-400 focus:ring-red-300" : "border-gray-300",
        className
      )}
    />
  )
);
Input.displayName = "Input";
