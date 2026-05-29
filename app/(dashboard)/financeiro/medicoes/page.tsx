import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  cn, formatarData, formatarMoeda, nomeMes,
  LABELS_STATUS_MEDICAO, CLASSE_STATUS_MEDICAO, LABELS_TIPO_MEDICAO,
} from "@/lib/utils";
import Link from "next/link";
import { FileBarChart, Plus } from "lucide-react";
import { GerarMedicoesMes } from "@/components/medicao/gerar-medicoes-mes";

export const metadata: Metadata = { title: "Medições" };

export default async function MedicoesPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; status?: string; clienteId?: string; tipo?: string; dataInicio?: string; dataFim?: string }>;
}) {
  const { busca = "", status = "", clienteId = "", tipo = "", dataInicio = "", dataFim = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const where: any = { empresaId };
  if (status) where.status = status;
  if (clienteId) where.clienteId = clienteId;
  if (tipo) where.tipo = tipo;
  if (dataInicio || dataFim) {
    where.criadoEm = {};
    if (dataInicio) where.criadoEm.gte = new Date(dataInicio);
    if (dataFim) {
      const fim = new Date(dataFim);
      fim.setHours(23, 59, 59, 999);
      where.criadoEm.lte = fim;
    }
  }
  if (busca) {
    where.OR = [
      { numero: { contains: busca, mode: "insensitive" } },
      { descricao: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const [medicoes, total, clientes] = await Promise.all([
    prisma.medicao.findMany({
      where,
      include: { cliente: { select: { id: true, nome: true, nomeFantasia: true } } },
      orderBy: { criadoEm: "desc" },
      take: 100,
    }),
    prisma.medicao.count({ where }),
    prisma.cliente.findMany({
      where: { empresaId, ativo: true },
      select: { id: true, nome: true, nomeFantasia: true },
      orderBy: { nome: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <FileBarChart className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Medições</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <div className="flex items-center gap-2 relative">
          <GerarMedicoesMes />
          <Link
            href="/financeiro/medicoes/nova"
            className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow"
          >
            <Plus className="w-4 h-4" /> Nova Medição
          </Link>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get" className="flex flex-wrap gap-2">
            <input
              name="busca"
              defaultValue={busca}
              placeholder="Buscar por número, descrição ou cliente..."
              className="flex-1 min-w-[220px] bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all"
            />
            <select name="status" defaultValue={status} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos status</option>
              {Object.entries(LABELS_STATUS_MEDICAO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select name="tipo" defaultValue={tipo} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos tipos</option>
              {Object.entries(LABELS_TIPO_MEDICAO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select name="clienteId" defaultValue={clienteId} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos clientes</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nomeFantasia ?? c.nome}</option>)}
            </select>
            <input type="date" name="dataInicio" defaultValue={dataInicio} title="Data inicial" className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all" />
            <input type="date" name="dataFim" defaultValue={dataFim} title="Data final" className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all" />
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">Filtrar</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Número</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Tipo</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Referência</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Valor</th>
              </tr>
            </thead>
            <tbody>
              {medicoes.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-ink-subtle py-12">Nenhuma medição encontrada</td></tr>
              ) : (
                medicoes.map((m, idx) => (
                  <tr key={m.id} className={cn("border-b border-surface-border hover:bg-primary-50/40 transition-colors", idx % 2 === 1 && "bg-surface-alt/30")}>
                    <td className="px-4 py-3">
                      <Link href={`/financeiro/medicoes/${m.id}`} className="font-mono font-semibold text-primary-600 hover:underline">{m.numero}</Link>
                    </td>
                    <td className="px-4 py-3 text-ink font-medium">{m.cliente.nomeFantasia ?? m.cliente.nome}</td>
                    <td className="px-4 py-3 text-ink-muted hidden md:table-cell">{LABELS_TIPO_MEDICAO[m.tipo]}</td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{m.mes ? `${nomeMes(m.mes)}/${m.ano}` : formatarData(m.criadoEm)}</td>
                    <td className="px-4 py-3"><span className={CLASSE_STATUS_MEDICAO[m.status]}>{LABELS_STATUS_MEDICAO[m.status]}</span></td>
                    <td className="px-4 py-3 text-right font-semibold text-ink">{formatarMoeda(Number(m.valorLiquido))}</td>
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
