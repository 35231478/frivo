"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Phone } from "lucide-react";
import type { InputHTMLAttributes } from "react";

interface PhoneInputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

function limparNumero(num: string) {
  return num.replace(/\D/g, "");
}

export const PhoneInput = forwardRef<HTMLInputElement, PhoneInputProps>(
  ({ className, error, value, defaultValue, ...props }, ref) => {
    const numero = String(value ?? defaultValue ?? "");
    const tel = limparNumero(numero);

    return (
      <div className="relative">
        <input
          ref={ref}
          value={value}
          defaultValue={defaultValue}
          {...props}
          className={cn(
            "w-full border rounded-lg px-3 py-2 pr-10 text-sm bg-white transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-acento focus:border-acento",
            "disabled:opacity-50 disabled:bg-surface-page placeholder:text-ink-muted",
            error ? "border-atrasado focus:ring-atrasado/30" : "border-surface-border",
            className
          )}
        />
        {tel.length >= 8 && (
          <a
            href={`tel:${tel}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-ink-muted hover:text-acento transition-colors"
            title="Ligar"
            tabIndex={-1}
          >
            <Phone className="w-4 h-4" />
          </a>
        )}
      </div>
    );
  }
);
PhoneInput.displayName = "PhoneInput";
