"use client";

import { useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Clock, FileText, History, ListChecks, MapPin, User } from "lucide-react";
import { cn, formatarDataHora } from "@/lib/utils";
import { formatarDiaCivil, textoPrazo } from "@/lib/os/prazos";
import type { CentralOs } from "@/lib/os/central";
import { Card, CardTitulo } from "@/components/ui/card";
import { StatusPill, TOM_PRAZO } from "@/components/ui/status-pill";

function Cartao({ titulo, icone, children, dado, className }: {
  titulo: string; icone: React.ComponentType<{ className?: string }>; children: React.ReactNode; dado?: string; className?: string;
}) {
  return (
    <Card as="section" data-cartao={dado} className={className}>
      <CardTitulo icone={icone}>{titulo}</CardTitulo>
      {children}
    </Card>
  );
}

export function ResumoOs({ os, central, onAba }: { os: any; central: CentralOs; onAba: (aba: string) => void }) {
  const [historicoTodo, setHistoricoTodo] = useState(false);
  const historico: any[] = os.historico ?? [];
  const visiveis = historicoTodo ? historico : historico.slice(0, 8);
  const comPrazo = (os.atividades ?? []).filter((a: any) => a.prazo && a.status !== "CANCELADA");
  const slaAtrasados = (os.prazos ?? []).filter((p: any) => p.status === "ATRASADO").length;
  const slaAtivos = (os.prazos ?? []).filter((p: any) => p.status === "ATIVO" || p.status === "ATRASADO").length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5" data-resumo-os>
      {/* Coluna principal */}
      <div className="lg:col-span-2 space-y-5">
        <Cartao titulo="O que falta" icone={ListChecks} dado="o-que-falta">
          {central.falta.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-ok-texto" data-nada-pendente><CheckCircle2 className="w-4 h-4 text-ok" aria-hidden="true" /> Nada pendente nesta OS.</p>
          ) : (
            <ul className="space-y-2">
              {central.falta.map((p) => (
                <li key={p.chave}>
                  <button type="button" onClick={() => onAba(p.aba)} data-pendencia-os={p.chave}
                    className={cn("w-full flex items-center gap-2.5 text-left text-sm rounded-lg px-3 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-acento",
                      p.nivel === "alerta" ? "bg-atrasado-claro text-atrasado-texto hover:brightness-[0.98]" : "bg-surface-page text-ink hover:bg-acento-claro")}>
                    {p.nivel === "alerta" ? <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="w-4 h-4 shrink-0 text-acento" aria-hidden="true" />}
                    <span className="flex-1">{p.texto}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Cartao titulo="Cliente e local" icone={User} dado="informacoes">
            <dl className="space-y-2 text-sm">
              <Info rotulo="Cliente">{os.cliente.nomeFantasia ?? os.cliente.nome}</Info>
              {os.unidade && (
                <Info rotulo="Endereço"><span className="inline-flex items-start gap-1"><MapPin className="w-3.5 h-3.5 mt-0.5 text-ink-subtle shrink-0" aria-hidden="true" />{os.unidade.nome}{os.unidade.cidade ? ` — ${os.unidade.cidade}/${os.unidade.estado}` : ""}</span></Info>
              )}
              {os.contrato && <Info rotulo="Contrato"><span className="font-mono">{os.contrato.numero}</span></Info>}
              <Info rotulo="Responsável">{os.responsavel?.nome ?? "—"}</Info>
              {os.criadoPor && <Info rotulo="Aberta por">{os.criadoPor.nome}</Info>}
            </dl>
          </Cartao>
          <Cartao titulo="Datas" icone={Clock} dado="datas">
            <dl className="space-y-2 text-sm">
              <Info rotulo="Abertura">{formatarDataHora(os.criadoEm)}</Info>
              <Info rotulo="Previsão">{formatarDiaCivil(os.previsaoConclusao)}</Info>
              {os.dataInicio && <Info rotulo="Início">{formatarDataHora(os.dataInicio)}</Info>}
              {os.dataConclusao && <Info rotulo="Conclusão">{formatarDataHora(os.dataConclusao)}</Info>}
            </dl>
          </Cartao>
        </div>

        <Cartao titulo="Descrição" icone={FileText} dado="descricao">
          <p className="text-sm text-ink whitespace-pre-wrap">{os.descricao}</p>
          {os.observacoes && (
            <>
              <h4 className="text-xs font-semibold text-ink-muted uppercase tracking-wider mt-4 mb-1">Observações</h4>
              <p className="text-sm text-ink-muted whitespace-pre-wrap">{os.observacoes}</p>
            </>
          )}
        </Cartao>
      </div>

      {/* Coluna lateral: prazos + histórico */}
      <div className="space-y-5">
        <Cartao titulo="Prazos" icone={CalendarClock} dado="prazos">
          <div className="space-y-2.5 text-sm">
            <LinhaPrazo rotulo="Previsão da OS" dia={os.previsaoConclusao} situacao={central.prazoOs} feminino />
            {comPrazo.map((a: any) => {
              const p = central.prazosAtividades.find((x) => x.id === a.id);
              return p ? <LinhaPrazo key={a.id} rotulo={a.titulo} dia={a.prazo} situacao={p} feminino /> : null;
            })}
            {!comPrazo.length && <p className="text-xs text-ink-muted">Nenhuma atividade com prazo próprio.</p>}
            <button type="button" onClick={() => onAba("atividades")} data-ver-sla className="w-full text-left text-xs font-medium text-acento hover:underline pt-1">
              SLA: {slaAtivos ? `${slaAtivos} em andamento${slaAtrasados ? ` (${slaAtrasados} atrasado${slaAtrasados > 1 ? "s" : ""})` : ""}` : "nenhum"} — gerenciar na aba Atividades
            </button>
          </div>
        </Cartao>

        <Cartao titulo="Histórico" icone={History} dado="historico">
          {historico.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum registro.</p>
          ) : (
            <ol className="relative ml-1 border-l border-surface-border">
              {visiveis.map((h: any) => (
                <li key={h.id} className="relative pl-4 pb-4" data-historico-item>
                  <span className="absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full bg-surface-border ring-2 ring-white" aria-hidden="true" />
                  <p className="text-[11px] text-ink-muted tabular-nums">{formatarDataHora(h.criadoEm)} — {h.usuario?.nome}</p>
                  <p className="text-sm text-ink font-medium leading-snug">{h.acao}</p>
                  {h.detalhes && <p className="text-xs text-ink-muted">{h.detalhes}</p>}
                </li>
              ))}
            </ol>
          )}
          {historico.length > 8 && (
            <button type="button" onClick={() => setHistoricoTodo((v) => !v)} data-historico-todo className="text-xs font-semibold text-acento hover:underline">
              {historicoTodo ? "Mostrar menos" : `Ver todo o histórico (${historico.length})`}
            </button>
          )}
        </Cartao>
      </div>
    </div>
  );
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-muted w-24 shrink-0">{rotulo}</dt>
      <dd className="text-ink min-w-0">{children}</dd>
    </div>
  );
}

function LinhaPrazo({ rotulo, dia, situacao, feminino }: { rotulo: string; dia: string | Date | null; situacao: CentralOs["prazoOs"]; feminino?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2" data-linha-prazo={situacao.situacao}>
      <span className="min-w-0 truncate text-ink">{rotulo}</span>
      <span className="shrink-0 text-xs text-ink-muted tabular-nums">{formatarDiaCivil(dia)}</span>
      <StatusPill tom={TOM_PRAZO[situacao.situacao] ?? "previsto"} tamanho="sm" className="shrink-0">{textoPrazo(situacao, feminino)}</StatusPill>
    </div>
  );
}
