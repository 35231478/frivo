"use client";

import { Download, Printer } from "lucide-react";

/** Rodapé do relatório público da atividade: um botão principal (Baixar PDF) e o imprimir ao lado (não saem na impressão) */
export function AcoesRelatorioAtividade({ pdf }: { pdf: string }) {
  return (
    <div className="max-w-4xl mx-auto mt-4 px-4 md:px-0 flex flex-wrap justify-center gap-3 print-hide" data-acoes-relatorio>
      <a href={pdf} data-baixar-pdf
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-acento px-5 py-2.5 text-sm font-semibold text-white hover:bg-acento-hover">
        <Download className="w-4 h-4" /> Baixar PDF
      </a>
      <button type="button" onClick={() => window.print()} data-imprimir-relatorio
        className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-surface-border bg-white px-5 py-2.5 text-sm font-semibold text-ink hover:bg-surface-alt">
        <Printer className="w-4 h-4" /> Imprimir
      </button>
    </div>
  );
}
