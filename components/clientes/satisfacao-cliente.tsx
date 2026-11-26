import { Star } from "lucide-react";
import { avaliacoesTexto, mediaTexto, type ResumoSatisfacao } from "@/lib/clientes/satisfacao";

/** Célula da lista: "★ 4,8 (4)" — a média do aceite das OS e quantas avaliações; sem nota, "—". */
export function SatisfacaoCelula({ resumo }: { resumo?: ResumoSatisfacao | null }) {
  if (!resumo || resumo.media == null) return <span className="text-ink-subtle" data-satisfacao="vazia">—</span>;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums" data-satisfacao={resumo.media}
      title={`Média ${mediaTexto(resumo.media)} de 5 em ${avaliacoesTexto(resumo.avaliacoes)} no aceite das OS`}>
      <Star className="w-3.5 h-3.5 text-atencao-texto fill-atencao" aria-hidden />
      <span className="text-ink font-medium">{mediaTexto(resumo.media)}</span>
      <span className="text-ink-muted text-xs">({resumo.avaliacoes})</span>
    </span>
  );
}

/** Na ficha: a média em destaque e de onde vem; sem nota, a frase que diz isso. */
export function SatisfacaoFicha({ resumo }: { resumo?: ResumoSatisfacao | null }) {
  if (!resumo || resumo.media == null) {
    return <p className="text-sm text-ink-muted" data-satisfacao-ficha="vazia">Nenhuma avaliação ainda. A nota vem do aceite das OS, quando o cliente confirma o serviço.</p>;
  }
  const cheias = Math.round(resumo.media);
  return (
    <div className="flex items-center gap-3 flex-wrap" data-satisfacao-ficha={resumo.media}>
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => <Star key={i} className={i < cheias ? "w-4 h-4 text-atencao-texto fill-atencao" : "w-4 h-4 text-surface-border"} />)}
      </span>
      <span className="text-sm text-ink"><strong className="tabular-nums">{mediaTexto(resumo.media)}</strong> de 5 · {avaliacoesTexto(resumo.avaliacoes)} no aceite das OS</span>
    </div>
  );
}
