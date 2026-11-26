"use client";

import { forwardRef } from "react";
import { ListChecks } from "lucide-react";
import { OsAtividades } from "@/components/os/os-atividades";
import { OsVisitas } from "@/components/os/os-visitas";
import { resumoDoPainel } from "@/lib/os/painel-atividades";
import { cn } from "@/lib/utils";

/**
 * O PAINEL DE ATIVIDADES da OS: sempre visível, ao lado das abas no desktop e logo abaixo delas no
 * celular. Cada atividade com o estado (selo), a data/hora agendada, quem executa e a observação
 * curta; "Nova atividade" no topo. É a mesma lista de antes (criar, editar, excluir, mudar o status,
 * executar, equipamentos, formulário): só mudou de lugar. A OS em campanha traz o plano de visitas
 * (progresso, incluir dia, replanejar) no alto do painel, como já era na aba.
 *
 * `destacado`: a tela rolou até aqui por um clique (número-chave, pendência): um realce breve.
 */
export const PainelAtividades = forwardRef<HTMLElement, {
  os: any;
  destacado?: boolean;
  onMudou: () => void;
}>(function PainelAtividades({ os, destacado, onMudou }, ref) {
  const resumo = resumoDoPainel(os.atividades ?? []);
  return (
    <aside
      ref={ref} data-painel-atividades data-destacado={destacado ? "" : undefined} aria-labelledby="titulo-painel-atividades" tabIndex={-1}
      className={cn("bg-white rounded-card border shadow-card scroll-mt-4 transition-shadow outline-none",
        destacado ? "border-acento ring-4 ring-acento/15" : "border-surface-border")}
    >
      {/* Chave da lista: remonta quando uma atividade nasce, some, vira visita ou troca de dia (ela guarda as atividades em estado próprio) */}
      <OsAtividades
        key={(os.atividades ?? []).map((a: any) => `${a.id}:${a.planoVisitasId ?? ""}:${a.dataAgendada ?? ""}`).join("|")}
        osId={os.id} atividades={os.atividades ?? []} clienteId={os.cliente?.id} unidadeId={os.unidadeId} onMudou={onMudou}
        novaNoTopo
        cabecalho={(botaoNova) => (
          <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3 border-b border-surface-linha">
            {/* Título e resumo em duas linhas: lado a lado o painel tem 24rem, e o resumo quebrava no meio */}
            <div className="min-w-0">
              <h2 id="titulo-painel-atividades" className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted uppercase tracking-wider">
                <ListChecks className="w-3.5 h-3.5 text-ink-subtle shrink-0" aria-hidden /> Atividades
              </h2>
              <p className="text-xs font-medium text-ink-muted mt-0.5 truncate" data-resumo-painel>{resumo.texto}</p>
            </div>
            {botaoNova}
          </div>
        )}
        antesDaLista={
          // OS em campanha: as visitas diárias e o progresso somado (cada visita é uma atividade desta lista)
          <OsVisitas osId={os.id} onMudou={onMudou} />
        }
      />
    </aside>
  );
});
