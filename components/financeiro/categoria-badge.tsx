import { categoriaDaConta, type CategoriaFinanceiraOpcao } from "@/lib/financeiro/categoria";

/**
 * Selo da categoria de uma conta: nome e cor da categoria LIGADA por id (renomear a categoria muda
 * o selo junto); conta antiga sem vínculo mostra o texto que tinha, em cinza.
 */
export function CategoriaBadge({ conta, categorias }: { conta: { categoriaId?: string | null; categoria?: string | null }; categorias: readonly CategoriaFinanceiraOpcao[] }) {
  const cat = categoriaDaConta(conta, categorias);
  if (!cat) return <span className="text-ink-subtle">—</span>;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: `${cat.cor}1a`, color: cat.cor }}
      data-categoria={cat.id ?? "sem-cadastro"}
      title={cat.semCadastro ? "Categoria antiga, sem cadastro: escolha uma categoria na edição" : cat.ativo ? undefined : "Categoria inativa"}
    >
      {cat.nome}{cat.semCadastro ? " (sem cadastro)" : !cat.ativo ? " (inativa)" : ""}
    </span>
  );
}
