"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Building2, CalendarClock, ChevronLeft, CircleDollarSign, ClipboardCheck, FileSignature,
  FileBarChart, Pencil, RotateCcw, SlidersHorizontal, User, Wrench, X,
} from "lucide-react";
import { formatarDataHora, formatarMoeda, LABELS_PRIORIDADE, LABELS_STATUS_OS } from "@/lib/utils";
import { ESTAGIOS_LINHA, ROTULO_ESTAGIO, type EstagioOs } from "@/lib/os/status";
import { formatarDiaCivil, textoPrazo } from "@/lib/os/prazos";
import { ROTULO_PAGAMENTO, type CentralOs } from "@/lib/os/central";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { toast } from "@/components/ui/avisos";
import { StatusPill, TOM_ESTAGIO_OS, TOM_PRAZO, TOM_PRIORIDADE } from "@/components/ui/status-pill";
import { Stepper } from "@/components/ui/stepper";
import { Kpi } from "@/components/ui/kpi";

/** Situação do pagamento → cor do texto (status com função: previsto, atenção, atrasado, ok). */
const COR_PAGAMENTO: Record<string, string> = {
  SEM_COBRANCA: "text-ink-muted", PREVISTO: "text-previsto-texto", A_RECEBER: "text-atencao-texto", VENCIDO: "text-atrasado-texto", PAGO: "text-ok-texto", PERDA: "text-ink",
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
    <header data-cabecalho-os className="md:sticky md:top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 pt-5 pb-4 bg-surface-page/95 backdrop-blur border-b border-surface-border space-y-4">
      {/* Linha 1: número, status, prioridade, ações */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <Link href="/ordens" aria-label="Voltar para a lista de OS" className="mt-0.5 p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-white">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-xl sm:text-2xl font-bold text-ink tracking-tight tabular-nums">{os.chamadoNumero ?? os.numero}</h1>
              <StatusPill tom={TOM_ESTAGIO_OS[status.exibido] ?? "previsto"} data-status-os={status.exibido} className="font-semibold">
                {status.manual && os.status !== "CANCELADA" ? LABELS_STATUS_OS[os.status] ?? ROTULO_ESTAGIO[status.exibido] : ROTULO_ESTAGIO[status.exibido]}
              </StatusPill>
              {status.manual && os.status !== "CANCELADA" && (
                <StatusPill tom="atencao" tamanho="sm" data-status-manual="">ajuste manual</StatusPill>
              )}
              <StatusPill tom={TOM_PRIORIDADE[os.prioridade] ?? "previsto"}>
                {LABELS_PRIORIDADE[os.prioridade]}
              </StatusPill>
              {os.origem === "PORTAL_CLIENTE" && (
                <StatusPill tom="acento">
                  <FileBarChart className="w-3 h-3" /> Chamado do portal
                </StatusPill>
              )}
              {os.orcamentoOrigem && (
                <Link href={`/orcamentos/${os.orcamentoOrigem.id}`} data-orcamento-origem={os.orcamentoOrigem.id}
                  className="inline-flex items-center gap-1 rounded-full bg-acento-claro px-2.5 py-0.5 text-xs font-semibold text-acento hover:underline">
                  <FileSignature className="w-3 h-3" aria-hidden="true" /> Do orçamento {os.orcamentoOrigem.codigo}
                </Link>
              )}
            </div>
            <p className="text-sm text-ink mt-1.5 flex items-center gap-1.5 flex-wrap">
              <Building2 className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden="true" />
              <span className="font-medium" data-cliente-os>{cliente}</span>
              {local && <span className="text-ink-muted">· {local}</span>}
            </p>
            <p className="text-xs text-ink-muted mt-1 flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5 text-ink-subtle" aria-hidden="true" /> {os.responsavel?.nome ?? "Sem responsável"}</span>
              <span className="inline-flex items-center gap-1" data-prazo-os={prazoOs.situacao}>
                <CalendarClock className="w-3.5 h-3.5 text-ink-subtle" aria-hidden="true" /> Previsão {formatarDiaCivil(os.previsaoConclusao)}
                {prazoOs.situacao !== "SEM_PRAZO" && (
                  <StatusPill tom={TOM_PRAZO[prazoOs.situacao] ?? "previsto"} tamanho="sm" className="ml-1">{textoPrazo(prazoOs, true)}</StatusPill>
                )}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {podeEditar && os.status !== "CANCELADA" && (
            <Link href={`/ordens/${os.id}/editar`} className="btn-secondary">
              <Pencil className="w-4 h-4" /> Editar
            </Link>
          )}
          {acoes}
        </div>
      </div>

      {/* Linha 2: barra de progresso (ou faixa de cancelada) */}
      {status.exibido === "CANCELADA" ? (
        <div role="status" className="flex items-center gap-2 text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
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
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-numeros-chave>
        <Kpi icone={ClipboardCheck} rotulo="Atividades" onClick={() => onAba("atividades")} data-numero="atividades">
          {central.atividades.total ? `${central.atividades.concluidas} de ${central.atividades.total} concluída${central.atividades.total > 1 ? "s" : ""}` : "Nenhuma"}
        </Kpi>
        <Kpi icone={Wrench} rotulo="Equipamentos atendidos" onClick={() => onAba("atividades")} data-numero="equipamentos">
          {central.equipamentosAtendidos}
        </Kpi>
        <Kpi icone={CircleDollarSign} rotulo="Valor (orçado · medido)" onClick={() => onAba("comercial")} data-numero="valor">
          {formatarMoeda(central.valor.orcado)} <span className="text-ink-subtle font-normal">·</span> {formatarMoeda(central.valor.medido)}
        </Kpi>
        <Kpi icone={CircleDollarSign} rotulo="Pagamento" onClick={() => onAba("financeiro")} data-numero="pagamento">
          <span className={COR_PAGAMENTO[central.pagamento]} data-pagamento={central.pagamento}>{ROTULO_PAGAMENTO[central.pagamento]}</span>
        </Kpi>
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
    <Stepper
      rotulo="Andamento da OS" data-barra-progresso="" atual={idx}
      passos={ESTAGIOS_LINHA.map((e) => ({ id: e, rotulo: ROTULO_ESTAGIO[e] }))}
    />
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
    <div data-aviso-manual className="flex items-start gap-2 text-sm text-atencao-texto bg-atencao-claro rounded-lg px-3 py-2.5">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="flex-1">
        Status ajustado à mão para <strong>{LABELS_STATUS_OS[os.status]}</strong>{quem ? ` por ${quem}` : ""}. Pelos fatos, a OS está <strong>{ROTULO_ESTAGIO[automatico]}</strong>.
      </p>
      {podeEditar && (
        <button type="button" onClick={voltar} disabled={enviando} data-voltar-automatico
          className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-atencao-texto underline underline-offset-2 disabled:opacity-60">
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
      toast(d.statusManual ? "Status ajustado manualmente — o automático fica pausado nesta OS." : "É o que os fatos dizem: a OS segue no automático.", "info");
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
        className="inline-flex items-center gap-1 text-xs font-medium text-ink-muted hover:text-ink rounded">
        <SlidersHorizontal className="w-3 h-3" /> {manual ? "Status em ajuste manual — mudar" : `Status automático (${ROTULO_ESTAGIO[automatico]}) — ajustar à mão`}
      </button>
    );
  }
  return (
    <div data-painel-ajuste className="flex items-center gap-2 flex-wrap text-xs bg-white border border-surface-border rounded-card shadow-card px-4 py-3">
      <span className="text-ink-muted">Ajuste manual (exceção — fica no histórico):</span>
      <select aria-label="Status manual" value={valor} onChange={(e) => setValor(e.target.value)} className="bg-white border border-surface-border rounded-lg px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:border-acento focus:ring-4 focus:ring-acento/15">
        {opcoes.map((v) => <option key={v} value={v}>{LABELS_STATUS_OS[v]}</option>)}
      </select>
      <button type="button" onClick={aplicar} disabled={enviando} data-aplicar-ajuste className="btn-primary px-3 py-1.5 text-xs">Aplicar</button>
      {manual && (
        <button type="button" onClick={voltarAuto} disabled={enviando} data-painel-voltar-automatico className="btn-secondary px-3 py-1.5 text-xs">Voltar ao automático</button>
      )}
      <button type="button" onClick={() => setAberto(false)} aria-label="Fechar ajuste" className="p-1 rounded-lg text-ink-muted hover:text-ink hover:bg-surface-page"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}
