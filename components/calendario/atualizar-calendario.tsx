"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Atualizar o calendário: busca de novo as OS do período que está na tela (os filtros, o mês e a
 * visão ficam como estão). Enquanto busca, o ícone gira e o botão não aceita outro clique.
 */
export function AtualizarCalendario() {
  const router = useRouter();
  const [buscando, iniciar] = useTransition();
  return (
    <button
      type="button"
      onClick={() => iniciar(() => router.refresh())}
      disabled={buscando}
      aria-busy={buscando}
      aria-label={buscando ? "Atualizando o calendário" : "Atualizar o calendário"}
      title={buscando ? "Atualizando…" : "Atualizar"}
      data-atualizar-calendario
      className={cn(
        "p-2 rounded-lg border border-surface-border text-ink-muted transition-colors",
        buscando ? "bg-surface-alt cursor-progress" : "bg-white hover:bg-surface-alt hover:text-ink",
      )}
    >
      {/* Quem pediu menos animação vê o estado pela cor do ícone e pelo cursor, sem o giro */}
      <RefreshCw className={cn("w-4 h-4", buscando && "animate-spin motion-reduce:animate-none text-primary-600")} aria-hidden />
    </button>
  );
}
