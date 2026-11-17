"use client";

import Link from "next/link";
import { FolderOutput } from "lucide-react";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { cn } from "@/lib/utils";

/** O endereço do Novo envio já com o cliente (e, se houver, o contrato) escolhido. */
export function hrefNovoEnvio(clienteId: string, contratoId?: string | null): string {
  const q = new URLSearchParams({ clienteId, ...(contratoId ? { contratoId } : {}) });
  return `/documentacao-equipe/novo?${q}`;
}

/**
 * ATALHO "Enviar documentação da equipe" na ficha do cliente e do contrato: abre o Novo envio com
 * aquele cliente já selecionado, sem passar pelo menu.
 *
 * Só aparece para quem tem "Documentos › Enviar ao cliente" — a mesma permissão que a página de
 * destino e as rotas conferem de novo. É um atalho discreto de propósito: o cabeçalho da ficha já
 * tem as ações principais dela.
 */
export function AtalhoDocumentacao({ clienteId, contratoId, compact = false }: {
  clienteId: string | null | undefined;
  contratoId?: string | null;
  compact?: boolean;
}) {
  const { pode } = usePermissoes();
  if (!clienteId || !pode("documentos", "enviar")) return null;
  return (
    <Link
      href={hrefNovoEnvio(clienteId, contratoId)} data-atalho-documentacao title="Enviar documentação da equipe"
      className={cn(
        "inline-flex items-center gap-1.5 font-medium text-ink-muted hover:text-primary-600 hover:bg-surface-alt rounded-lg whitespace-nowrap",
        compact ? "text-xs px-2 py-1.5" : "text-sm px-3 py-2.5",
      )}
    >
      <FolderOutput className="w-4 h-4" aria-hidden />
      <span className={compact ? "hidden xl:inline" : ""}>Enviar documentação da equipe</span>
      <span className={compact ? "xl:hidden" : "hidden"}>Documentação</span>
    </Link>
  );
}
