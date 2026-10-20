import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { lerPaginacao, paginaValida } from "@/lib/listagem";
import { listarNotas } from "@/lib/compras/notas";
import { COR_STATUS_NOTA, LABEL_STATUS_NOTA } from "@/lib/compras/rotulos";
import { ImportarNota } from "@/components/compras/importar-nota";
import { ListaUrl, PaginacaoUrl } from "@/components/listagem/lista-url";

export const metadata: Metadata = { title: "Notas de compra" };


/**
 * Estoque › Notas de compra: importar o XML da NF-e e acompanhar as notas (rota: Estoque › visualizar).
 * Também é a tela do atalho "Lançar a partir de NF" de Financeiro › Contas a pagar (`?de=contas-pagar`).
 */
export default async function NotasCompraPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const doFinanceiro = sp.de === "contas-pagar";
  const u = (await auth())!.user!;
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
          <div className="p-2 bg-primary-50 rounded-lg"><FileText className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Notas de compra</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        {doFinanceiro && <p className="text-sm text-ink-muted -mt-3">Importe o XML: a nota vira conta a pagar (com parcelas, categoria e centro de custo) e entrada no estoque, tudo de uma vez ao confirmar.</p>}
        {podeImportar && <ImportarNota de={doFinanceiro ? "contas-pagar" : null} />}

        <div className="card overflow-hidden">
          {notas.length === 0 ? (
            <div className="py-12 text-center" data-lista-vazia>
              <p className="text-sm font-medium text-ink">Nenhuma nota importada ainda</p>
              <p className="text-xs text-ink-muted">Importe o XML da NF-e: os itens viram entrada no estoque e a nota vira conta a pagar.</p>
            </div>
          ) : (
            <>
              <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
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
              <table className="w-full text-sm hidden md:table">
                <thead className="bg-surface-alt border-b border-surface-border">
                  <tr className="text-left text-ink-muted text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-semibold">NF</th><th className="px-4 py-3 font-semibold">Fornecedor</th>
                    <th className="px-4 py-3 font-semibold">Emissão</th><th className="px-4 py-3 font-semibold text-right">Valor</th>
                    <th className="px-4 py-3 font-semibold text-right">Itens</th><th className="px-4 py-3 font-semibold">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {notas.map((n, i) => (
                    <tr key={n.id} data-nota={n.id} className={cn("border-b border-surface-border hover:bg-primary-50/40", i % 2 === 1 && "bg-surface-alt/30")}>
                      <td className="px-4 py-3"><Link href={`/estoque/notas/${n.id}${doFinanceiro ? "?de=contas-pagar" : ""}`} className="font-semibold text-ink hover:text-primary-600">{n.numero}/{n.serie}</Link></td>
                      <td className="px-4 py-3 text-ink-muted">{n.emitenteNome}</td>
                      <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{formatarData(n.dataEmissao)}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatarMoeda(Number(n.valorTotal))}</td>
                      <td className="px-4 py-3 text-right text-ink-muted">{n._count.itens}</td>
                      <td className="px-4 py-3"><span className={cn("text-[10px] font-semibold px-2.5 py-1 rounded-full", COR_STATUS_NOTA[n.status])}>{LABEL_STATUS_NOTA[n.status]}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="px-4 py-3 border-t border-surface-border">
            <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="notas" />
          </div>
        </div>
      </div>
    </ListaUrl>
  );
}
