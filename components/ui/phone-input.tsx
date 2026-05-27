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
            "focus:outline-none focus:ring-2 focus:ring-frivo-500 focus:border-frivo-500",
            "disabled:opacity-50 disabled:bg-gray-50 placeholder:text-gray-400",
            error ? "border-red-400 focus:ring-red-300" : "border-gray-300",
            className
          )}
        />
        {tel.length >= 8 && (
          <a
            href={`tel:${tel}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-blue-600 transition-colors"
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
