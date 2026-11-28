import Link from "next/link";
import { cn, formatarDataHora, formatarMoeda } from "@/lib/utils";
import { PLANILHA } from "@/lib/planilha";
import { Dica } from "@/components/ui/dica";
import { RestaurarNota } from "@/components/compras/restaurar-nota";

export interface DescarteDaLista {
  id: string; numero: string; serie: string; emitenteNome: string; valorTotal: number | { toString(): string };
  motivo: string | null; descartadoEm: Date | string; usuario: { nome: string } | null;
  temXml: boolean; restauradaEm: Date | string | null; restauradaPor: string | null; notaRestauradaId: string | null;
}

/**
 * "Notas descartadas" (Estoque › Notas de compra): quem descartou o quê, quando e por quê; e, na que
 * guardou o XML, "Restaurar" (só para quem descarta: Estoque › gerenciar — o servidor confere de novo).
 * A restaurada fica na lista com quem restaurou e quando (a trilha) e o link da nota que voltou.
 */
export function NotasDescartadas({ descartes, podeRestaurar, limite = 20 }: { descartes: DescarteDaLista[]; podeRestaurar: boolean; limite?: number }) {
  if (!descartes.length) return null;
  return (
    <details className="card px-4 py-3 text-sm" data-descartes>
      <summary className="cursor-pointer text-ink-muted font-medium">Notas descartadas ({descartes.length}{descartes.length === limite ? " mais recentes" : ""})</summary>
      <p className="mt-1 text-xs text-ink-muted" data-descartes-recuperar>
        {podeRestaurar ? "Restaurar reimporta a nota pelo XML guardado no descarte." : "Restaurar uma nota descartada é de quem gerencia o estoque."} Descarte antigo, sem o XML: importe o XML de novo.
      </p>
      <ul className="mt-2 divide-y divide-surface-border">
        {descartes.map((d) => (
          <li key={d.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-descarte={d.id}>
            <span className={cn(PLANILHA.codigo, "text-ink")}>NF {d.numero}/{d.serie}</span>
            <span className="text-ink-muted truncate">{d.emitenteNome}</span>
            <span className="tabular-nums text-ink-muted">{formatarMoeda(Number(d.valorTotal))}</span>
            <span className="text-xs text-ink-subtle">Descartada em {formatarDataHora(d.descartadoEm)}{d.usuario && ` por ${d.usuario.nome}`}{d.motivo && ` · ${d.motivo}`}</span>
            <span className="ml-auto inline-flex items-center gap-2">
              {d.restauradaEm ? (
                <span className="text-xs text-ok-texto" data-descarte-restaurada>
                  Restaurada em {formatarDataHora(d.restauradaEm)}{d.restauradaPor && ` por ${d.restauradaPor}`}
                  {d.notaRestauradaId && <> · <Link href={`/estoque/notas/${d.notaRestauradaId}`} className="font-semibold underline">Abrir a nota</Link></>}
                </span>
              ) : !d.temXml ? (
                <span className="inline-flex items-center gap-1 text-xs text-ink-subtle" data-descarte-sem-xml>
                  Sem o XML <Dica texto="Importe o XML de novo: este descarte é de antes de a nota guardar o XML, então não há como restaurar por aqui." rotulo="Restaurar" lado="esquerda" />
                </span>
              ) : podeRestaurar ? (
                <RestaurarNota descarteId={d.id} numero={d.numero} serie={d.serie} />
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
