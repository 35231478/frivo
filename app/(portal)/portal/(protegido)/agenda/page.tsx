import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requirePortalSession } from "@/lib/portal-server";
import { formatarData, formatarDataHora } from "@/lib/utils";
import { CalendarDays, CheckCircle2, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Portal — Agenda" };
export const dynamic = "force-dynamic";

export default async function PortalAgenda() {
  const { user } = await requirePortalSession();
  const agora = new Date();

  const [proximas, historico] = await Promise.all([
    prisma.ordemServico.findMany({
      where: { empresaId: user.empresaId, clienteId: user.clienteId, status: { in: ["AGENDADA", "AGUARDANDO_ATENDIMENTO"] }, previsaoConclusao: { gte: agora } },
      select: { id: true, numero: true, descricao: true, previsaoConclusao: true, responsavel: { select: { nome: true } } },
      orderBy: { previsaoConclusao: "asc" }, take: 50,
    }),
    prisma.ordemServico.findMany({
      where: { empresaId: user.empresaId, clienteId: user.clienteId, status: "CONCLUIDA" },
      select: { id: true, numero: true, descricao: true, dataConclusao: true, responsavel: { select: { nome: true } } },
      orderBy: { dataConclusao: "desc" }, take: 30,
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-ink flex items-center gap-2"><CalendarDays className="w-6 h-6 text-primary-600" /> Agenda</h1>

      <section>
        <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wider mb-2 flex items-center gap-1.5"><Clock className="w-4 h-4" /> Próximas manutenções</h2>
        {proximas.length === 0 ? (
          <div className="bg-white rounded-xl border border-surface-border p-6 text-center text-ink-muted text-sm">Nenhuma manutenção agendada.</div>
        ) : (
          <div className="space-y-2">
            {proximas.map((o) => (
              <div key={o.id} className="bg-white rounded-xl border border-surface-border p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink line-clamp-1">{o.descricao}</p>
                  <p className="text-xs text-ink-muted">{o.numero}{o.responsavel ? ` · ${o.responsavel.nome}` : ""}</p>
                </div>
                <span className="text-sm font-semibold text-primary-600 shrink-0">{formatarData(o.previsaoConclusao)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wider mb-2 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Visitas realizadas</h2>
        {historico.length === 0 ? (
          <div className="bg-white rounded-xl border border-surface-border p-6 text-center text-ink-muted text-sm">Nenhuma visita registrada.</div>
        ) : (
          <div className="space-y-2">
            {historico.map((o) => (
              <div key={o.id} className="bg-white rounded-xl border border-surface-border p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink line-clamp-1">{o.descricao}</p>
                  <p className="text-xs text-ink-muted">{o.numero}{o.responsavel ? ` · ${o.responsavel.nome}` : ""}</p>
                </div>
                <span className="text-xs text-ink-subtle shrink-0">{formatarDataHora(o.dataConclusao)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
