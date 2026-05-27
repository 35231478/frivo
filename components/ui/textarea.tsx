import { cn } from "@/lib/utils";
import type { TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={3}
      {...props}
      className={cn(
        "w-full border rounded-lg px-3 py-2 text-sm bg-white transition-colors resize-y min-h-[80px]",
        "focus:outline-none focus:ring-2 focus:ring-frivo-500 focus:border-frivo-500",
        "disabled:opacity-50 disabled:bg-gray-50",
        "placeholder:text-gray-400",
        error ? "border-red-400 focus:ring-red-300" : "border-gray-300",
        className
      )}
    />
  )
);
Textarea.displayName = "Textarea";
