"use client";

import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { IMPORTACOES, PERMISSOES_EXPORTACAO, type EntidadeImportacao } from "@/lib/importacao/entidades";

/**
 * "Baixar planilha" ao lado do "Importar planilha": o .xlsx de TODOS os registros, nas mesmas colunas
 * da importação (com id_sistema/código) — editar e subir de novo atualiza em vez de duplicar.
 * Aparece para quem vê o módulo da lista (o servidor confere de novo).
 */
export function BaixarPlanilha({ entidade, className }: { entidade: EntidadeImportacao; className?: string }) {
  const { pode } = usePermissoes();
  const req = PERMISSOES_EXPORTACAO[entidade];
  if (req && !req.some(([m, a]) => pode(m, a))) return null;
  return (
    <a
      href={`/api/importacao/${entidade}/exportar`} download
      title={`Baixar a planilha com todos os ${IMPORTACOES[entidade].plural} (mesmo formato da importação)`}
      className={cn(
        "inline-flex items-center justify-center gap-2 shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors",
        "bg-white text-ink border border-surface-border hover:bg-surface-page",
        className,
      )}
      data-acao="baixar-planilha"
    >
      <Download className="w-4 h-4" /> <span className="sm:hidden">Baixar</span><span className="hidden sm:inline">Baixar planilha</span>
    </a>
  );
}
