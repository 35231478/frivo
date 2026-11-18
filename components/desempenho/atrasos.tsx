import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { competenciaCurta, type AtrasoMedido } from "@/lib/desempenho/regras";
import { rotuloMotivoAtraso } from "@/lib/os/prazo-execucao";

/** "AAAA-MM-DD" → "dd/mm/aaaa" (dia civil: sem fuso no meio) */
const dia = (chave: string) => `${chave.slice(8, 10)}/${chave.slice(5, 7)}/${chave.slice(0, 4)}`;
const diasDepois = (n: number) => (n === 1 ? "1 dia depois" : `${n} dias depois`);

/** "Prazo 10/11/2026 · concluída em 12/11/2026 (2 dias depois)" */
export const textoDoAtraso = (a: Pick<AtrasoMedido, "prazo" | "concluidaEm" | "dias">) =>
  `Prazo ${dia(a.prazo)} · concluída em ${dia(a.concluidaEm)} (${diasDepois(a.dias)})`;

/** Quantos contam e quantos ficaram fora: "2 contam · 1 justificado" */
export function resumoDosAtrasos(atrasos: Pick<AtrasoMedido, "justificado">[]): string {
  const justificados = atrasos.filter((a) => a.justificado).length;
  const contam = atrasos.length - justificados;
  return [
    contam ? (contam === 1 ? "1 conta" : `${contam} contam`) : "",
    justificados ? (justificados === 1 ? "1 justificado" : `${justificados} justificados`) : "",
  ].filter(Boolean).join(" · ");
}

/**
 * ATRASOS DO MÊS na ficha: as atividades concluídas depois do prazo (o prazo, o dia em que saiu e
 * quantos dias depois), na ordem em que foram concluídas. A que a gestão justificou na OS
 * aparece como "Justificado" com o motivo — está FORA da conta do "no prazo". As demais contam.
 * `comLink`: no painel o número abre a OS (é onde se justifica); no app do técnico não há link.
 */
export function ListaDeAtrasos({ atrasos, comLink }: { atrasos: AtrasoMedido[]; comLink: boolean }) {
  return (
    <ul className="divide-y divide-surface-border" data-lista-atrasos>
      {atrasos.map((a) => (
        <li key={a.atividadeId} className="px-4 py-3 flex items-start justify-between gap-3" data-atraso={a.justificado ? "justificado" : "conta"}>
          <span className="min-w-0">
            {/* o número já diz o que é ("OS-2026-0301", ou o número do chamado) */}
            {comLink
              ? <Link href={`/ordens/${a.ordemServicoId}`} className="text-sm font-medium text-acento hover:underline" data-atraso-os>{a.numeroOs}</Link>
              : <span className="text-sm font-medium text-ink" data-atraso-os>{a.numeroOs}</span>}
            <span className="block text-sm text-ink-muted" data-atraso-texto>{textoDoAtraso(a)}</span>
            {a.justificado && <span className="block text-xs text-ink-muted" data-atraso-motivo>Motivo: {rotuloMotivoAtraso(a.justificado) || a.justificado}</span>}
          </span>
          <span className="shrink-0"><StatusPill tom={a.justificado ? "previsto" : "atrasado"} tamanho="sm">{a.justificado ? "Justificado" : "Conta"}</StatusPill></span>
        </li>
      ))}
    </ul>
  );
}

export function AtrasosVazios({ competencia }: { competencia: string }) {
  return <ListaVazia mensagem={`Nenhuma atividade concluída com atraso em ${competenciaCurta(competencia)}.`} />;
}
