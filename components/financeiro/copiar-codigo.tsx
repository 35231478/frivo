"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Botão "Copiar" de um código (linha digitável, código de barras) — para colar no app do banco. */
export function CopiarCodigo({ texto, rotulo = "Copiar" }: { texto: string; rotulo?: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try { await navigator.clipboard.writeText(texto); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch { /* sem permissão de área de transferência */ }
  }
  return (
    <button type="button" onClick={copiar} className="inline-flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 shrink-0" data-copiar={rotulo}>
      {copiado ? <Check className="w-3.5 h-3.5 text-success-600" /> : <Copy className="w-3.5 h-3.5" />} {copiado ? "Copiado!" : rotulo}
    </button>
  );
}
