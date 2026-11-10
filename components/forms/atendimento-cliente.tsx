"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LABELS_STATUS_OS, LABELS_PRIORIDADE, formatarData, cn } from "@/lib/utils";
import { ClipboardList, ClipboardPlus, MapPin, User, ExternalLink, Loader2 } from "lucide-react";

interface OsCard {
  id: string;
  numero: string;
  status: string;
  prioridade: string;
  descricao: string;
  criadoEm: string;
  dataConclusao: string | null;
  unidade: { id: string; nome: string } | null;
  responsavel: { id: string; nome: string } | null;
}

const COR_STATUS_OS: Record<string, string> = {
  ABERTA: "bg-acento-claro text-acento",
  AGUARDANDO_ATENDIMENTO: "bg-atencao-claro text-atencao-texto",
  AGENDADA: "bg-acento-claro text-acento",
  EM_ANDAMENTO: "bg-atencao-claro text-atencao-texto",
  PAUSADA: "bg-surface-linha text-ink-muted",
  AGUARDANDO_PECA: "bg-surface-linha text-ink-muted",
  CONCLUIDA: "bg-ok-claro text-ok-texto",
  CANCELADA: "bg-atrasado-claro text-atrasado-texto",
};

/** Histórico de ordens de serviço do cliente, com link para cada OS. Só busca quando a aba está ativa. */
export function AtendimentoCliente({ clienteId, ativo }: { clienteId: string; ativo: boolean }) {
  const [ordens, setOrdens] = useState<OsCard[] | null>(null);

  useEffect(() => {
    if (!ativo || ordens !== null) return;
    fetch(`/api/ordens?clienteId=${clienteId}`)
      .then((r) => r.json())
      .then((d) => setOrdens(Array.isArray(d) ? d : []))
      .catch(() => setOrdens([]));
  }, [ativo, clienteId, ordens]);

  const novoHref = `/ordens/nova?clienteId=${clienteId}`;
  const botaoNova = (
    <Link href={novoHref} className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm">
      <ClipboardPlus className="w-4 h-4" /> Nova OS
    </Link>
  );

  if (ordens === null) {
    return <div className="flex items-center gap-2 text-sm text-ink-muted py-6"><Loader2 className="w-4 h-4 animate-spin" /> Carregando atendimentos…</div>;
  }

  if (ordens.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <ClipboardList className="w-8 h-8 text-ink-subtle" />
        <p className="text-sm text-ink-muted">Nenhuma ordem de serviço para este cliente ainda.</p>
        {botaoNova}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-ink-muted">
          {ordens.length} {ordens.length === 1 ? "ordem de serviço" : "ordens de serviço"} deste cliente.
        </p>
        {botaoNova}
      </div>

      <div className="space-y-3">
        {ordens.map((os) => (
          <Link key={os.id} href={`/ordens/${os.id}`}
            className="block border border-surface-border rounded-card p-4 hover:border-primary-300 transition-colors bg-white">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-ink">{os.numero}</span>
                  <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", COR_STATUS_OS[os.status] ?? "bg-surface-linha text-ink-muted")}>
                    {LABELS_STATUS_OS[os.status] ?? os.status}
                  </span>
                  <span className="text-[10px] text-ink-muted">{LABELS_PRIORIDADE[os.prioridade] ?? os.prioridade}</span>
                </div>
                <p className="text-xs text-ink line-clamp-2">{os.descricao}</p>
                <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs text-ink-muted">
                  <span>{os.dataConclusao ? `Concluída em ${formatarData(os.dataConclusao)}` : `Aberta em ${formatarData(os.criadoEm)}`}</span>
                  {os.unidade && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {os.unidade.nome}</span>}
                  {os.responsavel && <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {os.responsavel.nome}</span>}
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-ink-muted shrink-0 mt-0.5" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
