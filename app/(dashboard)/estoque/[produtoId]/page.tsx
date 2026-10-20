import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, FileText, Package, Tag } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { extratoProduto } from "@/lib/estoque/servidor";
import { ultimosCustos } from "@/lib/estoque/custo";
import { formatarNcm, rotuloOrigem } from "@/lib/compras/rotulos";
import { formatarDelta, formatarQtd, LABEL_ORIGEM, LABEL_TIPO } from "@/lib/estoque/regras";
import { LancarEstoque } from "@/components/estoque/lancar-estoque";
import { SaldoQtd, SeloSituacao } from "@/components/estoque/situacao";
import { PrecoVenda } from "@/components/estoque/preco-venda";
import { ListaUrl, PaginacaoUrl } from "@/components/listagem/lista-url";

export const metadata: Metadata = { title: "Extrato do estoque" };

const dataHora = (d: Date) => new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Extrato de um produto: cada movimentação (mais recente primeiro) com o saldo que resultou. */
export default async function ExtratoEstoquePage({ params, searchParams }: {
  params: Promise<{ produtoId: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ produtoId }, sp, session] = await Promise.all([params, searchParams, auth()]);
  const u = session!.user!;
  const extrato = await extratoProduto(u.empresaId, produtoId, sp);
  if (!extrato) notFound();
  const { produto: p, movimentacoes, total, pagina, porPagina, somaRazao } = extrato;
  const podeLancar = pode(u.permissoes, "estoque", "gerenciar", u.role);
  const [extra, custos] = await Promise.all([
    prisma.produto.findFirst({
      where: { id: p.id, empresaId: u.empresaId },
      select: { valorPadrao: true, margemVenda: true, ncm: true, cest: true, gtin: true, origemMercadoria: true, unidadeTributavel: true },
    }),
    ultimosCustos(u.empresaId, [p.id]),
  ]);
  const fiscais = [
    ["NCM", formatarNcm(extra?.ncm)], ["CEST", extra?.cest], ["GTIN/EAN", extra?.gtin],
    ["Origem", rotuloOrigem(extra?.origemMercadoria)], ["Unidade tributável", extra?.unidadeTributavel],
  ] as const;

  return (
    <ListaUrl chave="estoque-extrato" qAtual="">
      <div className="space-y-6">
        <Link href="/estoque" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> Estoque</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-primary-50 rounded-lg"><Package className="w-5 h-5 text-primary-600" /></div>
            <div className="min-w-0">
              <h1 className="page-title truncate">{p.nome}</h1>
              <p className="text-xs text-ink-muted">Extrato do estoque{!p.ativo && " · produto inativo"}</p>
            </div>
          </div>
          {podeLancar && <LancarEstoque produto={{ id: p.id, nome: p.nome, unidade: p.unidade, saldo: p.saldo }} />}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="card p-4">
            <p className="text-xs text-ink-muted">Saldo atual</p>
            <SaldoQtd saldo={p.saldo} unidade={p.unidade} situacao={p.situacao} className="text-xl" />
          </div>
          <div className="card p-4">
            <p className="text-xs text-ink-muted">Estoque mínimo</p>
            <p className="text-xl font-semibold text-ink tabular-nums">{p.estoqueMinimo != null ? `${formatarQtd(p.estoqueMinimo)} ${p.unidade}` : "—"}</p>
          </div>
          <div className="card p-4 col-span-2 sm:col-span-1">
            <p className="text-xs text-ink-muted">Situação</p>
            <div className="mt-1.5"><SeloSituacao situacao={p.situacao} /></div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
          <div className="card p-4 xl:col-span-2" data-card-preco>
            <p className="text-sm font-semibold text-ink flex items-center gap-2 mb-3"><Tag className="w-4 h-4 text-primary-600" /> Preço de venda</p>
            <PrecoVenda
              produtoId={p.id} unidade={p.unidade} custo={custos.get(p.id) ?? null}
              preco={extra?.valorPadrao == null ? null : Number(extra.valorPadrao)}
              margemVenda={extra?.margemVenda == null ? null : Number(extra.margemVenda)}
              podeEditar={pode(u.permissoes, "configuracoes", "gerenciar", u.role)}
            />
          </div>
          <div className="card p-4" data-dados-fiscais>
            <p className="text-sm font-semibold text-ink flex items-center gap-2 mb-2"><FileText className="w-4 h-4 text-primary-600" /> Dados fiscais</p>
            <dl className="text-sm space-y-1">
              {fiscais.map(([rotulo, valor]) => (
                <div key={rotulo} className="flex justify-between gap-3"><dt className="text-ink-muted">{rotulo}</dt><dd className="text-ink text-right font-medium">{valor || "—"}</dd></div>
              ))}
            </dl>
            <p className="text-[11px] text-ink-subtle mt-2">Vêm do XML da nota de compra quando o produto é criado ou vinculado por ela.</p>
          </div>
        </div>

        {p.situacao === "negativo" && (
          <p role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> Saldo negativo: saiu mais do que entrou. Confira as entradas ou faça um inventário.
          </p>
        )}
        {somaRazao !== p.saldo && (
          // Não deve acontecer (saldo e lançamento são gravados juntos); se acontecer, fica visível
          <p role="alert" data-divergencia className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            O saldo gravado ({formatarQtd(p.saldo)}) não bate com a soma das movimentações ({formatarQtd(somaRazao)}). Avise o suporte.
          </p>
        )}

        <div className="card overflow-hidden">
          {movimentacoes.length === 0 ? (
            <div className="py-12 text-center" data-lista-vazia>
              <p className="text-sm font-medium text-ink">Nenhuma movimentação ainda</p>
              <p className="text-xs text-ink-muted">{podeLancar ? "Use “Lançar” para a primeira entrada ou um inventário." : "Quando houver entradas ou saídas, elas aparecem aqui."}</p>
            </div>
          ) : (
            <>
              <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
                {movimentacoes.map((m) => (
                  <li key={m.id} data-mov={m.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{LABEL_TIPO[m.tipo]} <span className="text-xs font-normal text-ink-muted">· {LABEL_ORIGEM[m.origem]}</span></span>
                      <span className={cn("font-semibold tabular-nums", m.quantidade < 0 ? "text-red-600" : "text-success-700")}>{formatarDelta(m.quantidade)}</span>
                    </div>
                    <p className="text-xs text-ink-muted mt-0.5">{dataHora(m.data)} · {m.usuario ?? "—"} · saldo <strong className={cn(m.saldoApos < 0 && "text-red-600")}>{formatarQtd(m.saldoApos)}</strong></p>
                    {m.observacao && <p className="text-xs text-ink-subtle mt-0.5">{m.observacao}</p>}
                  </li>
                ))}
              </ul>
              <table className="w-full text-sm hidden md:table">
                <thead className="bg-surface-alt border-b border-surface-border">
                  <tr className="text-left text-ink-muted text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-semibold">Data</th>
                    <th className="px-4 py-3 font-semibold">Tipo</th>
                    <th className="px-4 py-3 font-semibold">Origem</th>
                    <th className="px-4 py-3 font-semibold text-right">Quantidade</th>
                    <th className="px-4 py-3 font-semibold text-right">Saldo resultante</th>
                    <th className="px-4 py-3 font-semibold text-right hidden lg:table-cell">Custo unit.</th>
                    <th className="px-4 py-3 font-semibold">Quem fez</th>
                    <th className="px-4 py-3 font-semibold hidden lg:table-cell">Observação</th>
                  </tr>
                </thead>
                <tbody>
                  {movimentacoes.map((m, idx) => (
                    <tr key={m.id} data-mov={m.id} className={cn("border-b border-surface-border", idx % 2 === 1 && "bg-surface-alt/30")}>
                      <td className="px-4 py-3 text-ink-muted whitespace-nowrap">{dataHora(m.data)}</td>
                      <td className="px-4 py-3 font-medium text-ink">{LABEL_TIPO[m.tipo]}</td>
                      <td className="px-4 py-3 text-ink-muted">{LABEL_ORIGEM[m.origem]}</td>
                      <td className={cn("px-4 py-3 text-right font-semibold tabular-nums", m.quantidade < 0 ? "text-red-600" : "text-success-700")}>{formatarDelta(m.quantidade)}</td>
                      <td className={cn("px-4 py-3 text-right tabular-nums", m.saldoApos < 0 ? "text-red-600 font-semibold" : "text-ink")}>{formatarQtd(m.saldoApos)}</td>
                      <td className="px-4 py-3 text-right text-ink-muted tabular-nums hidden lg:table-cell">{m.custoUnitario != null ? moeda(m.custoUnitario) : "—"}</td>
                      <td className="px-4 py-3 text-ink-muted">{m.usuario ?? "—"}</td>
                      <td className="px-4 py-3 text-ink-muted hidden lg:table-cell max-w-xs truncate" title={m.observacao ?? undefined}>{m.observacao ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="px-4 py-3 border-t border-surface-border">
            <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="movimentações" />
          </div>
        </div>
      </div>
    </ListaUrl>
  );
}
