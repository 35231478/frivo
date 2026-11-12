"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LABELS_STATUS_OS, LABELS_PRIORIDADE, formatarData, cn } from "@/lib/utils";
import { ClipboardList, ClipboardPlus, MapPin, User, ExternalLink, Loader2 } from "lucide-react";
import { BarraPeriodo } from "@/components/listagem/periodo-cards";
import { CampoBusca } from "@/components/listagem/listagem-ui";
import { lerPeriodo, faixaDiaCivil, periodoTela, type Periodo } from "@/lib/periodo";

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

const texto = (os: OsCard) => [
  os.numero, os.descricao, os.unidade?.nome, os.responsavel?.nome,
  LABELS_STATUS_OS[os.status] ?? os.status, LABELS_PRIORIDADE[os.prioridade] ?? os.prioridade,
].filter(Boolean).join(" ").toLowerCase();

/** Histórico de ordens de serviço do cliente, com link para cada OS. Filtra por período (abertura) e
 *  por busca (número, descrição, unidade, responsável, status). Só busca quando a aba está ativa. */
export function AtendimentoCliente({ clienteId, ativo }: { clienteId: string; ativo: boolean }) {
  const [ordens, setOrdens] = useState<OsCard[] | null>(null);
  const [busca, setBusca] = useState("");
  // Params do período (padrão "todos": mostra o histórico inteiro até filtrar).
  const [periodoSp, setPeriodoSp] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ativo || ordens !== null) return;
    fetch(`/api/ordens?clienteId=${clienteId}`)
      .then((r) => r.json())
      .then((d) => setOrdens(Array.isArray(d) ? d : []))
      .catch(() => setOrdens([]));
  }, [ativo, clienteId, ordens]);

  const periodo = useMemo(
    () => lerPeriodo(periodoSp, new Date(), { permitirTodos: true, padrao: "todos" }),
    [periodoSp],
  );
  const navegarPeriodo = (m: Record<string, string | null>) => setPeriodoSp((prev) => {
    const next = { ...prev };
    for (const [k, v] of Object.entries(m)) { if (v == null || v === "") delete next[k]; else next[k] = v; }
    return next;
  });

  const filtradas = useMemo(() => {
    const faixa = faixaDiaCivil(periodo as Periodo); // null => todo o período
    const q = busca.trim().toLowerCase();
    return (ordens ?? []).filter((os) => {
      if (faixa) {
        const d = new Date(os.criadoEm);
        if (faixa.gte && d < faixa.gte) return false;
        if (faixa.lt && d >= faixa.lt) return false;
      }
      if (q && !texto(os).includes(q)) return false;
      return true;
    });
  }, [ordens, periodo, busca]);

  const novoHref = `/ordens/nova?clienteId=${clienteId}`;
  const botaoNova = (
    <Link href={novoHref} className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-sm shrink-0">
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
      <div className="flex flex-col sm:flex-row sm:items-end gap-3">
        <BarraPeriodo periodo={periodoTela(periodo)} navegar={navegarPeriodo} permitirTodos rotulo="Abertura"
          dica="Filtra as OS pela data de abertura." />
        <div className="flex-1 min-w-0">
          <CampoBusca valor={busca} onChange={setBusca} atalho={false} rotulo="Pesquisar"
            placeholder="Número, descrição, unidade, responsável…" />
        </div>
        {botaoNova}
      </div>

      <p className="text-xs text-ink-muted">
        {filtradas.length === ordens.length
          ? `${ordens.length} ${ordens.length === 1 ? "ordem de serviço" : "ordens de serviço"} deste cliente.`
          : `${filtradas.length} de ${ordens.length} ${ordens.length === 1 ? "ordem" : "ordens"} (filtro aplicado).`}
      </p>

      {filtradas.length === 0 ? (
        <p className="text-sm text-ink-muted py-6 text-center">Nenhuma OS no período ou busca selecionados.</p>
      ) : (
        <div className="space-y-3">
          {filtradas.map((os) => (
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
      )}
    </div>
  );
}
