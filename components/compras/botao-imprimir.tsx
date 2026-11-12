"use client";

import { Printer } from "lucide-react";

/** "Imprimir / salvar em PDF" no rodapé do documento público (não sai na impressão) */
export function BotaoImprimir() {
  return (
    <p className="print-hide text-center mt-4">
      <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 bg-acento hover:bg-acento-hover text-white px-4 py-2.5 rounded-lg text-sm font-semibold" data-imprimir-pedido>
        <Printer className="w-4 h-4" /> Imprimir / salvar em PDF
      </button>
    </p>
  );
}
