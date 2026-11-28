import { cn } from "@/lib/utils";
import type { TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";
import { propsDoCampo, useCampo } from "@/components/ui/campo-contexto";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error: errorProp, ...props }, ref) => {
    const { error, ...aria } = propsDoCampo(useCampo(), { error: errorProp, "aria-invalid": props["aria-invalid"], "aria-describedby": props["aria-describedby"] });
    return (
    <textarea
      ref={ref}
      rows={3}
      {...props}
      {...aria}
      className={cn(
        "w-full bg-white border rounded-lg px-3 py-2.5 text-sm text-ink transition-colors resize-y min-h-[80px]",
        "focus:outline-none focus:border-acento focus:ring-4 focus:ring-acento/15",
        "disabled:bg-surface-page disabled:text-ink-muted disabled:cursor-not-allowed",
        "placeholder:text-ink-subtle",
        error
          ? "border-atrasado focus:border-atrasado focus:ring-atrasado/15"
          : "border-surface-campo",
        className
      )}
    />
    );
  }
);
Textarea.displayName = "Textarea";
(Textarea as unknown as { campoDeFormulario: boolean }).campoDeFormulario = true;
