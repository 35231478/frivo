import Link from "next/link";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { competenciaCurta, type AtrasoMedido } from "@/lib/desempenho/regras";
import { rotuloMotivoAtraso } from "@/lib/os/prazo-execucao";
import { formatarData } from "@/lib/utils";

/** "AAAA-MM-DD" → "dd/mm/aaaa" (dia civil: sem fuso no meio) */
const dia = (chave: string) => `${chave.slice(8, 10)}/${chave.slice(5, 7)}/${chave.slice(0, 4)}`;
const diasDepois = (n: number) => (n === 1 ? "1 dia depois" : `${n} dias depois`);

/** "Prazo 10/11/2026 · concluída em 12/11/2026 (2 dias depois)" */
export const textoDoAtraso = (a: Pick<AtrasoMedido, "prazo" | "concluidaEm" | "dias">) =>
  `Prazo ${dia(a.prazo)} · concluída em ${dia(a.concluidaEm)} (${diasDepois(a.dias)})`;

/** "Justificado por Gabi Gestora em 10/11/2026" — com o que houver ("" = a ficha não recebeu quem nem quando) */
export function textoDeQuemJustificou(a: Pick<AtrasoMedido, "justificadoPor" | "justificadoEm">): string {
  if (!a.justificadoPor && !a.justificadoEm) return "";
  return ["Justificado", a.justificadoPor && `por ${a.justificadoPor}`, a.justificadoEm && `em ${formatarData(a.justificadoEm)}`].filter(Boolean).join(" ");
}

/** Os atrasos do mês separados: os que a gestão justificou (fora da conta) e os que contam. */
export function separarAtrasos(atrasos: AtrasoMedido[] | undefined): { justificados: AtrasoMedido[]; contam: AtrasoMedido[] } {
  const lista = atrasos ?? [];
  return { justificados: lista.filter((a) => !!a.justificado), contam: lista.filter((a) => !a.justificado) };
}

/**
 * Uma lista de atrasos na ficha: a OS, o prazo e o dia em que saiu. No atraso JUSTIFICADO, também o
 * motivo, a explicação e quem justificou — o que a ficha tiver recebido (o app do técnico só recebe
 * o motivo). `comLink`: no painel o número abre a OS (é onde se justifica); no app não há link.
 */
export function ListaDeAtrasos({ atrasos, comLink }: { atrasos: AtrasoMedido[]; comLink: boolean }) {
  return (
    <ul className="divide-y divide-surface-border" data-lista-atrasos>
      {atrasos.map((a) => {
        const quem = textoDeQuemJustificou(a);
        return (
          <li key={a.atividadeId} className="px-4 py-3" data-atraso={a.justificado ? "justificado" : "conta"}>
            {/* o número já diz o que é ("OS-2026-0301", ou o número do chamado) */}
            {comLink
              ? <Link href={`/ordens/${a.ordemServicoId}`} className="text-sm font-medium text-acento hover:underline" data-atraso-os>{a.numeroOs}</Link>
              : <span className="text-sm font-medium text-ink" data-atraso-os>{a.numeroOs}</span>}
            <span className="block text-sm text-ink-muted" data-atraso-texto>{textoDoAtraso(a)}</span>
            {a.justificado && <span className="block text-sm text-ink" data-atraso-motivo>Motivo: {rotuloMotivoAtraso(a.justificado) || a.justificado}</span>}
            {a.justificado && a.explicacao && <span className="block text-sm text-ink-muted whitespace-pre-line break-words" data-atraso-explicacao>{a.explicacao}</span>}
            {a.justificado && quem && <span className="block text-xs text-ink-muted" data-atraso-quem>{quem}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function SemAtrasosJustificados({ competencia }: { competencia: string }) {
  return <ListaVazia mensagem={`Nenhum atraso justificado em ${competenciaCurta(competencia)}.`} />;
}
