import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, FileText, Package, Tag } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { cn, formatarData } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { PLANILHA } from "@/lib/planilha";
import { periodoTela } from "@/lib/periodo";
import { extratoProduto } from "@/lib/estoque/servidor";
import { ultimosCustos } from "@/lib/estoque/custo";
import { formatarNcm, rotuloOrigem } from "@/lib/compras/rotulos";
import { formatarDelta, formatarQtd, LABEL_ORIGEM, LABEL_TIPO } from "@/lib/estoque/regras";
import { LancarEstoque } from "@/components/estoque/lancar-estoque";
import { BarraExtrato } from "@/components/estoque/estoque-barra";
import { RecalcularSaldo } from "@/components/estoque/recalcular-saldo";
import { SaldoQtd, SeloSituacao } from "@/components/estoque/situacao";
import { PrecoVenda } from "@/components/estoque/preco-venda";
import { ConteudoUrl, LimparBuscaUrl, ListaUrl, PaginacaoUrl, TabelaProUrl } from "@/components/listagem/lista-url";

export const metadata: Metadata = { title: "Extrato do estoque" };

const dataHora = (d: Date) => formatarData(d, "dd/MM/yyyy, HH:mm"); // Brasília
const moeda = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/**
 * Extrato de um produto (padrão da casa: período + busca/filtros + TabelaPro): cada movimentação
 * (mais recente primeiro) com tipo, quantidade, saldo resultante, origem, quem fez e quando.
 */
export default async function ExtratoEstoquePage({ params, searchParams }: {
  params: Promise<{ produtoId: string }>; searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ produtoId }, sp, session] = await Promise.all([params, searchParams, auth()]);
  const u = session!.user!;
  const extrato = await extratoProduto(u.empresaId, produtoId, sp);
  if (!extrato) notFound();
  const { produto: p, movimentacoes, total, pagina, porPagina, somaRazao, periodo, busca } = extrato;
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
  const filtrado = periodo.tipo !== "todos" || !!busca || !!extrato.tipo || !!extrato.origem;

  return (
    <ListaUrl chave="estoque-extrato" paramBusca="busca" qAtual={busca}>
      <div className="space-y-6">
        <Link href="/estoque" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> Estoque</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-surface-alt rounded-lg"><Package className="w-5 h-5 text-ink-muted" /></div>
            <div className="min-w-0">
              <h1 className="page-title truncate">{p.nome}</h1>
              <p className="text-xs text-ink-muted">Extrato do estoque{!p.ativo && " · produto inativo"}{!p.controlaEstoque && " · não controla estoque"}</p>
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
          <p role="alert" className="flex items-start gap-2 text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> Saldo negativo: saiu mais do que entrou. Confira as entradas ou faça um inventário.
          </p>
        )}
        {somaRazao !== p.saldo && (
          // Não deve acontecer (saldo e lançamento são gravados juntos); se acontecer, fica visível — e quem gerencia corrige pelo histórico
          <div role="alert" data-divergencia className="flex flex-wrap items-center gap-3 text-sm text-atrasado-texto bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">
            <span>O saldo gravado ({formatarQtd(p.saldo)}) não bate com a soma das movimentações ({formatarQtd(somaRazao)}).{!podeLancar && " Avise quem gerencia o estoque."}</span>
            {podeLancar && <RecalcularSaldo produtoId={p.id} unidade={p.unidade} />}
          </div>
        )}

        {/* Período (pela data da movimentação) + busca na observação + tipo/origem — padrão da casa */}
        <BarraExtrato
          periodo={periodoTela(periodo)}
          tipos={Object.entries(LABEL_TIPO).map(([value, label]) => ({ value, label }))}
          origens={Object.entries(LABEL_ORIGEM).map(([value, label]) => ({ value, label }))}
        />

        <div className="card overflow-hidden">
          <ConteudoUrl>
          {movimentacoes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center" data-lista-vazia>
              <p className="text-sm font-medium text-ink">{filtrado ? "Nenhuma movimentação com esses filtros" : "Nenhuma movimentação ainda"}</p>
              <p className="text-xs text-ink-muted">{filtrado ? "Mude o período ou os filtros." : podeLancar ? "Use “Lançar” para a primeira entrada ou um inventário." : "Quando houver entradas ou saídas, elas aparecem aqui."}</p>
              {filtrado && <LimparBuscaUrl />}
            </div>
          ) : (
            <>
              <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
                {movimentacoes.map((m) => (
                  <li key={m.id} data-mov={m.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink">{LABEL_TIPO[m.tipo]} <span className="text-xs font-normal text-ink-muted">· {LABEL_ORIGEM[m.origem]}</span></span>
                      <span className={cn("font-semibold tabular-nums", m.quantidade < 0 ? "text-atrasado" : "text-success-700")}>{formatarDelta(m.quantidade)}</span>
                    </div>
                    <p className="text-xs text-ink-muted mt-0.5">{dataHora(m.data)} · {m.usuario ?? "—"} · saldo <strong className={cn(m.saldoApos < 0 && "text-atrasado")}>{formatarQtd(m.saldoApos)}</strong></p>
                    {m.observacao && <p className="text-xs text-ink-subtle mt-0.5">{m.observacao}</p>}
                  </li>
                ))}
              </ul>
              <div data-tabela-extrato>
                <TabelaProUrl
                  tela="estoque-extrato"
                  colunas={[
                    { id: "data", titulo: "Data", largura: 140, obrigatoria: true },
                    { id: "tipo", titulo: "Tipo", largura: 100, obrigatoria: true },
                    { id: "origem", titulo: "Origem", largura: 130 },
                    { id: "quantidade", titulo: "Quantidade", alinhar: "direita", largura: 110, obrigatoria: true },
                    { id: "saldo", titulo: "Saldo resultante", alinhar: "direita", largura: 130 },
                    { id: "custo", titulo: "Custo unit. (R$)", alinhar: "direita", largura: 120, oculta: true },
                    { id: "usuario", titulo: "Quem fez", largura: 150, classe: "truncate" },
                    { id: "observacao", titulo: "Observação", classe: "truncate" },
                  ]}
                  linhas={movimentacoes.map((m) => ({
                    id: m.id,
                    atributos: { "data-mov": m.id, "data-tipo-mov": m.tipo },
                    titulos: { observacao: m.observacao ?? undefined, usuario: m.usuario ?? undefined },
                    celulas: {
                      data: <span className={cn(PLANILHA.data, "text-ink-muted")}>{dataHora(m.data)}</span>,
                      tipo: <span className="font-medium text-ink">{LABEL_TIPO[m.tipo]}</span>,
                      origem: <span className="text-ink-muted">{LABEL_ORIGEM[m.origem]}</span>,
                      quantidade: <span className={cn(PLANILHA.numero, "font-semibold", m.quantidade < 0 ? "text-atrasado" : "text-success-700")} data-quantidade>{formatarDelta(m.quantidade)}</span>,
                      saldo: <span className={cn(PLANILHA.numero, m.saldoApos < 0 ? "text-atrasado font-semibold" : "text-ink")} data-saldo-apos>{formatarQtd(m.saldoApos)}</span>,
                      custo: <span className={cn(PLANILHA.numero, "text-ink-muted")}>{m.custoUnitario != null ? moeda(m.custoUnitario) : "—"}</span>,
                      usuario: <span className="text-ink-muted">{m.usuario ?? "—"}</span>,
                      observacao: <span className="text-ink-muted">{m.observacao ?? "—"}</span>,
                    },
                  }))}
                />
              </div>
            </>
          )}
          </ConteudoUrl>
          <div className="px-4 py-3 border-t border-surface-border">
            <PaginacaoUrl total={total} pagina={pagina} porPagina={porPagina} rotulo="movimentações" />
          </div>
        </div>
      </div>
    </ListaUrl>
  );
}
