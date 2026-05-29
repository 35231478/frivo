import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatarData, cn, LABELS_STATUS_OS, LABELS_PRIORIDADE, LABELS_ORIGEM_OS } from "@/lib/utils";
import Link from "next/link";
import { ClipboardList, Plus, Headset } from "lucide-react";

export const metadata: Metadata = { title: "Ordens de Serviço" };

const CLASSE_STATUS: Record<string, string> = {
  ABERTA: "badge-status-aberta",
  AGUARDANDO_ATENDIMENTO: "badge-status-aguardando_atendimento",
  AGENDADA: "badge-status-agendada",
  EM_ANDAMENTO: "badge-status-em_andamento",
  PAUSADA: "badge-status-pausada",
  AGUARDANDO_PECA: "badge-status-aguardando_peca",
  CONCLUIDA: "badge-status-concluida",
  CANCELADA: "badge-status-cancelada",
};
const CLASSE_PRIORIDADE: Record<string, string> = {
  BAIXA: "badge-prioridade-baixa",
  NORMAL: "badge-prioridade-normal",
  ALTA: "badge-prioridade-alta",
  URGENTE: "badge-prioridade-urgente",
  CRITICO: "badge-prioridade-critico",
};

export default async function OrdensPage({
  searchParams,
}: {
  searchParams: Promise<{ busca?: string; status?: string; prioridade?: string; origem?: string }>;
}) {
  const { busca = "", status = "", prioridade = "", origem = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const where: any = { empresaId };
  if (status) where.status = status;
  if (prioridade) where.prioridade = prioridade;
  if (origem) where.origem = origem;
  if (busca) {
    where.OR = [
      { numero: { contains: busca, mode: "insensitive" } },
      { descricao: { contains: busca, mode: "insensitive" } },
      { cliente: { nome: { contains: busca, mode: "insensitive" } } },
    ];
  }

  const [ordens, total] = await Promise.all([
    prisma.ordemServico.findMany({
      where,
      include: {
        cliente: { select: { id: true, nome: true, nomeFantasia: true } },
        unidade: { select: { nome: true } },
        responsavel: { select: { nome: true } },
        _count: { select: { atividades: true } },
      },
      // origem e chamadoNumero já vêm como escalares
      orderBy: { criadoEm: "desc" },
      take: 100,
    }),
    prisma.ordemServico.count({ where }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary-50 rounded-lg">
            <ClipboardList className="w-5 h-5 text-primary-600" />
          </div>
          <h1 className="page-title">Ordens de Serviço</h1>
          <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{total}</span>
        </div>
        <Link href="/ordens/nova" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all shadow-sm hover:shadow">
          <Plus className="w-4 h-4" /> Nova OS
        </Link>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get" className="flex flex-wrap gap-2">
            <input name="busca" defaultValue={busca} placeholder="Buscar por número, cliente ou descrição..."
              className="flex-1 min-w-[200px] bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all" />
            <select name="status" defaultValue={status} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Status</option>
              {Object.entries(LABELS_STATUS_OS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
            <select name="prioridade" defaultValue={prioridade} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Prioridade</option>
              {Object.entries(LABELS_PRIORIDADE).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
            <select name="origem" defaultValue={origem} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Origem</option>
              {Object.entries(LABELS_ORIGEM_OS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </select>
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">Filtrar</button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt border-b border-surface-border">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Número</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Cliente</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Endereço</th>
                <th className="text-center px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Ativid.</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden lg:table-cell">Abertura</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider hidden md:table-cell">Prioridade</th>
              </tr>
            </thead>
            <tbody>
              {ordens.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-ink-subtle py-12">Nenhuma OS encontrada</td></tr>
              ) : (
                ordens.map((os, idx) => (
                  <tr key={os.id} className={cn(
                    "border-b border-surface-border hover:bg-primary-50/40 transition-colors",
                    idx % 2 === 1 && "bg-surface-alt/30",
                  )}>
                    <td className="px-4 py-3">
                      <Link href={`/ordens/${os.id}`} className="font-mono font-semibold text-primary-600 hover:underline">{os.chamadoNumero ?? os.numero}</Link>
                      {os.origem === "PORTAL_CLIENTE" && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold bg-cyan-50 text-cyan-700 px-1.5 py-0.5 rounded">
                          <Headset className="w-3 h-3" /> Portal
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink font-medium">{os.cliente.nomeFantasia ?? os.cliente.nome}</td>
                    <td className="px-4 py-3 text-ink-muted hidden md:table-cell">{os.unidade?.nome ?? "—"}</td>
                    <td className="px-4 py-3 text-center text-ink-muted hidden lg:table-cell">{os._count.atividades}</td>
                    <td className="px-4 py-3 text-ink-muted hidden lg:table-cell">{formatarData(os.criadoEm)}</td>
                    <td className="px-4 py-3">
                      <span className={CLASSE_STATUS[os.status]}>{LABELS_STATUS_OS[os.status]}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className={CLASSE_PRIORIDADE[os.prioridade]}>{LABELS_PRIORIDADE[os.prioridade]}</span>
                    </td>
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
