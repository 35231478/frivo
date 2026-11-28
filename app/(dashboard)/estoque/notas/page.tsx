import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { pode } from "@/lib/permissoes";
import { lerPaginacao, paginaValida } from "@/lib/listagem";
import { descartesRecentes, listarNotas } from "@/lib/compras/notas";
import { ImportarNota } from "@/components/compras/importar-nota";
import { LimparBuscaUrl, ListaUrl, PaginacaoUrl } from "@/components/listagem/lista-url";
import { NotasLista } from "@/components/compras/notas-lista";
import { NotasDescartadas } from "@/components/compras/notas-descartadas";
import { periodoNotas } from "@/lib/listas/filtros";
import { periodoTela } from "@/lib/periodo";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { Dica } from "@/components/ui/dica";

export const metadata: Metadata = { title: "Notas de compra" };

const AJUDA = "O XML da NF-e do fornecedor entra aqui. Ao conciliar, cada item da nota é ligado a um produto do cadastro e, ao lançar, a nota vira entrada no estoque e conta a pagar de uma vez — nos dois lugares com a mesma nota como referência. Nota importada por engano e ainda não lançada pode ser descartada na própria nota (fica registrado quem descartou e quando) e restaurada depois, em “Notas descartadas”. Nota já lançada não se apaga: o estorno é pela conta a pagar e pelo ajuste de estoque.";

/**
 * Estoque › Notas de compra: importar o XML da NF-e e acompanhar as notas (rota: Estoque › visualizar).
 * Também é a tela do atalho "Lançar a partir de NF" de Financeiro › Contas a pagar (`?de=contas-pagar`).
 */
export default async function NotasCompraPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const doFinanceiro = sp.de === "contas-pagar";
  const u = (await exigirModuloNaPagina("estoque"))!.user!;
  const podeImportar = pode(u.permissoes, "estoque", "gerenciar", u.role);
  const busca = sp.q ?? "";
  // O período (por emissão ou entrada) também filtra: a lista vazia oferece "Limpar"
  const periodo = periodoNotas(sp);
  const filtrando = !!(busca || sp.status || periodo.tipo !== "todos");
  const { pagina: pedida, porPagina } = lerPaginacao(sp);
  const [{ total }, descartes] = await Promise.all([
    listarNotas(u.empresaId, { pagina: 1, porPagina: 1 }, sp),
    descartesRecentes(u.empresaId),
  ]);
  const pagina = paginaValida(pedida, porPagina, total);
  const { notas } = await listarNotas(u.empresaId, { pagina, porPagina }, sp);

  return (
    <ListaUrl chave="notas-compra" paramBusca="q" qAtual={busca}>
      <div className="space-y-6">
        {doFinanceiro
          ? <Link href="/financeiro/contas-pagar" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink" data-voltar="contas-pagar"><ArrowLeft className="w-4 h-4" /> Contas a pagar</Link>
          : <Link href="/estoque" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> Estoque</Link>}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-alt rounded-lg"><FileText className="w-5 h-5 text-ink-muted" /></div>
          <h1 className="page-title flex items-center gap-1.5">Notas de compra <Dica texto={AJUDA} rotulo="Notas de compra" lado="direita" /></h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        {doFinanceiro && <p className="text-sm text-ink-muted -mt-3">Importe o XML: ao confirmar, a nota vira conta a pagar e entrada no estoque de uma vez.</p>}
        {podeImportar && <ImportarNota de={doFinanceiro ? "contas-pagar" : null} />}

        <NotasLista
          notas={notas} periodo={periodoTela(periodo)} doFinanceiro={doFinanceiro}
          vazio={filtrando
            ? <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
                <p className="text-sm font-medium text-ink">Nenhuma nota encontrada</p>
                {busca && <p className="text-xs text-ink-muted">Nada combina com “{busca}”.</p>}
                <LimparBuscaUrl />
              </div>
            : <ListaVazia mensagem="Nenhuma nota importada ainda. Comece pelo XML da NF-e." />}
          paginacao={<PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="notas" />}
        />

        {/* O registro dos descartes: quem descartou, quando e por quê; "Restaurar" reimporta pelo XML guardado */}
        <NotasDescartadas descartes={descartes} podeRestaurar={podeImportar} />
      </div>
    </ListaUrl>
  );
}
