import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { requirePortalSession, exigePermissao } from "@/lib/portal-server";
import { SemAcesso } from "@/components/portal/sem-acesso";
import { formatarData, formatarDataHora } from "@/lib/utils";
import { AlertTriangle, CalendarDays, CheckCircle2, Clock } from "lucide-react";

export const metadata: Metadata = { title: "Portal — Agenda" };
export const dynamic = "force-dynamic";

export default async function PortalAgenda() {
  const sessao = await requirePortalSession();
  if (!exigePermissao(sessao, "verOS")) return <SemAcesso />;
  const { user } = sessao;
  const agora = new Date();

  const [proximas, atrasadas, historico] = await Promise.all([
    prisma.ordemServico.findMany({
      where: { empresaId: user.empresaId, clienteId: user.clienteId, status: { in: ["AGENDADA", "AGUARDANDO_ATENDIMENTO"] }, previsaoConclusao: { gte: agora } },
      select: { id: true, numero: true, descricao: true, previsaoConclusao: true, responsavel: { select: { nome: true } } },
      orderBy: { previsaoConclusao: "asc" }, take: 50,
    }),
    // UX-8 (Y16): visita agendada que ficou no passado não some do radar — vira "a reagendar"
    prisma.ordemServico.findMany({
      where: { empresaId: user.empresaId, clienteId: user.clienteId, status: { in: ["AGENDADA", "AGUARDANDO_ATENDIMENTO"] }, previsaoConclusao: { lt: agora } },
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

      {atrasadas.length > 0 && (
        <section data-reagendar>
          <h2 className="text-sm font-bold text-atencao-texto uppercase tracking-wider mb-2 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Visitas a reagendar</h2>
          <div className="space-y-2">
            {atrasadas.map((o) => (
              <div key={o.id} className="bg-atencao-claro rounded-card border border-atencao/20 p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink line-clamp-1">{o.descricao}</p>
                  <p className="text-xs text-ink-muted">{o.numero}{o.responsavel ? ` · ${o.responsavel.nome}` : ""}</p>
                </div>
                <span className="text-xs font-semibold text-atencao-texto shrink-0">era {formatarData(o.previsaoConclusao)} — a reagendar</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-bold text-ink-muted uppercase tracking-wider mb-2 flex items-center gap-1.5"><Clock className="w-4 h-4" /> Próximas manutenções</h2>
        {proximas.length === 0 ? (
          <div className="bg-white rounded-card border border-surface-border p-6 text-center text-ink-muted text-sm">Nenhuma manutenção agendada.</div>
        ) : (
          <div className="space-y-2">
            {proximas.map((o) => (
              <div key={o.id} className="bg-white rounded-card border border-surface-border p-4 flex items-center justify-between gap-3">
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
          <div className="bg-white rounded-card border border-surface-border p-6 text-center text-ink-muted text-sm">Nenhuma visita registrada.</div>
        ) : (
          <div className="space-y-2">
            {historico.map((o) => (
              <div key={o.id} className="bg-white rounded-card border border-surface-border p-4 flex items-center justify-between gap-3">
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
