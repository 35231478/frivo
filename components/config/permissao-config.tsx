"use client";

import { Lock } from "lucide-react";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { cn } from "@/lib/utils";

/**
 * Quem pode GRAVAR nas telas de Configurações: a permissão Configurações › gerenciar (a mesma que as
 * rotas exigem). Sem ela a tela abre para leitura: os botões de gravar, excluir e inativar não
 * aparecem — e o servidor recusa de qualquer jeito (403).
 */
export function usePodeGerenciarConfig(): boolean {
  return usePermissoes().pode("configuracoes", "gerenciar");
}

/** O aviso de tela aberta só para leitura, no lugar dos botões de gravar. */
export function SomenteLeitura({ permissao = "Configurações › gerenciar", className }: { permissao?: string; className?: string }) {
  return (
    <p className={cn("text-sm text-ink-muted flex items-center gap-1.5", className)} data-somente-leitura>
      <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden /> Somente leitura: requer a permissão {permissao}.
    </p>
  );
}

/** Lê o erro que a rota devolveu ({ erro }), ou o texto de reserva. */
export async function erroDaResposta(res: Response, reserva: string): Promise<string> {
  const j = await res.json().catch(() => null);
  return (j && typeof j.erro === "string" && j.erro) || reserva;
}
