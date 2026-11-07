import { cn } from "@/lib/utils";
import { comportamentoDoProduto, LABEL_COMPORTAMENTO, type Comportamento } from "@/lib/estoque/categoria";

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
 * Categoria do produto na lista: o nome + a pílula do comportamento. Sem categoria: "Sem categoria"
 * apagado, com a pílula "Incluso no serviço" (o padrão) marcada como padrão — o que o orçamento vai
 * sinalizar quando a E3.3 chegar.
 */
export function CategoriaDoProduto({ produto }: { produto: { categoriaProduto?: { nome: string; comportamento: string; ativo?: boolean | null } | null } }) {
  const c = produto.categoriaProduto;
  const comportamento = comportamentoDoProduto(produto);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 min-w-0" data-categoria-produto={c ? "sim" : "nao"}>
      {c ? (
        <span className={cn("truncate", c.ativo === false && "text-ink-muted")} title={c.ativo === false ? `${c.nome} (inativa)` : c.nome}>{c.nome}{c.ativo === false && " (inativa)"}</span>
      ) : (
        <span className="text-ink-subtle italic">Sem categoria</span>
      )}
      {" "}
      <PilulaComportamento comportamento={comportamento} className={cn(!c && "opacity-70")} />
      {!c && <>{" "}<span className="text-[10px] text-ink-subtle">(padrão)</span></>}
    </span>
  );
}
