"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

export function AutoPrint() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, []);

  return (
    <p className="print-hide text-center text-xs text-ink-muted mt-4">
      Não imprimiu automaticamente?{" "}
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-1 text-primary-600 hover:underline font-semibold"
      >
        <Printer className="w-3.5 h-3.5" /> Clique aqui para imprimir
      </button>
    </p>
  );
}
