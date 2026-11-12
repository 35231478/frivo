"use client";

import Link from "next/link";
import { ArrowLeft, Eye, Lock, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VersaoRelatorio } from "@/lib/relatorio-os/config";

/** Barra da tela logada do relatório: voltar, trocar a versão (interna × prévia do cliente) e imprimir/PDF. */
export function BarraRelatorioOs({ osId, versao, linkCliente }: { osId: string; versao: VersaoRelatorio; linkCliente: string | null }) {
  const aba = (v: VersaoRelatorio, rotulo: string, Icone: typeof Eye) => (
    <Link
      href={`/ordens/${osId}/relatorio${v === "cliente" ? "?versao=cliente" : ""}`} aria-current={versao === v ? "page" : undefined} data-aba-versao={v}
      className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold", versao === v ? "bg-white text-ink shadow-sm" : "text-ink-muted hover:text-ink")}
    ><Icone className="w-3.5 h-3.5" /> {rotulo}</Link>
  );
  return (
    <div className="print-hide max-w-4xl mx-auto mb-3 flex flex-wrap items-center justify-between gap-2 px-3 sm:px-0">
      <Link href={`/ordens/${osId}`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> Voltar à OS</Link>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex p-1 bg-surface-alt rounded-lg border border-surface-border">
          {aba("interna", "Versão interna", Lock)}
          {aba("cliente", "Versão do cliente", Eye)}
        </div>
        {versao === "cliente" && linkCliente && (
          <a href={linkCliente} target="_blank" rel="noopener" className="text-xs font-medium text-primary-600 hover:underline">Abrir link do cliente</a>
        )}
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 bg-primary-500 hover:bg-primary-600 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
          <Printer className="w-3.5 h-3.5" /> Imprimir / PDF
        </button>
      </div>
    </div>
  );
}
