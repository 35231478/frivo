import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { formatarMoeda, cn } from "@/lib/utils";
import { resumoFinanceiro } from "@/lib/financeiro-server";
import {
  Wallet, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Receipt, Upload, CalendarClock,
} from "lucide-react";

export const metadata: Metadata = { title: "Dashboard Financeiro" };

export default async function FinanceiroDashboardPage() {
  const session = await auth();
  const r = await resumoFinanceiro(session!.user!.empresaId);

  const cards = [
    { titulo: "A receber este mês", valor: r.aReceberMes.valor, qtd: r.aReceberMes.qtd, icone: Receipt, cor: "text-primary-600", bg: "bg-primary-50", href: "/financeiro/contas-receber" },
    { titulo: "Recebido este mês", valor: r.recebidoMes.valor, qtd: r.recebidoMes.qtd, icone: CheckCircle, cor: "text-success-600", bg: "bg-success-50", href: "/financeiro/contas-receber?status=RECEBIDO" },
    { titulo: "Vencido (a receber)", valor: r.vencidoReceber.valor, qtd: r.vencidoReceber.qtd, icone: AlertTriangle, cor: "text-red-600", bg: "bg-red-50", href: "/financeiro/contas-receber?status=ATRASADO", alerta: r.vencidoReceber.qtd > 0 },
    { titulo: "A pagar este mês", valor: r.aPagarMes.valor, qtd: r.aPagarMes.qtd, icone: Upload, cor: "text-amber-600", bg: "bg-amber-50", href: "/financeiro/contas-pagar" },
    { titulo: "Contas a pagar vencidas", valor: r.pagasVencidas.valor, qtd: r.pagasVencidas.qtd, icone: AlertTriangle, cor: "text-red-600", bg: "bg-red-50", href: "/financeiro/contas-pagar?status=VENCIDO", alerta: r.pagasVencidas.qtd > 0 },
    { titulo: "Saldo previsto", valor: r.saldoPrevisto, icone: Wallet, cor: r.saldoPrevisto >= 0 ? "text-success-600" : "text-red-600", bg: r.saldoPrevisto >= 0 ? "bg-success-50" : "bg-red-50", href: "/financeiro" },
  ];

  const maxBar = Math.max(1, ...r.meses.map((m) => Math.max(m.entradas, m.saidas)));
  // Saldo acumulado para a linha
  let acc = 0;
  const saldoAcc = r.meses.map((m) => (acc += m.entradas - m.saidas));
  const maxSaldo = Math.max(1, ...saldoAcc.map((s) => Math.abs(s)));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg"><Wallet className="w-5 h-5 text-primary-600" /></div>
        <h1 className="page-title">Dashboard Financeiro</h1>
      </div>

      {/* Cards do mês */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <Link key={c.titulo} href={c.href} className={cn("bg-white rounded-xl border p-5 shadow-card hover:shadow-card-hover transition-all", c.alerta ? "border-red-200" : "border-surface-border hover:border-primary-200")}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{c.titulo}</p>
                <p className={cn("text-2xl font-bold mt-2", c.cor)}>{formatarMoeda(c.valor)}</p>
                {c.qtd != null && <p className="text-xs text-ink-subtle mt-1">{c.qtd} conta(s)</p>}
              </div>
              <div className={cn("p-3 rounded-xl shrink-0", c.bg)}><c.icone className={cn("w-6 h-6", c.cor)} /></div>
            </div>
          </Link>
        ))}
      </div>

      {/* Gráfico entradas x saídas (6 meses) + saldo acumulado */}
      <div className="card-padded">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="card-title">Entradas × Saídas — últimos 6 meses</h2>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success-500" /> Entradas</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-400" /> Saídas</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-primary-500" /> Saldo acumulado</span>
          </div>
        </div>
        <div className="relative flex items-end justify-between gap-2 h-56 pt-6">
          {/* Linha de saldo acumulado (SVG sobreposto) */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none" viewBox="0 0 100 100">
            <polyline
              fill="none" stroke="#0EA5E9" strokeWidth="0.6"
              points={saldoAcc.map((s, i) => {
                const x = (i + 0.5) * (100 / r.meses.length);
                const y = 50 - (s / maxSaldo) * 38;
                return `${x},${Math.max(2, Math.min(98, y))}`;
              }).join(" ")}
            />
          </svg>
          {r.meses.map((m, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end z-10">
              <div className="flex items-end gap-0.5 w-full justify-center h-full">
                <div className="w-1/2 bg-success-500 rounded-t" style={{ height: `${(m.entradas / maxBar) * 100}%` }} title={`Entradas: ${formatarMoeda(m.entradas)}`} />
                <div className="w-1/2 bg-red-400 rounded-t" style={{ height: `${(m.saidas / maxBar) * 100}%` }} title={`Saídas: ${formatarMoeda(m.saidas)}`} />
              </div>
              <span className="text-[11px] text-ink-muted capitalize">{m.mes}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Alertas do dia */}
      <div className="card-padded">
        <h2 className="card-title mb-3">Alertas do dia</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <AlertaItem icone={CalendarClock} cor="text-amber-600" bg="bg-amber-50" titulo="Vencem hoje" valor={`${r.alertas.vencemHoje} conta(s)`} detalhe={`${r.alertas.vencemHojeReceber} a receber · ${r.alertas.vencemHojePagar} a pagar`} />
          <AlertaItem icone={AlertTriangle} cor="text-red-600" bg="bg-red-50" titulo="Vencidas sem notificação" valor={`${r.alertas.vencidasSemNotificacao} conta(s)`} detalhe="Atrasadas há mais de 3 dias" />
          <AlertaItem icone={r.saldoPrevisto >= 0 ? TrendingUp : TrendingDown} cor={r.saldoPrevisto >= 0 ? "text-success-600" : "text-red-600"} bg={r.saldoPrevisto >= 0 ? "bg-success-50" : "bg-red-50"} titulo="Saldo previsto do mês" valor={formatarMoeda(r.saldoPrevisto)} detalhe="Receber − Pagar (em aberto)" />
        </div>
      </div>
    </div>
  );
}

function AlertaItem({ icone: Icone, cor, bg, titulo, valor, detalhe }: any) {
  return (
    <div className="flex items-start gap-3 border border-surface-border rounded-lg p-4">
      <div className={cn("p-2 rounded-lg shrink-0", bg)}><Icone className={cn("w-5 h-5", cor)} /></div>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{titulo}</p>
        <p className={cn("text-lg font-bold mt-0.5", cor)}>{valor}</p>
        <p className="text-xs text-ink-subtle">{detalhe}</p>
      </div>
    </div>
  );
}
