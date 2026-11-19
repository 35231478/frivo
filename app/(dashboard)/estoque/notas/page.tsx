import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { exigirModuloNaPagina } from "@/lib/modulos/pagina";
import { pode } from "@/lib/permissoes";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { lerPaginacao, paginaValida } from "@/lib/listagem";
import { listarNotas } from "@/lib/compras/notas";
import { COR_STATUS_NOTA, LABEL_STATUS_NOTA } from "@/lib/compras/rotulos";
import { ImportarNota } from "@/components/compras/importar-nota";
import { ConteudoUrl, ListaUrl, PaginacaoUrl, TabelaProUrl } from "@/components/listagem/lista-url";
import { ListaVazia } from "@/components/listagem/listagem-ui";
import { Dica } from "@/components/ui/dica";
import { PLANILHA } from "@/lib/planilha";

export const metadata: Metadata = { title: "Notas de compra" };

const AJUDA = "O XML da NF-e do fornecedor entra aqui. Ao conciliar, cada item da nota é ligado a um produto do cadastro e, ao lançar, a nota vira entrada no estoque e conta a pagar de uma vez — nos dois lugares com a mesma nota como referência. Nota já lançada não se apaga: o estorno é pela conta a pagar e pelo ajuste de estoque.";

/**
 * Estoque › Notas de compra: importar o XML da NF-e e acompanhar as notas (rota: Estoque › visualizar).
 * Também é a tela do atalho "Lançar a partir de NF" de Financeiro › Contas a pagar (`?de=contas-pagar`).
 */
export default async function NotasCompraPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const doFinanceiro = sp.de === "contas-pagar";
  const u = (await exigirModuloNaPagina("estoque"))!.user!;
  const podeImportar = pode(u.permissoes, "estoque", "gerenciar", u.role);
  const { pagina: pedida, porPagina } = lerPaginacao(sp);
  const { total } = await listarNotas(u.empresaId, { pagina: 1, porPagina: 1 });
  const pagina = paginaValida(pedida, porPagina, total);
  const { notas } = await listarNotas(u.empresaId, { pagina, porPagina });

  return (
    <ListaUrl chave="notas-compra" qAtual="">
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

        <div className="card overflow-hidden">
          <ConteudoUrl>
          {notas.length === 0 ? (
            <ListaVazia mensagem="Nenhuma nota importada ainda. Comece pelo XML da NF-e." />
          ) : (
            <TabelaProUrl
              tela="notas-compra"
              atributos={{ "data-tabela-notas": true }}
              cartoes={
                <ul className="divide-y divide-surface-border" data-cartoes>
                  {notas.map((n) => (
                    <li key={n.id} data-nota={n.id} className="px-4 py-3">
                      <Link href={`/estoque/notas/${n.id}${doFinanceiro ? "?de=contas-pagar" : ""}`} className="font-semibold text-ink hover:text-primary-600">NF {n.numero}/{n.serie}</Link>
                      <p className="text-xs text-ink-muted truncate">{n.emitenteNome}</p>
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <span className="font-semibold tabular-nums">{formatarMoeda(Number(n.valorTotal))}</span>
                        <span className="text-ink-subtle">{formatarData(n.dataEmissao)} · {n._count.itens} itens</span>
                        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", COR_STATUS_NOTA[n.status])}>{LABEL_STATUS_NOTA[n.status]}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              }
              colunas={[
                { id: "nf", titulo: "NF", largura: 120, obrigatoria: true },
                { id: "fornecedor", titulo: "Fornecedor", minimo: 200, obrigatoria: true, classe: "truncate" },
                { id: "emissao", titulo: "Emissão", largura: 104 },
                { id: "valor", titulo: "Valor (R$)", alinhar: "direita", largura: 120, obrigatoria: true },
                { id: "itens", titulo: "Itens", alinhar: "direita", largura: 72 },
                { id: "situacao", titulo: "Situação", largura: 140 },
              ]}
              linhas={notas.map((n) => ({
                id: n.id,
                atributos: { "data-nota": n.id },
                titulos: { fornecedor: n.emitenteNome },
                celulas: {
                  nf: <Link href={`/estoque/notas/${n.id}${doFinanceiro ? "?de=contas-pagar" : ""}`} className={cn(PLANILHA.codigo, "font-semibold text-ink hover:text-primary-600")}>{n.numero}/{n.serie}</Link>,
                  fornecedor: <span className="text-ink-muted">{n.emitenteNome}</span>,
                  emissao: <span className={cn(PLANILHA.data, PLANILHA.apagado)}>{formatarData(n.dataEmissao)}</span>,
                  valor: <span className={cn(PLANILHA.numero, "font-semibold text-ink")}>{formatarMoeda(Number(n.valorTotal))}</span>,
                  itens: <span className="tabular-nums text-ink-muted">{n._count.itens}</span>,
                  situacao: <span className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full", COR_STATUS_NOTA[n.status])}>{LABEL_STATUS_NOTA[n.status]}</span>,
                },
              }))}
            />
          )}
          </ConteudoUrl>
          <div className="px-4 py-3 border-t border-surface-border">
            <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="notas" />
          </div>
        </div>
      </div>
    </ListaUrl>
  );
}
