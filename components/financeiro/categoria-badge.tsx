import { cn } from "@/lib/utils";
import { categoriaDaConta, type CategoriaFinanceiraOpcao } from "@/lib/financeiro/categoria";

/**
 * Selo da categoria de uma conta: nome e cor da categoria LIGADA por id (renomear a categoria muda
 * o selo junto); conta antiga sem vínculo mostra o texto que tinha, em cinza.
 */
export function CategoriaBadge({ conta, categorias, linhaUnica }: {
  conta: { categoriaId?: string | null; categoria?: string | null }; categorias: readonly CategoriaFinanceiraOpcao[];
  /** Tabela densa: uma linha só, cortada com "…" (o nome inteiro fica no title) */
  linhaUnica?: boolean;
}) {
  const cat = categoriaDaConta(conta, categorias);
  if (!cat) return <span className="text-ink-subtle">—</span>;
  return (
    <span
      className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full", linhaUnica ? "inline-block max-w-full truncate align-middle" : "inline-flex items-center gap-1")}
      style={{ backgroundColor: `${cat.cor}1a`, color: cat.cor }}
      data-categoria={cat.id ?? "sem-cadastro"}
      title={cat.semCadastro ? "Categoria antiga, sem cadastro: escolha uma categoria na edição" : !cat.ativo ? "Categoria inativa" : linhaUnica ? cat.nome : undefined}
    >
      {cat.nome}{cat.semCadastro ? " (sem cadastro)" : !cat.ativo ? " (inativa)" : ""}
    </span>
  );
}
