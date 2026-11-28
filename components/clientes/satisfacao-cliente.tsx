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
