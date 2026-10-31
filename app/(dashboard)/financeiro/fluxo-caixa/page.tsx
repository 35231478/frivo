import type { Metadata } from "next";
import { recebidoDaConta, saldoDaConta } from "@/lib/financeiro/parcelas";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cn, formatarData, formatarMoeda, nomeMes, MESES_PT, LABELS_STATUS_CONTA_RECEBER, CLASSE_STATUS_CONTA_RECEBER } from "@/lib/utils";
import { TrendingUp } from "lucide-react";
import Link from "next/link";
import { itensAFaturar } from "@/lib/financeiro/a-faturar";
import { Dica } from "@/components/ui/dica";
import { anoBR, chaveDiaCivil, diaDoMesCivil, mesBR } from "@/lib/fuso";

export const metadata: Metadata = { title: "Fluxo de Caixa" };

export default async function FluxoCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; ano?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  if (!pode(session!.user!.permissoes, "financeiro", "fluxoCaixa", session!.user!.role)) redirect("/sem-permissao");
  const empresaId = session!.user!.empresaId;

  const agora = new Date();
  const mes = Number(sp.mes) || mesBR(agora);
  const ano = Number(sp.ano) || anoBR(agora);

  const inicioMes = new Date(ano, mes - 1, 1, 0, 0, 0);
  const fimMes = new Date(ano, mes, 0, 23, 59, 59);

  // Janela dos últimos 6 meses (incluindo o mês selecionado)
  const inicioJanela = new Date(ano, mes - 6, 1, 0, 0, 0);

  const [contasMes, contasJanela, aFaturarTodos] = await Promise.all([
    prisma.contaReceber.findMany({
      // Cobranças: a conta parcelada (o lançamento) fica de fora — as parcelas entram, cada uma no seu mês
      where: { empresaId, dataVencimento: { gte: inicioMes, lte: fimMes }, status: { notIn: ["CANCELADO", "PARCELADO"] } },
      include: { cliente: { select: { nome: true, nomeFantasia: true } } },
      orderBy: { dataVencimento: "asc" },
    }),
    prisma.contaReceber.findMany({
      where: { empresaId, dataVencimento: { gte: inicioJanela, lte: fimMes }, status: { notIn: ["CANCELADO", "PARCELADO"] } },
      select: { valor: true, valorRecebido: true, status: true, dataVencimento: true },
    }),
    // Opção A (P3): orçamentos aprovados ainda sem fatura, no mês da previsão (lib/financeiro/a-faturar)
    itensAFaturar(empresaId, agora),
  ]);
  const chaveMes = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}`;
  const aFaturarMes = aFaturarTodos.filter((i) => i.mes === chaveMes(ano, mes));
  const totalAFaturarMes = aFaturarMes.reduce((acc, i) => acc + i.valor, 0);

  // Cards do mês
  const totalPrevistoMes = contasMes.reduce((acc, c) => acc + Number(c.valor), 0);
  // Baixa parcial: o que entrou vai para "Recebido" e o que falta fica em "A receber"/"Atrasado"
  const totalRecebidoMes = contasMes.reduce((acc, c) => acc + recebidoDaConta(c), 0);
  const totalAReceberMes = contasMes.filter((c) => c.status === "A_RECEBER" || c.status === "PREVISTO").reduce((acc, c) => acc + saldoDaConta(c), 0);
  const totalAtrasadoMes = contasMes.filter((c) => c.status === "ATRASADO").reduce((acc, c) => acc + saldoDaConta(c), 0);

  const cards = [
    { label: "Previsto no mês", valor: totalPrevistoMes, cor: "text-ink", bg: "bg-surface-page" },
    { label: "A receber", valor: totalAReceberMes, cor: "text-primary-700", bg: "bg-primary-50" },
    { label: "Recebido", valor: totalRecebidoMes, cor: "text-success-700", bg: "bg-success-50" },
    { label: "Atrasado", valor: totalAtrasadoMes, cor: "text-atrasado-texto", bg: "bg-atrasado-claro" },
    {
      label: "A faturar (orçamentos aprovados)", valor: totalAFaturarMes, cor: "text-acento", bg: "bg-acento-claro",
      dica: "Orçamentos aprovados ainda sem fatura, no mês da previsão de conclusão da OS (sem OS, o mês corrente). Ainda não são contas: viram conta a receber no Faturar.",
    },
  ] as { label: string; valor: number; cor: string; bg: string; dica?: string }[];

  // Gráfico últimos 6 meses
  const meses: { rotulo: string; previsto: number; recebido: number; aFaturar: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ano, mes - 1 - i, 1);
    const chave = chaveMes(d.getFullYear(), d.getMonth() + 1);
    meses.push({
      rotulo: `${MESES_PT[d.getMonth()].slice(0, 3)}/${String(d.getFullYear()).slice(2)}`, previsto: 0, recebido: 0,
      aFaturar: aFaturarTodos.filter((x) => x.mes === chave).reduce((acc, x) => acc + x.valor, 0),
    });
  }
  for (const c of contasJanela) {
    if (!c.dataVencimento) continue;
    const [va, vm] = chaveDiaCivil(c.dataVencimento).split("-").map(Number); // dia gravado, sem fuso
    const idx = meses.findIndex((_, i) => {
      const ref = new Date(ano, mes - 6 + i, 1);
      return ref.getMonth() + 1 === vm && ref.getFullYear() === va;
    });
    if (idx >= 0) {
      meses[idx].previsto += Number(c.valor);
      meses[idx].recebido += recebidoDaConta(c);
    }
  }
  const maxBar = Math.max(1, ...meses.map((m) => Math.max(m.previsto, m.recebido, m.aFaturar)));

  // Agrupa contas do mês por semana
  const semanas = new Map<number, typeof contasMes>();
  for (const c of contasMes) {
    const dia = c.dataVencimento ? diaDoMesCivil(c.dataVencimento) : 1;
    const semana = Math.min(4, Math.floor((dia - 1) / 7)) + 1;
    const arr = semanas.get(semana) ?? [];
    arr.push(c);
    semanas.set(semana, arr);
  }
  const semanasOrdenadas = [...semanas.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg"><TrendingUp className="w-5 h-5 text-primary-600" /></div>
          <h1 className="page-title">Fluxo de Caixa</h1>
        </div>
        <form method="get" className="flex items-center gap-2">
          <select name="mes" defaultValue={mes} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10">
            {MESES_PT.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <input name="ano" type="number" defaultValue={ano} className="w-24 bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10" />
          <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">Ver</button>
        </form>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1">
        {cards.map((c) => (
          <div key={c.label} className={cn("card p-4", c.bg)} data-card-fluxo={c.label}>
            <p className="text-xs uppercase tracking-wider text-ink-muted flex items-center gap-1">{c.label}{c.dica && <Dica rotulo={c.label} texto={c.dica} />}</p>
            <p className={cn("text-xl font-bold mt-1 tabular-nums", c.cor)}>{formatarMoeda(c.valor)}</p>
          </div>
        ))}
      </div>

      {/* Gráfico previsto vs recebido */}
      <div className="card-padded">
        <h2 className="card-title mb-4">Previsto vs. Recebido vs. A faturar — últimos 6 meses</h2>
        <div className="flex items-end justify-between gap-3 h-56">
          {meses.map((m, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
              <div className="w-full flex items-end justify-center gap-1 h-full">
                <div className="w-1/3 bg-primary-200 rounded-t" style={{ height: `${(m.previsto / maxBar) * 100}%` }} title={`Previsto: ${formatarMoeda(m.previsto)}`} />
                <div className="w-1/3 bg-success-500 rounded-t" style={{ height: `${(m.recebido / maxBar) * 100}%` }} title={`Recebido: ${formatarMoeda(m.recebido)}`} />
                <div className="w-1/3 bg-acento/60 rounded-t" style={{ height: `${(m.aFaturar / maxBar) * 100}%` }} title={`A faturar: ${formatarMoeda(m.aFaturar)}`} data-serie-a-faturar={m.aFaturar} />
              </div>
              <span className="text-[11px] text-ink-muted">{m.rotulo}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-6 mt-4 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary-200" /> Previsto</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success-500" /> Recebido</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-acento/60" /> A faturar (orçamentos aprovados)</span>
        </div>
      </div>

      {/* Orçamentos aprovados a faturar no mês (ainda não são contas) */}
      {aFaturarMes.length > 0 && (
        <div className="card-padded" data-lista-a-faturar>
          <div className="flex items-center justify-between mb-3">
            <h2 className="card-title">A faturar em {nomeMes(mes)}/{ano}</h2>
            <span className="text-sm font-semibold text-ink tabular-nums">{formatarMoeda(totalAFaturarMes)}</span>
          </div>
          <div className="divide-y divide-surface-border border border-surface-border rounded-lg">
            {aFaturarMes.map((i) => (
              <Link key={i.orcamentoId} href={`/orcamentos/${i.orcamentoId}`} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-alt/60" data-item-a-faturar={i.orcamentoId}>
                <div className="min-w-0">
                  <p className="text-sm text-ink font-medium truncate">{i.clienteNome}</p>
                  <p className="text-xs text-ink-muted truncate">{i.codigo} · {i.nome} · {i.origemMes === "OS" ? `previsão da OS ${i.osNumero}` : "sem previsão de OS: mês corrente"}</p>
                </div>
                <span className="font-semibold text-ink tabular-nums shrink-0">{formatarMoeda(i.valor)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Contas do mês agrupadas por semana */}
      <div className="card-padded">
        <h2 className="card-title mb-4">Contas de {nomeMes(mes)}/{ano} por semana</h2>
        {semanasOrdenadas.length === 0 ? (
          <p className="text-sm text-ink-subtle text-center py-8">Nenhuma conta com vencimento neste mês.</p>
        ) : (
          <div className="space-y-5">
            {semanasOrdenadas.map(([semana, contas]) => {
              const totalSemana = contas.reduce((acc, c) => acc + Number(c.valor), 0);
              return (
                <div key={semana}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-bold text-ink-muted uppercase tracking-wider">Semana {semana}</h3>
                    <span className="text-sm font-semibold text-ink">{formatarMoeda(totalSemana)}</span>
                  </div>
                  <div className="divide-y divide-surface-border border border-surface-border rounded-lg">
                    {contas.map((c) => (
                      <div key={c.id} className="flex items-center justify-between px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm text-ink font-medium truncate">{c.cliente.nomeFantasia ?? c.cliente.nome}</p>
                          <p className="text-xs text-ink-muted">{c.numero} · venc. {formatarData(c.dataVencimento)}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={CLASSE_STATUS_CONTA_RECEBER[c.status]}>{LABELS_STATUS_CONTA_RECEBER[c.status]}</span>
                          <span className="font-semibold text-ink">{formatarMoeda(Number(c.valor))}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
