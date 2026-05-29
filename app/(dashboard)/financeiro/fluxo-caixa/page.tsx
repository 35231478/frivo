import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cn, formatarData, formatarMoeda, nomeMes, MESES_PT, LABELS_STATUS_CONTA_RECEBER, CLASSE_STATUS_CONTA_RECEBER } from "@/lib/utils";
import { TrendingUp } from "lucide-react";

export const metadata: Metadata = { title: "Fluxo de Caixa" };

export default async function FluxoCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; ano?: string }>;
}) {
  const sp = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const agora = new Date();
  const mes = Number(sp.mes) || agora.getMonth() + 1;
  const ano = Number(sp.ano) || agora.getFullYear();

  const inicioMes = new Date(ano, mes - 1, 1, 0, 0, 0);
  const fimMes = new Date(ano, mes, 0, 23, 59, 59);

  // Janela dos últimos 6 meses (incluindo o mês selecionado)
  const inicioJanela = new Date(ano, mes - 6, 1, 0, 0, 0);

  const [contasMes, contasJanela] = await Promise.all([
    prisma.contaReceber.findMany({
      where: { empresaId, dataVencimento: { gte: inicioMes, lte: fimMes }, status: { not: "CANCELADO" } },
      include: { cliente: { select: { nome: true, nomeFantasia: true } } },
      orderBy: { dataVencimento: "asc" },
    }),
    prisma.contaReceber.findMany({
      where: { empresaId, dataVencimento: { gte: inicioJanela, lte: fimMes }, status: { not: "CANCELADO" } },
      select: { valor: true, status: true, dataVencimento: true },
    }),
  ]);

  // Cards do mês
  const totalPrevistoMes = contasMes.reduce((acc, c) => acc + Number(c.valor), 0);
  const totalRecebidoMes = contasMes.filter((c) => c.status === "RECEBIDO").reduce((acc, c) => acc + Number(c.valor), 0);
  const totalAReceberMes = contasMes.filter((c) => c.status === "A_RECEBER" || c.status === "PREVISTO").reduce((acc, c) => acc + Number(c.valor), 0);
  const totalAtrasadoMes = contasMes.filter((c) => c.status === "ATRASADO").reduce((acc, c) => acc + Number(c.valor), 0);

  const cards = [
    { label: "Previsto no mês", valor: totalPrevistoMes, cor: "text-slate-700", bg: "bg-slate-50" },
    { label: "A receber", valor: totalAReceberMes, cor: "text-primary-700", bg: "bg-primary-50" },
    { label: "Recebido", valor: totalRecebidoMes, cor: "text-success-700", bg: "bg-success-50" },
    { label: "Atrasado", valor: totalAtrasadoMes, cor: "text-red-700", bg: "bg-red-50" },
  ];

  // Gráfico últimos 6 meses
  const meses: { rotulo: string; previsto: number; recebido: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ano, mes - 1 - i, 1);
    meses.push({ rotulo: `${MESES_PT[d.getMonth()].slice(0, 3)}/${String(d.getFullYear()).slice(2)}`, previsto: 0, recebido: 0 });
  }
  for (const c of contasJanela) {
    if (!c.dataVencimento) continue;
    const d = new Date(c.dataVencimento);
    const idx = meses.findIndex((_, i) => {
      const ref = new Date(ano, mes - 6 + i, 1);
      return ref.getMonth() === d.getMonth() && ref.getFullYear() === d.getFullYear();
    });
    if (idx >= 0) {
      meses[idx].previsto += Number(c.valor);
      if (c.status === "RECEBIDO") meses[idx].recebido += Number(c.valor);
    }
  }
  const maxBar = Math.max(1, ...meses.map((m) => Math.max(m.previsto, m.recebido)));

  // Agrupa contas do mês por semana
  const semanas = new Map<number, typeof contasMes>();
  for (const c of contasMes) {
    const dia = c.dataVencimento ? new Date(c.dataVencimento).getDate() : 1;
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className={cn("card p-4", c.bg)}>
            <p className="text-xs uppercase tracking-wider text-ink-muted">{c.label}</p>
            <p className={cn("text-xl font-bold mt-1", c.cor)}>{formatarMoeda(c.valor)}</p>
          </div>
        ))}
      </div>

      {/* Gráfico previsto vs recebido */}
      <div className="card-padded">
        <h2 className="card-title mb-4">Previsto vs. Recebido — últimos 6 meses</h2>
        <div className="flex items-end justify-between gap-3 h-56">
          {meses.map((m, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
              <div className="w-full flex items-end justify-center gap-1 h-full">
                <div className="w-1/2 bg-primary-200 rounded-t" style={{ height: `${(m.previsto / maxBar) * 100}%` }} title={`Previsto: ${formatarMoeda(m.previsto)}`} />
                <div className="w-1/2 bg-success-500 rounded-t" style={{ height: `${(m.recebido / maxBar) * 100}%` }} title={`Recebido: ${formatarMoeda(m.recebido)}`} />
              </div>
              <span className="text-[11px] text-ink-muted">{m.rotulo}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-center gap-6 mt-4 text-xs text-ink-muted">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-primary-200" /> Previsto</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success-500" /> Recebido</span>
        </div>
      </div>

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
