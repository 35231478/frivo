import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { cn, formatarData, formatarMoeda, formatarCpfCnpj } from "@/lib/utils";
import { statusVisualPagar, LABELS_STATUS_CONTA_PAGAR } from "@/lib/financeiro-status";
import { Upload, Plus, AlertTriangle, ShoppingCart, FileText, Barcode } from "lucide-react";
import { pode } from "@/lib/permissoes";
import { ContaPagarAcoes } from "@/components/financeiro/conta-pagar-acoes";
import { CategoriaBadge } from "@/components/financeiro/categoria-badge";
import { fornecedorDaConta } from "@/lib/financeiro/fornecedor";
import { whereContasPagar } from "@/lib/listas/filtros";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";
import { ListaUrl, PaginacaoUrl } from "@/components/listagem/lista-url";
import { hojeDiaCivil } from "@/lib/fuso";
import { InputData } from "@/components/ui/input-data";

export const metadata: Metadata = { title: "Contas a Pagar" };

export default async function ContasPagarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { status = "", fornecedor = "", fornecedorId = "", origem = "", dataInicio = "", dataFim = "", categoria = "", centro = "" } = sp;
  const session = await auth();
  if (!pode(session!.user!.permissoes, "financeiro", "visualizar", session!.user!.role)) redirect("/sem-permissao");
  const u = session!.user!;
  const empresaId = u.empresaId;
  // Atalho para a mesma importação de XML do Estoque (importar exige Estoque › gerenciar)
  const podeImportarNf = pode(u.permissoes, "estoque", "gerenciar", u.role);

  const hoje = hojeDiaCivil(); // vencimento é dia civil: vencida só depois do dia de Brasília
  await prisma.contaPagar.updateMany({
    where: { empresaId, status: "PENDENTE", dataVencimento: { lt: hoje } },
    data: { status: "VENCIDO" },
  });

  // UX-4 (E4): o filtro roda no BANCO (where único em whereContasPagar) e a lista é paginada —
  // acabou o corte fixo de 300 em que contas sumiam da tela e dos totais
  const where = whereContasPagar(empresaId, sp) as any;
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);

  const [total, agFiltrado, agVencido, agAberto, categorias, fornecedores, centros] = await Promise.all([
    prisma.contaPagar.count({ where }),
    prisma.contaPagar.aggregate({ where, _sum: { valorTotal: true, valorPago: true } }),
    prisma.contaPagar.aggregate({ where: { ...where, status: "VENCIDO" }, _sum: { saldoRestante: true } }),
    prisma.contaPagar.aggregate({ where: { ...where, status: { in: ["PENDENTE", "PAGO_PARCIAL"] } }, _sum: { saldoRestante: true } }),
    // Todas (ativas e inativas): cor/nome das contas que já usam uma categoria inativa não somem
    prisma.categoriaFinanceira.findMany({ where: { empresaId }, select: { id: true, nome: true, cor: true, ativo: true }, orderBy: { nome: "asc" } }),
    prisma.fornecedor.findMany({ where: { empresaId }, select: { id: true, nome: true, ativo: true }, orderBy: { nome: "asc" } }),
    prisma.centroCusto.findMany({ where: { empresaId }, select: { id: true, nome: true, ativo: true }, orderBy: { nome: "asc" } }),
  ]);
  const pagina = paginaValida(paginaPedida, porPagina, total);
  const contas = total
    ? await prisma.contaPagar.findMany({
        where,
        include: {
          pedidoCompra: { select: { numero: true } }, notaCompra: { select: { id: true, numero: true } },
          centroCusto: { select: { id: true, nome: true, ativo: true } },
          fornecedorCadastro: { select: { id: true, nome: true, documento: true, ativo: true } },
        },
        orderBy: [{ dataVencimento: "asc" }, { criadoEm: "desc" }, { id: "asc" }],
        ...janela(pagina, porPagina),
      })
    : [];

  // Totais do FILTRO inteiro (agregados no banco), não da página visível
  const totalFiltrado = Number(agFiltrado._sum.valorTotal ?? 0);
  const totalPago = Number(agFiltrado._sum.valorPago ?? 0);
  const totalVencido = Number(agVencido._sum.saldoRestante ?? 0);
  const totalAberto = Number(agAberto._sum.saldoRestante ?? 0);

  const inputCls = "bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  return (
    <ListaUrl chave="contas-pagar" paramBusca="fornecedor" qAtual={fornecedor}>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><Upload className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Contas a Pagar</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {podeImportarNf && (
            <Link href="/estoque/notas?de=contas-pagar" data-lancar-nf className="inline-flex items-center gap-2 bg-white border border-surface-border hover:border-primary-300 hover:bg-primary-50/40 text-ink px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm">
              <FileText className="w-4 h-4 text-primary-600" /> Lançar a partir de NF
            </Link>
          )}
          <Link href="/financeiro/contas-pagar/nova" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
            <Plus className="w-4 h-4" /> Nova Conta
          </Link>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get" className="flex flex-wrap gap-2">
            <select name="status" defaultValue={status} className={inputCls}>
              <option value="">Todos status</option>
              {Object.entries(LABELS_STATUS_CONTA_PAGAR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select name="fornecedorId" defaultValue={fornecedorId} className={inputCls} aria-label="Fornecedor cadastrado">
              <option value="">Todos fornecedores</option>
              {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.ativo ? f.nome : `${f.nome} (inativo)`}</option>)}
            </select>
            <input name="fornecedor" defaultValue={fornecedor} placeholder="Buscar fornecedor" className={inputCls} />
            <select name="categoria" defaultValue={categoria} className={inputCls} aria-label="Categoria">
              <option value="">Todas categorias</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.ativo ? c.nome : `${c.nome} (inativa)`}</option>)}
            </select>
            <select name="centro" defaultValue={centro} className={inputCls} aria-label="Centro de custo">
              <option value="">Todos centros de custo</option>
              {centros.map((c) => <option key={c.id} value={c.id}>{c.ativo ? c.nome : `${c.nome} (inativo)`}</option>)}
            </select>
            <select name="origem" defaultValue={origem} className={inputCls}>
              <option value="">Todas origens</option>
              <option value="MANUAL">Manual</option>
              <option value="PEDIDO">Pedido de compra</option>
              <option value="NF">Nota de compra (NF)</option>
            </select>
            <InputData name="dataInicio" defaultValue={dataInicio} title="Vencimento de" />
            <InputData name="dataFim" defaultValue={dataFim} title="Vencimento até" />
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">Filtrar</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Fornecedor</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden xl:table-cell">Descrição</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Categoria</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Total</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Pago</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Saldo</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Vencimento</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Origem</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {contas.length === 0 ? (
                <tr><td colSpan={10} className="text-center text-ink-subtle py-12">Nenhuma conta a pagar encontrada</td></tr>
              ) : (
                contas.map((c) => {
                  const sv = statusVisualPagar(c.status, c.dataVencimento);
                  const forn = fornecedorDaConta(c);
                  return (
                    <tr key={c.id} className={cn("border-b border-surface-border transition-colors", sv.linhaVermelha ? "bg-red-50 hover:bg-red-100/60" : "hover:bg-primary-50/40")}>
                      <td className="px-4 py-3">
                        <Link href={`/financeiro/contas-pagar/${c.id}`} className="text-[11px] font-semibold text-primary-600 hover:underline" data-detalhe-conta={c.numero}>{c.numero}</Link>
                        <p className="font-medium text-ink truncate max-w-[180px]" data-fornecedor={forn.id ?? "sem-cadastro"}>
                          {forn.nome}
                          {!forn.ativo && <span className="ml-1 text-[10px] font-semibold text-ink-muted">(inativo)</span>}
                          {forn.semCadastro && <span className="ml-1 text-[10px] font-semibold text-amber-700" title="Fornecedor só em texto: escolha o cadastro na edição">(sem cadastro)</span>}
                        </p>
                        {forn.documento && <p className="text-xs text-ink-subtle">{formatarCpfCnpj(forn.documento)}</p>}
                      </td>
                      <td className="px-4 py-3 text-ink-muted hidden xl:table-cell truncate max-w-[200px]">{c.descricao}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <CategoriaBadge conta={c} categorias={categorias} />
                        {c.centroCusto && <p className="text-[11px] text-ink-muted mt-0.5" data-centro-custo={c.centroCusto.id}>{c.centroCusto.nome}{!c.centroCusto.ativo && " (inativo)"}</p>}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-ink">{formatarMoeda(Number(c.valorTotal))}</td>
                      <td className="px-4 py-3 text-right text-success-700 hidden md:table-cell">{formatarMoeda(Number(c.valorPago))}</td>
                      <td className="px-4 py-3 text-right font-bold text-ink">{formatarMoeda(Number(c.saldoRestante))}</td>
                      <td className="px-4 py-3 text-ink-muted hidden md:table-cell">
                        {formatarData(c.dataVencimento)}
                        {c.linhaDigitavel && <span className="ml-1.5 inline-flex align-middle text-primary-600" title="Boleto colado: veja no detalhe da conta" data-tem-boleto><Barcode className="w-3.5 h-3.5" /></span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full", sv.classe)}>
                          {sv.linhaVermelha && <AlertTriangle className="w-3 h-3" />}{sv.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {c.notaCompra ? (
                          <Link href={`/estoque/notas/${c.notaCompra.id}`} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full hover:underline"><FileText className="w-3 h-3" /> NF {c.notaCompra.numero}</Link>
                        ) : c.pedidoCompra ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-full"><ShoppingCart className="w-3 h-3" /> Pedido {c.pedidoCompra.numero}</span>
                        ) : (
                          <span className="text-[11px] font-semibold bg-surface-alt text-ink-muted px-2 py-0.5 rounded-full">Manual</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ContaPagarAcoes conta={{ id: c.id, numero: c.numero, fornecedor: forn.nome, valorTotal: Number(c.valorTotal), valorPago: Number(c.valorPago), saldoRestante: Number(c.saldoRestante), status: c.status }} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {contas.length > 0 && (
              <tfoot className="bg-surface-alt border-t border-surface-border">
                <tr className="text-sm">
                  <td colSpan={3} className="px-4 py-3 font-semibold text-ink">Totais do filtro ({total})</td>
                  <td className="px-4 py-3 text-right font-bold text-ink">{formatarMoeda(totalFiltrado)}</td>
                  <td className="px-4 py-3 text-right text-success-700 hidden md:table-cell">{formatarMoeda(totalPago)}</td>
                  <td colSpan={5} className="px-4 py-3">
                    <div className="flex items-center justify-end gap-4 text-xs">
                      <span className="text-red-700 font-semibold">Vencido: {formatarMoeda(totalVencido)}</span>
                      <span className="text-amber-700 font-semibold">Em aberto: {formatarMoeda(totalAberto)}</span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <div className="px-4 py-3 border-t border-surface-border bg-surface-alt/40">
          <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="contas" />
        </div>
      </div>
    </div>
    </ListaUrl>
  );
}
