import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  hint?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({ label, error, required, hint, className, children }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-gray-400">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 pb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function FormGrid({ cols = 2, children }: { cols?: 2 | 3; children: ReactNode }) {
  return (
    <div className={cn("grid gap-4", cols === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
      {children}
    </div>
  );
}
