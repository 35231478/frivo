"use client";

import { useState } from "react";
import { Copy, Download, Check } from "lucide-react";

export function BoletoAcoes({ boletoUrl, codigoBarras }: { boletoUrl?: string | null; codigoBarras?: string | null }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    if (!codigoBarras) return;
    try { await navigator.clipboard.writeText(codigoBarras); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch {}
  }

  if (!boletoUrl && !codigoBarras) return <span className="text-xs text-ink-subtle">Boleto indisponível</span>;

  return (
    <div className="flex items-center gap-2">
      {boletoUrl && (
        <a href={boletoUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
          <Download className="w-3.5 h-3.5" /> Baixar boleto
        </a>
      )}
      {codigoBarras && (
        <button type="button" onClick={copiar} className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-primary-600">
          {copiado ? <Check className="w-3.5 h-3.5 text-success-600" /> : <Copy className="w-3.5 h-3.5" />} {copiado ? "Copiado!" : "Copiar código"}
        </button>
      )}
    </div>
  );
}
