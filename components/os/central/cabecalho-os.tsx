"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Building2, CalendarClock, Check, ChevronLeft, CircleDollarSign, ClipboardCheck,
  FileBarChart, Pencil, RotateCcw, SlidersHorizontal, User, Wrench, X,
} from "lucide-react";
import { cn, formatarDataHora, formatarMoeda, LABELS_PRIORIDADE, LABELS_STATUS_OS } from "@/lib/utils";
import { ESTAGIOS_LINHA, ROTULO_ESTAGIO, type EstagioOs } from "@/lib/os/status";
import { formatarDiaCivil, textoPrazo } from "@/lib/os/prazos";
import { ROTULO_PAGAMENTO, type CentralOs } from "@/lib/os/central";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { toast } from "@/components/ui/avisos";

const COR_ESTAGIO: Record<EstagioOs, string> = {
  ABERTA: "bg-blue-100 text-blue-700", AGENDADA: "bg-purple-100 text-purple-700",
  EM_ANDAMENTO: "bg-amber-100 text-amber-800", CONCLUIDA: "bg-green-100 text-green-700",
  FATURADA: "bg-emerald-600 text-white", CANCELADA: "bg-red-100 text-red-700",
};
const COR_PRIORIDADE: Record<string, string> = {
  BAIXA: "bg-gray-100 text-gray-600", NORMAL: "bg-blue-50 text-blue-600",
  ALTA: "bg-orange-100 text-orange-700", URGENTE: "bg-red-100 text-red-700", CRITICO: "bg-red-200 text-red-800",
};
const COR_PAGAMENTO: Record<string, string> = {
  SEM_COBRANCA: "text-ink-muted", PREVISTO: "text-slate-600", A_RECEBER: "text-amber-700", VENCIDO: "text-red-700", PAGO: "text-success-700",
};
const COR_PRAZO: Record<string, string> = {
  ATRASADO: "bg-red-100 text-red-700", VENCE_HOJE: "bg-amber-100 text-amber-800", NO_PRAZO: "bg-slate-100 text-slate-600",
  CUMPRIDO: "bg-green-50 text-green-700", SEM_PRAZO: "bg-slate-100 text-slate-500",
};

/** Status que dá para ESCOLHER à mão (Cancelada é o "Inativar", com confirmação própria). */
const STATUS_MANUAIS = ["ABERTA", "AGUARDANDO_ATENDIMENTO", "AGENDADA", "EM_ANDAMENTO", "PAUSADA", "AGUARDANDO_PECA", "CONCLUIDA"];

export function CabecalhoOs({ os, central, acoes, onAba, onAtualizado }: {
  os: any;
  central: CentralOs;
  /** Botões de ação da OS (gerar medição, inativar/reabrir…), à direita */
  acoes?: React.ReactNode;
  onAba: (aba: string) => void;
  onAtualizado: (os: any) => void;
}) {
  const { pode } = usePermissoes();
  const podeEditar = pode("ordens", "editar");
  const { status, prazoOs } = central;
  const cliente = os.cliente?.nomeFantasia ?? os.cliente?.nome;
  const local = os.unidade ? [os.unidade.nome, os.unidade.cidade && `${os.unidade.cidade}/${os.unidade.estado}`].filter(Boolean).join(" — ") : null;

  return (
    <header data-cabecalho-os className="md:sticky md:top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 pt-4 pb-3 bg-surface-page/95 backdrop-blur border-b border-surface-border space-y-3">
      {/* Linha 1: número, status, prioridade, ações */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <Link href="/ordens" aria-label="Voltar para a lista de OS" className="mt-0.5 p-1.5 rounded-lg text-ink-subtle hover:text-ink hover:bg-white">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-ink font-mono">{os.chamadoNumero ?? os.numero}</h1>
              <span data-status-os={status.exibido} className={cn("px-2.5 py-0.5 rounded-full text-xs font-semibold", COR_ESTAGIO[status.exibido])}>
                {status.manual && os.status !== "CANCELADA" ? LABELS_STATUS_OS[os.status] ?? ROTULO_ESTAGIO[status.exibido] : ROTULO_ESTAGIO[status.exibido]}
              </span>
              {status.manual && os.status !== "CANCELADA" && (
                <span data-status-manual className="text-[10px] font-semibold uppercase tracking-wide text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">ajuste manual</span>
              )}
              <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", COR_PRIORIDADE[os.prioridade])}>
                {LABELS_PRIORIDADE[os.prioridade]}
              </span>
              {os.origem === "PORTAL_CLIENTE" && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-full">
                  <FileBarChart className="w-3 h-3" /> Chamado do portal
                </span>
              )}
            </div>
            <p className="text-sm text-ink mt-0.5 flex items-center gap-1.5 flex-wrap">
              <Building2 className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
              <span className="font-medium" data-cliente-os>{cliente}</span>
              {local && <span className="text-ink-muted">· {local}</span>}
            </p>
            <p className="text-xs text-ink-muted mt-0.5 flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1"><User className="w-3 h-3" /> {os.responsavel?.nome ?? "Sem responsável"}</span>
              <span className="inline-flex items-center gap-1" data-prazo-os={prazoOs.situacao}>
                <CalendarClock className="w-3 h-3" /> Previsão {formatarDiaCivil(os.previsaoConclusao)}
                {prazoOs.situacao !== "SEM_PRAZO" && (
                  <span className={cn("ml-1 px-1.5 py-0.5 rounded text-[10px] font-semibold", COR_PRAZO[prazoOs.situacao])}>{textoPrazo(prazoOs, true)}</span>
                )}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {podeEditar && os.status !== "CANCELADA" && (
            <Link href={`/ordens/${os.id}/editar`} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-surface-border bg-white text-ink hover:bg-surface-alt">
              <Pencil className="w-4 h-4" /> Editar
            </Link>
          )}
          {acoes}
        </div>
      </div>

      {/* Linha 2: barra de progresso (ou faixa de cancelada) */}
      {status.exibido === "CANCELADA" ? (
        <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          OS inativada (cancelada): fora das listas padrão e do calendário. Use “Reabrir” para voltar a trabalhar nela.
        </div>
      ) : (
        <BarraProgresso atual={status.exibido} />
      )}

      {/* Ajuste manual divergente: o aviso pedido (manual ≠ automático) */}
      {status.divergente && (
        <AvisoManual os={os} automatico={status.automatico} onAtualizado={onAtualizado} podeEditar={podeEditar} />
      )}

      {/* Linha 3: números-chave */}
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2" data-numeros-chave>
        <Numero icone={ClipboardCheck} rotulo="Atividades" onClick={() => onAba("atividades")} dado="atividades">
          {central.atividades.total ? `${central.atividades.concluidas} de ${central.atividades.total} concluída${central.atividades.total > 1 ? "s" : ""}` : "Nenhuma"}
        </Numero>
        <Numero icone={Wrench} rotulo="Equipamentos atendidos" onClick={() => onAba("atividades")} dado="equipamentos">
          {central.equipamentosAtendidos}
        </Numero>
        <Numero icone={CircleDollarSign} rotulo="Valor (orçado · medido)" onClick={() => onAba("comercial")} dado="valor">
          {formatarMoeda(central.valor.orcado)} <span className="text-ink-subtle font-normal">·</span> {formatarMoeda(central.valor.medido)}
        </Numero>
        <Numero icone={CircleDollarSign} rotulo="Pagamento" onClick={() => onAba("financeiro")} dado="pagamento">
          <span className={COR_PAGAMENTO[central.pagamento]} data-pagamento={central.pagamento}>{ROTULO_PAGAMENTO[central.pagamento]}</span>
        </Numero>
      </dl>

      {podeEditar && os.status !== "CANCELADA" && (
        <AjusteStatus os={os} manual={status.manual} automatico={status.automatico} onAtualizado={onAtualizado} />
      )}
    </header>
  );
}

function BarraProgresso({ atual }: { atual: EstagioOs }) {
  const idx = ESTAGIOS_LINHA.indexOf(atual as (typeof ESTAGIOS_LINHA)[number]);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Andamento da OS" data-barra-progresso>
      {ESTAGIOS_LINHA.map((e, i) => {
        const feito = i < idx;
        const agora = i === idx;
        return (
          <li key={e} data-etapa={e} data-estado={agora ? "atual" : feito ? "feito" : "futuro"} aria-current={agora ? "step" : undefined} className="min-w-0">
            <div className={cn("h-1.5 rounded-full", feito ? "bg-success-500" : agora ? "bg-primary-500" : "bg-slate-200")} />
            <p className={cn("mt-1 text-[10px] sm:text-xs truncate flex items-center gap-0.5",
              agora ? "font-bold text-primary-700" : feito ? "text-success-700" : "text-ink-subtle")}>
              {feito && <Check className="w-3 h-3 shrink-0" />}{ROTULO_ESTAGIO[e]}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function Numero({ icone: Icone, rotulo, children, onClick, dado }: {
  icone: React.ComponentType<{ className?: string }>; rotulo: string; children: React.ReactNode; onClick: () => void; dado: string;
}) {
  return (
    <button type="button" onClick={onClick} data-numero={dado}
      className="text-left bg-white border border-surface-border rounded-lg px-3 py-2 hover:border-primary-300 hover:shadow-sm transition-all min-w-0">
      <dt className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle"><Icone className="w-3 h-3" /> {rotulo}</dt>
      <dd className="text-sm font-semibold text-ink truncate">{children}</dd>
    </button>
  );
}

/** Quem/quando do último ajuste manual (o histórico é a fonte). */
function ultimoAjuste(os: any) {
  const h = (os.historico ?? []).find((x: any) => x.acao === "Status ajustado manualmente");
  return h ? `${h.usuario?.nome ?? "alguém"} em ${formatarDataHora(h.criadoEm)}` : null;
}

function AvisoManual({ os, automatico, onAtualizado, podeEditar }: { os: any; automatico: EstagioOs; onAtualizado: (os: any) => void; podeEditar: boolean }) {
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();
  const quem = ultimoAjuste(os);
  async function voltar() {
    setEnviando(true);
    try {
      const r = await fetch(`/api/ordens/${os.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voltarAutomatico: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível voltar ao automático.", "erro"); return; }
      onAtualizado({ ...d, statusManual: false });
      toast("Status voltou ao automático.", "sucesso");
      router.refresh();
    } catch { toast("Erro de conexão.", "erro"); } finally { setEnviando(false); }
  }
  return (
    <div data-aviso-manual className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <p className="flex-1">
        Status ajustado à mão para <strong>{LABELS_STATUS_OS[os.status]}</strong>{quem ? ` por ${quem}` : ""}. Pelos fatos, a OS está <strong>{ROTULO_ESTAGIO[automatico]}</strong>.
      </p>
      {podeEditar && (
        <button type="button" onClick={voltar} disabled={enviando} data-voltar-automatico
          className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 underline underline-offset-2 disabled:opacity-60">
          <RotateCcw className="w-3.5 h-3.5" /> Voltar ao automático
        </button>
      )}
    </div>
  );
}

/** Ajuste manual DISCRETO: um link pequeno que abre a escolha — para as exceções. */
function AjusteStatus({ os, manual, automatico, onAtualizado }: { os: any; manual: boolean; automatico: EstagioOs; onAtualizado: (os: any) => void }) {
  const { pode } = usePermissoes();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState(os.status);
  const [enviando, setEnviando] = useState(false);
  const opcoes = STATUS_MANUAIS.filter((v) => v === os.status || v !== "CONCLUIDA" || pode("ordens", "concluir"));

  async function aplicar() {
    if (valor === os.status) { setAberto(false); return; }
    setEnviando(true);
    try {
      const r = await fetch(`/api/ordens/${os.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: valor }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível ajustar o status.", "erro"); return; }
      onAtualizado(d);
      setAberto(false);
      toast("Status ajustado manualmente — o automático fica pausado nesta OS.", "info");
      router.refresh();
    } catch { toast("Erro de conexão.", "erro"); } finally { setEnviando(false); }
  }

  async function voltarAuto() {
    setEnviando(true);
    try {
      const r = await fetch(`/api/ordens/${os.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ voltarAutomatico: true }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível voltar ao automático.", "erro"); return; }
      onAtualizado(d);
      setAberto(false);
      toast("Status voltou ao automático.", "sucesso");
      router.refresh();
    } catch { toast("Erro de conexão.", "erro"); } finally { setEnviando(false); }
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => { setValor(os.status); setAberto(true); }} data-ajustar-status
        className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-subtle hover:text-ink">
        <SlidersHorizontal className="w-3 h-3" /> {manual ? "Status em ajuste manual — mudar" : `Status automático (${ROTULO_ESTAGIO[automatico]}) — ajustar à mão`}
      </button>
    );
  }
  return (
    <div data-painel-ajuste className="flex items-center gap-2 flex-wrap text-xs bg-white border border-surface-border rounded-lg px-3 py-2">
      <span className="text-ink-muted">Ajuste manual (exceção — fica no histórico):</span>
      <select aria-label="Status manual" value={valor} onChange={(e) => setValor(e.target.value)} className="border border-surface-border rounded px-2 py-1 text-xs">
        {opcoes.map((v) => <option key={v} value={v}>{LABELS_STATUS_OS[v]}</option>)}
      </select>
      <button type="button" onClick={aplicar} disabled={enviando} data-aplicar-ajuste className="px-2.5 py-1 rounded bg-primary-500 text-white font-semibold disabled:opacity-60">Aplicar</button>
      {manual && (
        <button type="button" onClick={voltarAuto} disabled={enviando} data-painel-voltar-automatico className="px-2.5 py-1 rounded border border-surface-border font-semibold text-ink hover:bg-surface-page disabled:opacity-60">Voltar ao automático</button>
      )}
      <button type="button" onClick={() => setAberto(false)} aria-label="Fechar ajuste" className="p-1 text-ink-subtle hover:text-ink"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}
