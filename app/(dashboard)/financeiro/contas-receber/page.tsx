import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import {
  cn, formatarData, formatarMoeda,
  LABELS_STATUS_CONTA_RECEBER, CLASSE_STATUS_CONTA_RECEBER, LABELS_FORMA_PAGAMENTO,
} from "@/lib/utils";
import { Receipt } from "lucide-react";
import { ContaReceberAcoes } from "@/components/financeiro/conta-receber-acoes";

export const metadata: Metadata = { title: "Contas a Receber" };

export default async function ContasReceberPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; clienteId?: string; formaPagamento?: string; dataInicio?: string; dataFim?: string }>;
}) {
  const { status = "", clienteId = "", formaPagamento = "", dataInicio = "", dataFim = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  // Marca como ATRASADO contas vencidas ainda não recebidas
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  await prisma.contaReceber.updateMany({
    where: { empresaId, status: { in: ["PREVISTO", "A_RECEBER"] }, dataVencimento: { lt: hoje } },
    data: { status: "ATRASADO" },
  });

  const where: any = { empresaId };
  if (status) where.status = status;
  if (clienteId) where.clienteId = clienteId;
  if (formaPagamento) where.formaPagamento = formaPagamento;
  if (dataInicio || dataFim) {
    where.dataVencimento = {};
    if (dataInicio) where.dataVencimento.gte = new Date(dataInicio);
    if (dataFim) {
      const fim = new Date(dataFim);
      fim.setHours(23, 59, 59, 999);
      where.dataVencimento.lte = fim;
    }
  }

  const [contas, clientes, agregados] = await Promise.all([
    prisma.contaReceber.findMany({
      where,
      include: { cliente: { select: { id: true, nome: true, nomeFantasia: true } } },
      orderBy: [{ dataVencimento: "asc" }, { criadoEm: "desc" }],
      take: 200,
    }),
    prisma.cliente.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, nomeFantasia: true },
      orderBy: { nome: "asc" },
    }),
    prisma.contaReceber.groupBy({
      by: ["status"],
      where: { empresaId },
      _sum: { valor: true },
    }),
  ]);

  const somaPor = (s: string) => Number(agregados.find((a) => a.status === s)?._sum.valor ?? 0);
  const totalPrevisto = somaPor("PREVISTO");
  const totalAReceber = somaPor("A_RECEBER");
  const totalRecebido = somaPor("RECEBIDO");
  const totalAtrasado = somaPor("ATRASADO");

  const cards = [
    { label: "Previsto", valor: totalPrevisto, cor: "text-slate-600", bg: "bg-slate-50" },
    { label: "A receber", valor: totalAReceber, cor: "text-primary-700", bg: "bg-primary-50" },
    { label: "Recebido", valor: totalRecebido, cor: "text-success-700", bg: "bg-success-50" },
    { label: "Atrasado", valor: totalAtrasado, cor: "text-red-700", bg: "bg-red-50" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg"><Receipt className="w-5 h-5 text-primary-600" /></div>
        <h1 className="page-title">Contas a Receber</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className={cn("card p-4", c.bg)}>
            <p className="text-xs uppercase tracking-wider text-ink-muted">{c.label}</p>
            <p className={cn("text-xl font-bold mt-1", c.cor)}>{formatarMoeda(c.valor)}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get" className="flex flex-wrap gap-2">
            <select name="status" defaultValue={status} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos status</option>
              {Object.entries(LABELS_STATUS_CONTA_RECEBER).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select name="clienteId" defaultValue={clienteId} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos clientes</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nomeFantasia ?? c.nome}</option>)}
            </select>
            <select name="formaPagamento" defaultValue={formaPagamento} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todas formas</option>
              {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input type="date" name="dataInicio" defaultValue={dataInicio} title="Vencimento de" className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all" />
            <input type="date" name="dataFim" defaultValue={dataFim} title="Vencimento até" className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all" />
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">Filtrar</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Número</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Vencimento</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Forma</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Valor</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {contas.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-ink-subtle py-12">Nenhuma conta encontrada</td></tr>
              ) : (
                contas.map((c, idx) => (
                  <tr key={c.id} className={cn("border-b border-surface-border hover:bg-primary-50/40 transition-colors", idx % 2 === 1 && "bg-surface-alt/30")}>
                    <td className="px-4 py-3">
                      {c.medicaoId ? (
                        <Link href={`/financeiro/medicoes/${c.medicaoId}`} className="font-mono font-semibold text-primary-600 hover:underline">{c.numero}</Link>
                      ) : (
                        <span className="font-mono font-semibold text-ink">{c.numero}</span>
                      )}
                      <p className="text-xs text-ink-muted truncate max-w-[200px]">{c.descricao}</p>
                    </td>
                    <td className="px-4 py-3 text-ink font-medium">{c.cliente.nomeFantasia ?? c.cliente.nome}</td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{formatarData(c.dataVencimento)}</td>
                    <td className="px-4 py-3 text-ink-muted hidden md:table-cell">{c.formaPagamento ? LABELS_FORMA_PAGAMENTO[c.formaPagamento] : "—"}</td>
                    <td className="px-4 py-3"><span className={CLASSE_STATUS_CONTA_RECEBER[c.status]}>{LABELS_STATUS_CONTA_RECEBER[c.status]}</span></td>
                    <td className="px-4 py-3 text-right font-semibold text-ink">{formatarMoeda(Number(c.valor))}</td>
                    <td className="px-4 py-3 text-right"><div className="flex justify-end"><ContaReceberAcoes contaId={c.id} status={c.status} /></div></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
