import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requirePortalSession } from "@/lib/portal-server";
import { cn, formatarData, LABELS_STATUS_OS } from "@/lib/utils";
import { Headset, Plus } from "lucide-react";

export const metadata: Metadata = { title: "Portal — Chamados" };
export const dynamic = "force-dynamic";

const COR_STATUS: Record<string, string> = {
  ABERTA: "bg-primary-50 text-primary-700",
  AGUARDANDO_ATENDIMENTO: "bg-cyan-50 text-cyan-700",
  AGENDADA: "bg-violet-50 text-violet-700",
  EM_ANDAMENTO: "bg-amber-50 text-amber-700",
  PAUSADA: "bg-orange-50 text-orange-700",
  AGUARDANDO_PECA: "bg-yellow-50 text-yellow-700",
  CONCLUIDA: "bg-success-50 text-success-700",
  CANCELADA: "bg-red-50 text-red-700",
};

export default async function PortalChamados() {
  const { user } = await requirePortalSession();
  const ordens = await prisma.ordemServico.findMany({
    where: { empresaId: user.empresaId, clienteId: user.clienteId },
    select: { id: true, numero: true, chamadoNumero: true, descricao: true, status: true, origem: true, criadoEm: true },
    orderBy: { criadoEm: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><Headset className="w-6 h-6 text-primary-600" /> Chamados</h1>
        {user.permissoes?.abrirChamados && (
          <Link href="/portal/chamados/novo" className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-all">
            <Plus className="w-4 h-4" /> Abrir chamado
          </Link>
        )}
      </div>

      {ordens.length === 0 ? (
        <div className="bg-white rounded-xl border border-surface-border p-10 text-center text-ink-muted">Nenhum chamado registrado.</div>
      ) : (
        <div className="space-y-2">
          {ordens.map((o) => (
            <Link key={o.id} href={`/portal/chamados/${o.id}`} className="block bg-white rounded-xl border border-surface-border p-4 hover:border-primary-200 hover:shadow-card transition-all">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-primary-600">{o.chamadoNumero ?? o.numero}</span>
                    {o.origem === "PORTAL_CLIENTE" && <span className="text-[10px] font-semibold bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded">Portal</span>}
                  </div>
                  <p className="text-sm text-ink mt-0.5 line-clamp-1">{o.descricao}</p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", COR_STATUS[o.status])}>{LABELS_STATUS_OS[o.status] ?? o.status}</span>
                  <span className="text-xs text-ink-subtle">{formatarData(o.criadoEm)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
