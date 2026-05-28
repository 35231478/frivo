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
        "w-full bg-white border rounded-lg px-3 py-2.5 text-sm text-ink transition-all resize-y min-h-[80px]",
        "focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10",
        "disabled:bg-surface-alt disabled:text-ink-muted disabled:cursor-not-allowed",
        "placeholder:text-ink-subtle",
        error
          ? "border-red-400 focus:border-red-500 focus:ring-red-500/10"
          : "border-surface-border",
        className
      )}
    />
  )
);
Textarea.displayName = "Textarea";
