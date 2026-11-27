import { cn } from "@/lib/utils";
import { LABEL_COMPORTAMENTO, type Comportamento } from "@/lib/estoque/categoria";

const COR: Record<Comportamento, string> = {
  VENDA_A_PARTE: "bg-acento-claro text-acento",
  INCLUSO_NO_SERVICO: "bg-surface-alt text-ink-muted",
};

/** Pílula do comportamento de faturamento (lista de categorias e de produtos). */
export function PilulaComportamento({ comportamento, className }: { comportamento: Comportamento; className?: string }) {
  return (
    <span data-comportamento={comportamento} className={cn("inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap", COR[comportamento], className)}>
      {LABEL_COMPORTAMENTO[comportamento]}
    </span>
  );
}

/**
 * Categoria do produto na lista: só o nome (sem categoria: "Sem categoria" apagado). "Orçamento E": quem diz se é
 * Material ou Peça é a coluna Uso (o Uso do produto manda); a categoria só sugere o Uso de um produto novo — por isso
 * a pílula do comportamento não aparece mais aqui (mostrava "Material" ao lado de um produto de Uso "Peça").
 */
export function CategoriaDoProduto({ produto }: { produto: { categoriaProduto?: { nome: string; comportamento: string; ativo?: boolean | null } | null } }) {
  const c = produto.categoriaProduto;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0" data-categoria-produto={c ? "sim" : "nao"}>
      {c ? (
        <span className={cn("truncate", c.ativo === false && "text-ink-muted")} title={c.ativo === false ? `${c.nome} (inativa)` : c.nome}>{c.nome}{c.ativo === false && " (inativa)"}</span>
      ) : (
        <span className="text-ink-subtle italic">Sem categoria</span>
      )}
    </span>
  );
}
