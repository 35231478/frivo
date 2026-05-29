import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePortalSession } from "@/lib/portal-server";
import { cn, formatarDataHora, LABELS_STATUS_OS, LABELS_PRIORIDADE } from "@/lib/utils";
import { ChevronLeft, User, Clock, Image as ImageIcon } from "lucide-react";

export const metadata: Metadata = { title: "Portal — Chamado" };
export const dynamic = "force-dynamic";

export default async function PortalChamadoDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requirePortalSession();

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId: user.empresaId, clienteId: user.clienteId },
    include: {
      responsavel: { select: { nome: true } },
      unidade: { select: { nome: true } },
      equipamento: { select: { marca: true, modelo: true } },
      anexos: { select: { id: true, nome: true, tipo: true, conteudo: true }, orderBy: { criadoEm: "asc" } },
      historico: { orderBy: { criadoEm: "desc" }, take: 30 },
    },
  });
  if (!os) notFound();

  const fotos = os.anexos.filter((a) => a.tipo.startsWith("image/") || /^data:image\//.test(a.conteudo));

  return (
    <div className="space-y-5">
      <Link href="/portal/chamados" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-primary-600"><ChevronLeft className="w-4 h-4" /> Voltar</Link>

      <div className="bg-white rounded-xl border border-surface-border p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-mono text-lg font-bold text-primary-600">{os.chamadoNumero ?? os.numero}</p>
            <p className="text-xs text-ink-muted">Aberto em {formatarDataHora(os.criadoEm)}</p>
          </div>
          <span className="text-sm font-medium px-3 py-1 rounded-full bg-primary-50 text-primary-700">{LABELS_STATUS_OS[os.status] ?? os.status}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-sm">
          <div className="flex items-center gap-2"><User className="w-4 h-4 text-ink-muted" /> <span className="text-ink-muted">Técnico:</span> {os.responsavel?.nome ?? "A designar"}</div>
          <div><span className="text-ink-muted">Prioridade:</span> {LABELS_PRIORIDADE[os.prioridade] ?? os.prioridade}</div>
          {os.unidade && <div><span className="text-ink-muted">Local:</span> {os.unidade.nome}</div>}
          {os.equipamento && <div><span className="text-ink-muted">Equipamento:</span> {os.equipamento.marca} {os.equipamento.modelo}</div>}
        </div>
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wider text-ink-muted mb-1">Descrição</p>
          <p className="text-sm text-ink whitespace-pre-wrap">{os.descricao}</p>
        </div>
      </div>

      {fotos.length > 0 && (
        <div className="bg-white rounded-xl border border-surface-border p-5">
          <p className="text-sm font-bold text-ink flex items-center gap-2 mb-3"><ImageIcon className="w-4 h-4 text-primary-600" /> Fotos</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {fotos.map((f) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={f.id} src={f.conteudo} alt={f.nome} className="w-full h-28 object-cover rounded-lg border border-surface-border" />
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-surface-border p-5">
        <p className="text-sm font-bold text-ink flex items-center gap-2 mb-3"><Clock className="w-4 h-4 text-primary-600" /> Atualizações</p>
        {os.historico.length === 0 ? (
          <p className="text-sm text-ink-muted">Sem atualizações.</p>
        ) : (
          <ol className="relative border-l-2 border-surface-border ml-2 space-y-3">
            {os.historico.map((h) => (
              <li key={h.id} className="ml-4">
                <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-primary-500 ring-2 ring-white" />
                <p className="text-sm text-ink font-medium">{h.acao}</p>
                {h.detalhes && <p className="text-xs text-ink-muted">{h.detalhes}</p>}
                <p className="text-[11px] text-ink-subtle">{formatarDataHora(h.criadoEm)}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
