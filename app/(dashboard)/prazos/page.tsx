import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { marcarPrazosVencidos } from "@/lib/prazo-server";
import {
  cn, formatarDataHora, LABELS_STATUS_OS_PRAZO, LABELS_RESPONSAVEL_PRAZO, LABELS_STATUS_PRAZO_ETAPA,
} from "@/lib/utils";
import { Timer, AlertTriangle, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Prazos" };

const PESO_STATUS: Record<string, number> = { ATRASADO: 0, ATIVO: 1, CONCLUIDO: 2, CANCELADO: 3 };

export default async function PrazosPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; templateId?: string }>;
}) {
  const { status = "", templateId = "" } = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  await marcarPrazosVencidos(empresaId);

  const where: any = { ordemServico: { empresaId } };
  if (status) where.status = status;
  if (templateId) where.templateId = templateId;

  const [prazos, templates] = await Promise.all([
    prisma.osPrazo.findMany({
      where,
      include: {
        etapas: { orderBy: { ordem: "asc" } },
        template: { select: { cor: true } },
        ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
      },
      take: 300,
    }),
    prisma.prazoTemplate.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
  ]);

  // Ordena por urgência: atrasados primeiro, depois por limite da etapa atual
  const enriquecidos = prazos.map((p) => {
    const atual = p.etapas.find((e) => e.ordem === p.etapaAtual) ?? p.etapas[p.etapas.length - 1];
    return { p, atual, limite: atual?.prazoLimite ? new Date(atual.prazoLimite).getTime() : Infinity };
  });
  enriquecidos.sort((a, b) => {
    const sa = PESO_STATUS[a.p.status] ?? 9;
    const sb = PESO_STATUS[b.p.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return a.limite - b.limite;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg"><Timer className="w-5 h-5 text-primary-600" /></div>
        <h1 className="page-title">Prazos</h1>
        <span className="text-xs font-semibold text-ink-muted bg-surface-alt border border-surface-border px-2.5 py-1 rounded-full">{prazos.length}</span>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-border bg-surface-alt/40">
          <form method="get" className="flex flex-wrap gap-2">
            <select name="status" defaultValue={status} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos status</option>
              {Object.entries(LABELS_STATUS_OS_PRAZO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <select name="templateId" defaultValue={templateId} className="bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all">
              <option value="">Todos tipos</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            <button type="submit" className="bg-primary-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-600 transition-all shadow-sm">Filtrar</button>
          </form>
        </div>

        {enriquecidos.length === 0 ? (
          <p className="text-center text-ink-subtle py-12">Nenhum prazo encontrado</p>
        ) : (
          <div className="divide-y divide-surface-border">
            {enriquecidos.map(({ p, atual }) => {
              const atrasado = p.status === "ATRASADO";
              return (
                <Link key={p.id} href={`/ordens/${p.ordemServico.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-primary-50/40 transition-colors gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.template?.cor ?? "#0EA5E9" }} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        <span className="font-mono text-primary-600">{p.ordemServico.numero}</span> · {p.nome}
                      </p>
                      <p className="text-xs text-ink-muted truncate">
                        {p.ordemServico.cliente.nomeFantasia ?? p.ordemServico.cliente.nome}
                        {atual && ` · Etapa atual: ${atual.nome} (${LABELS_RESPONSAVEL_PRAZO[atual.responsavel]})`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {atual && (
                      <span className={cn("text-xs flex items-center gap-1", atrasado ? "text-red-700 font-semibold" : "text-ink-muted")}>
                        {atrasado ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                        {formatarDataHora(atual.prazoLimite)}
                      </span>
                    )}
                    <span className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-full",
                      p.status === "CONCLUIDO" ? "bg-success-50 text-success-700" :
                      atrasado ? "bg-red-50 text-red-700" :
                      p.status === "CANCELADO" ? "bg-slate-100 text-slate-500" : "bg-primary-50 text-primary-700",
                    )}>{LABELS_STATUS_OS_PRAZO[p.status]}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
