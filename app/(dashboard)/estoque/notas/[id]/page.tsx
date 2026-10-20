import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileText, Package, Wallet } from "lucide-react";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";
import { cn, formatarCpfCnpj, formatarMoeda } from "@/lib/utils";
import { formatarQtd } from "@/lib/estoque/regras";
import { carregarNota } from "@/lib/compras/notas";
import { chaveDePara, parcelasDaNota, type DuplicataNfe } from "@/lib/compras/nfe";
import { ultimosCustos } from "@/lib/estoque/custo";
import { avisoCusto, formatarFator, mesmaUnidade } from "@/lib/estoque/preco";
import { chaveEmBlocos, COR_STATUS_NOTA, LABEL_STATUS_NOTA } from "@/lib/compras/rotulos";
import { ConciliacaoNota, type ItemConciliacao } from "@/components/compras/conciliacao-nota";

export const metadata: Metadata = { title: "Nota de compra" };

const diaBr = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
/** "19/10/2026 às 22:15" no horário de Brasília (o mesmo do aviso de nota repetida) */
const dataHoraBr = (d: Date) => `${diaBr(d)} às ${d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}`;
const moeda4 = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Nota de compra: antes de lançar = conciliação (de-para); depois = resultado (estoque + contas). */
export default async function NotaCompraPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  const u = session!.user!;
  const nota = await carregarNota(u.empresaId, id);
  if (!nota) notFound();
  const gerencia = pode(u.permissoes, "estoque", "gerenciar", u.role);
  const financeiro = pode(u.permissoes, "financeiro", "fluxoCaixa", u.role);
  const lancada = nota.status === "LANCADA";
  const parcelas = parcelasDaNota({ duplicatas: nota.duplicatas as unknown as DuplicataNfe[], valorTotal: Number(nota.valorTotal), dataEmissao: nota.dataEmissao });

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/estoque/notas" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="w-4 h-4" /> Notas de compra</Link>

      <div className="card p-4 sm:p-5" data-cabecalho-nota>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 bg-primary-50 rounded-lg shrink-0"><FileText className="w-5 h-5 text-primary-600" /></div>
            <div className="min-w-0">
              <h1 className="page-title">NF {nota.numero}/{nota.serie}</h1>
              <p className="text-sm text-ink">{nota.fornecedor.nome}</p>
              <p className="text-xs text-ink-muted">CNPJ {formatarCpfCnpj(nota.emitenteCnpj)} · emitida em {diaBr(nota.dataEmissao)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums text-ink">{formatarMoeda(Number(nota.valorTotal))}</p>
            <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full", COR_STATUS_NOTA[nota.status])} data-status-nota={nota.status}>{LABEL_STATUS_NOTA[nota.status]}</span>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-ink-muted">Chave de acesso <span className="font-mono text-ink break-all">{chaveEmBlocos(nota.chaveAcesso)}</span></p>
        <p className="text-[11px] text-ink-subtle">Importada em {dataHoraBr(nota.criadoEm)}{nota.usuario && ` por ${nota.usuario.nome}`}{nota.lancadaEm && ` · lançada em ${dataHoraBr(nota.lancadaEm)}`}</p>
      </div>

      {lancada ? <Resultado nota={nota} movs={await entradasDaNota(u.empresaId, nota.id)} avisos={await avisosDeCusto(u.empresaId, nota)} /> : gerencia ? (
        <ConciliacaoNota
          notaId={nota.id}
          itens={await itensParaConciliar(u.empresaId, nota)}
          pedidos={financeiro ? await pedidosAbertos(u.empresaId) : []}
          podeLancar={financeiro}
          motivoSemLancar={financeiro ? null : "Lançar gera conta a pagar: precisa de Financeiro › fluxo de caixa. Você pode salvar os vínculos."}
          parcelas={parcelas.map((p) => ({ numero: p.numero, vencimento: diaBr(p.vencimento), valor: p.valor }))}
          podePrecificar={pode(u.permissoes, "configuracoes", "gerenciar", u.role)}
        />
      ) : (
        <ItensSomenteLeitura nota={nota} />
      )}
    </div>
  );
}

type Nota = NonNullable<Awaited<ReturnType<typeof carregarNota>>>;

async function itensParaConciliar(empresaId: string, nota: Nota): Promise<ItemConciliacao[]> {
  const deParas = await prisma.deParaProdutoFornecedor.findMany({
    where: { empresaId, fornecedorId: nota.fornecedorId, codigoFornecedor: { in: nota.itens.map((i) => chaveDePara(i.codigoFornecedor)) } },
    select: { codigoFornecedor: true, produtoId: true, unidadeOrigem: true, fatorConversao: true },
  });
  const aprendido = new Map(deParas.map((d) => [d.codigoFornecedor, d]));
  // último custo de compra de cada produto (fora desta nota): base do aviso "o custo mudou"
  const custos = await ultimosCustos(empresaId, nota.itens.flatMap((i) => (i.produtoId ? [i.produtoId] : [])), { excetoNotaId: nota.id });
  return nota.itens.map((i) => {
    const dp = aprendido.get(chaveDePara(i.codigoFornecedor));
    const p = i.produto;
    return {
      id: i.id, numeroItem: i.numeroItem, codigoFornecedor: i.codigoFornecedor, descricaoFornecedor: i.descricaoFornecedor,
      unidade: i.unidade, quantidade: Number(i.quantidade), valorUnitario: Number(i.valorUnitario), valorTotal: Number(i.valorTotal),
      fiscal: { ncm: i.ncm, cest: i.cest, gtin: i.gtin, origemMercadoria: i.origem, unidadeTributavel: i.unidadeTributavel },
      fator: Number(i.fatorConversao),
      fatorAprendido: dp && dp.produtoId === i.produtoId ? { unidade: dp.unidadeOrigem, fator: Number(dp.fatorConversao) } : null,
      produto: p ? {
        id: p.id, nome: p.nome, unidade: p.unidade, preco: p.valorPadrao == null ? null : Number(p.valorPadrao),
        margemVenda: p.margemVenda == null ? null : Number(p.margemVenda), custo: custos.get(p.id) ?? null,
        fiscal: { ncm: p.ncm, cest: p.cest, gtin: p.gtin, origemMercadoria: p.origemMercadoria, unidadeTributavel: p.unidadeTributavel },
      } : null,
      aprendido: !!i.produtoId && dp?.produtoId === i.produtoId,
    };
  });
}

/** Pedidos que ainda podem receber esta nota: abertos e sem conta a pagar */
async function pedidosAbertos(empresaId: string) {
  return prisma.pedidoCompraInterno.findMany({
    where: { empresaId, status: { in: ["SOLICITADO", "COTANDO", "COMPRADO"] }, contasPagar: { none: {} } },
    select: { id: true, numero: true }, orderBy: { criadoEm: "desc" }, take: 50,
  });
}

function ItensSomenteLeitura({ nota }: { nota: Nota }) {
  return (
    <div className="card overflow-hidden">
      <ul className="divide-y divide-surface-border">
        {nota.itens.map((i) => (
          <li key={i.id} className="px-4 py-3 text-sm flex flex-wrap justify-between gap-2" data-item={i.numeroItem}>
            <span>{i.numeroItem}. {i.descricaoFornecedor} <span className="text-ink-muted">· {formatarQtd(Number(i.quantidade))} {i.unidade}</span></span>
            <span className="text-ink-muted">{i.produto ? `→ ${i.produto.nome}` : "sem produto"}</span>
          </li>
        ))}
      </ul>
      <p className="px-4 py-3 text-xs text-ink-muted border-t border-surface-border">Só quem gerencia o Estoque concilia e lança a nota.</p>
    </div>
  );
}

/** Entradas no estoque geradas por esta nota (origem COMPRA, refId = nota) */
async function entradasDaNota(empresaId: string, notaId: string) {
  return prisma.movimentacaoEstoque.findMany({
    where: { empresaId, origem: "COMPRA", refId: notaId },
    orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
    select: { id: true, quantidade: true, custoUnitario: true, saldoApos: true, produto: { select: { id: true, nome: true, unidade: true } } },
  });
}

/** Custo da nota ≠ compra anterior: só aviso (o preço não muda sozinho) */
async function avisosDeCusto(empresaId: string, nota: Nota) {
  const comProduto = nota.itens.filter((i) => i.produto);
  const antes = await ultimosCustos(empresaId, comProduto.map((i) => i.produtoId!), { excetoNotaId: nota.id, antesDe: nota.lancadaEm });
  return comProduto.flatMap((i) => {
    const p = i.produto!;
    const a = avisoCusto({
      produtoId: p.id, produto: p.nome, unidade: p.unidade, custoAnterior: antes.get(p.id),
      custoNovo: Math.round((Number(i.valorUnitario) / Number(i.fatorConversao)) * 1e4) / 1e4,
      preco: p.valorPadrao == null ? null : Number(p.valorPadrao), margemAlvo: p.margemVenda == null ? null : Number(p.margemVenda),
    });
    return a ? [a] : [];
  });
}

function Resultado({ nota, movs, avisos }: { nota: Nota; movs: Awaited<ReturnType<typeof entradasDaNota>>; avisos: Awaited<ReturnType<typeof avisosDeCusto>> }) {
  const convertidos = nota.itens.filter((i) => i.produto && (Number(i.fatorConversao) !== 1 || !mesmaUnidade(i.unidade, i.produto.unidade)));
  const totalContas = nota.contasPagar.reduce((t, c) => t + Number(c.valorTotal), 0);
  return (
    <div className="space-y-4" data-resultado>
      <p className="flex items-center gap-2 text-sm font-semibold text-success-700 bg-success-50 border border-success-200 rounded-lg px-3 py-2">
        <CheckCircle2 className="w-4 h-4" /> Nota lançada: {movs.length} entrada(s) no estoque e {nota.contasPagar.length} conta(s) a pagar.
      </p>
      {convertidos.length > 0 && (
        <div className="text-xs text-primary-800 bg-primary-50 border border-primary-200 rounded-lg px-3 py-2 space-y-0.5" data-conversoes>
          {convertidos.map((i) => (
            <p key={i.id}>{i.produto!.nome}: 1 {i.unidade} = {formatarFator(Number(i.fatorConversao))} {i.produto!.unidade} — {formatarQtd(Number(i.quantidade))} {i.unidade} entraram como {formatarQtd(Number(i.quantidade) * Number(i.fatorConversao))} {i.produto!.unidade}.</p>
          ))}
        </div>
      )}
      {avisos.length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1" data-avisos-custo>
          {avisos.map((a) => (
            <p key={a.produtoId} className="flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /> <span><strong>{a.produto}</strong> — {a.texto} <Link href={`/estoque/${a.produtoId}`} className="font-semibold text-primary-700 hover:underline">Ver preço</Link></span></p>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card overflow-hidden">
          <p className="px-4 py-3 border-b border-surface-border text-sm font-semibold flex items-center gap-2"><Package className="w-4 h-4 text-primary-600" /> Entradas no estoque (custo da NF)</p>
          <ul className="divide-y divide-surface-border text-sm">
            {movs.map((m) => (
              <li key={m.id} className="px-4 py-2.5 flex justify-between gap-3" data-entrada={m.produto.id}>
                <div className="min-w-0">
                  <Link href={`/estoque/${m.produto.id}`} className="font-medium text-ink hover:text-primary-600 truncate block">{m.produto.nome}</Link>
                  <p className="text-xs text-ink-muted tabular-nums">+{formatarQtd(Number(m.quantidade))} {m.produto.unidade} × {m.custoUnitario != null ? moeda4(Number(m.custoUnitario)) : "—"}</p>
                </div>
                <p className="text-xs text-ink-muted text-right shrink-0">saldo<br /><span className="font-semibold text-ink tabular-nums">{formatarQtd(Number(m.saldoApos))}</span></p>
              </li>
            ))}
          </ul>
        </div>
        <div className="card overflow-hidden">
          <p className="px-4 py-3 border-b border-surface-border text-sm font-semibold flex items-center gap-2"><Wallet className="w-4 h-4 text-primary-600" /> Contas a pagar · {formatarMoeda(totalContas)}</p>
          <ul className="divide-y divide-surface-border text-sm">
            {nota.contasPagar.map((c) => (
              <li key={c.id} className="px-4 py-2.5 flex justify-between gap-3" data-conta={c.numero}>
                <div><p className="font-medium text-ink">{c.numero}</p><p className="text-xs text-ink-muted">{c.descricao} · vence {c.dataVencimento ? diaBr(c.dataVencimento) : "—"}</p></div>
                <p className="font-semibold tabular-nums">{formatarMoeda(Number(c.valorTotal))}</p>
              </li>
            ))}
          </ul>
          {nota.pedidoCompra && <p className="px-4 py-2.5 border-t border-surface-border text-xs text-ink-muted">Pedido de compra <Link href={`/compras/pedidos/${nota.pedidoCompra.id}`} className="font-semibold text-primary-600 hover:underline">{nota.pedidoCompra.numero}</Link>: custo real atualizado nos itens.</p>}
        </div>
      </div>
    </div>
  );
}
