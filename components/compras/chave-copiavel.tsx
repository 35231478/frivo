"use client";

import { toast } from "@/components/ui/avisos";
import { cn } from "@/lib/utils";
import { chaveEmBlocos } from "@/lib/compras/rotulos";

export const MSG_CHAVE_COPIADA = "Chave copiada.";

/**
 * A chave de acesso da NF-e: clicar no número copia (com o aviso "Chave copiada.") — sem um botão "Copiar" à parte.
 * Um jeito só na lista, na gaveta e na página da nota. Copia só os 44 dígitos (sem os espaços dos blocos).
 */
export function ChaveCopiavel({ chave, linha = false, className }: { chave: string; /** Na lista: uma linha, cortada */ linha?: boolean; className?: string }) {
  async function copiar(e: React.MouseEvent) {
    e.stopPropagation(); // dentro de uma linha que abre a nota: copiar não abre
    try { await navigator.clipboard.writeText(chave.replace(/\D/g, "")); toast(MSG_CHAVE_COPIADA); }
    catch { toast("Não foi possível copiar. Selecione a chave e copie.", "erro"); }
  }
  return (
    <button type="button" onClick={copiar} title="Clicar copia a chave" aria-label={`Copiar a chave de acesso ${chave}`}
      className={cn("font-mono text-left hover:text-primary-700 hover:underline decoration-dotted underline-offset-2 cursor-copy", linha ? "truncate min-w-0 max-w-full" : "break-all text-ink", className)}
      data-chave-copiavel>
      {linha ? chave : chaveEmBlocos(chave)}
    </button>
  );
}
