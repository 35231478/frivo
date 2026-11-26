"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, Clock, FileText, History, ListChecks, MapPin, User } from "lucide-react";
import { OsPrazos } from "@/components/os/os-prazos";
import { Dica } from "@/components/ui/dica";
import { resumirHistorico } from "@/lib/os/historico";
import { cn, formatarDataHora } from "@/lib/utils";
import { formatarDiaCivil, textoPrazo } from "@/lib/os/prazos";
import type { CentralOs } from "@/lib/os/central";
import { Card, CardTitulo } from "@/components/ui/card";
import { StatusPill, TOM_PRAZO } from "@/components/ui/status-pill";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { EditarNoContexto } from "@/components/ui/select-cadastro-rapido";
import { CLIENTE, UNIDADE } from "@/components/cadastro-rapido/definicoes";
import { prazoEfetivo } from "@/lib/os/prazo-execucao";
import { AtrasoJustificado } from "@/components/os/central/atraso-justificado";
import { PrazoDeAtendimento } from "@/components/os/central/prazo-atendimento";

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

export function ResumoOs({ os, central, onAba, onAtualizado }: {
  os: any; central: CentralOs; onAba: (aba: string) => void;
  /** O cadastro do cliente ou da unidade foi corrigido daqui: a tela acompanha */
  onAtualizado?: (parcial: any) => void;
}) {
  const { pode } = usePermissoes();
  const historico: any[] = os.historico ?? [];
  const comPrazo = (os.atividades ?? []).filter((a: any) => a.prazo && a.status !== "CANCELADA");

  // Uma coluna de cartões (o Resumo divide a tela com o painel de Atividades): os pares ficam lado a lado só
  // quando a COLUNA das abas tem espaço (.os-pares, container query em app/globals.css) — não pela largura da tela.
  return (
    <div className="space-y-5" data-resumo-os>
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

        <div className="os-pares">
          <Cartao titulo="Cliente e local" icone={User} dado="informacoes">
            <dl className="space-y-2 text-sm">
              {/* Referência: o lápis corrige o CADASTRO (telefone, e-mail, contatos; nome e endereço da unidade) — vale em
                  todo lugar e continua disponível com a OS fechada (a trava é das linhas, não do cadastro) */}
              <Info rotulo="Cliente" acao={<EditarNoContexto id={os.cliente.id} rotulo="Editar o cadastro do cliente" edicao={CLIENTE.edicao()} />}>
                {os.cliente.nomeFantasia ?? os.cliente.nome}
              </Info>
              {os.unidade && (
                <Info rotulo="Endereço" acao={<EditarNoContexto id={os.unidade.id} rotulo="Editar o cadastro da unidade"
                  edicao={UNIDADE.edicao<{ id: string; nome: string; cidade?: string | null; estado?: string | null }>(os.cliente.id, (u) => onAtualizado?.({ unidade: { ...os.unidade, nome: u.nome, cidade: u.cidade ?? null, estado: u.estado ?? null } }))} />}>
                  <span className="flex items-start gap-1 min-w-0"><MapPin className="w-3.5 h-3.5 mt-0.5 text-ink-subtle shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">{os.unidade.nome}{os.unidade.cidade ? ` — ${os.unidade.cidade}/${os.unidade.estado}` : ""}</span></span>
                </Info>
              )}
              {os.contrato && <Info rotulo="Contrato"><span className="font-mono">{os.contrato.numero}</span></Info>}
              {/* OS gerada pelo cronograma de um PMOC: atalho para o plano (só vira link para quem vê o módulo) */}
              {os.pmoc && (
                <Info rotulo="PMOC">
                  {pode("pmoc", "visualizar")
                    ? <Link href={`/pmoc/${os.pmoc.id}?aba=cronograma`} data-pmoc-da-os className="text-acento hover:underline">{os.pmoc.nome}</Link>
                    : <span data-pmoc-da-os>{os.pmoc.nome}</span>}
                </Info>
              )}
              <Info rotulo="Responsável">{os.responsavel?.nome ?? "—"}</Info>
              {os.criadoPor && <Info rotulo="Aberta por">{os.criadoPor.nome}</Info>}
            </dl>
          </Cartao>
          <Cartao titulo="Datas" icone={Clock} dado="datas">
            <dl className="space-y-2 text-sm">
              <Info rotulo="Abertura">{formatarDataHora(os.criadoEm)}</Info>
              <Info rotulo="Data prevista">{formatarDiaCivil(os.previsaoConclusao)}</Info>
              {/* o prazo de execução: o próprio ou, sem ele, o dia previsto (lib/os/prazo-execucao.ts) */}
              <Info rotulo="Prazo">{formatarDiaCivil(prazoEfetivo(os))}</Info>
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

        <div className="os-pares">
        <div className="space-y-5 min-w-0">
        {/* O que o contrato prometeu ao cliente (comparecer / resolver) — só no chamado de cliente em contrato */}
        <PrazoDeAtendimento os={os} />
        {/* O compromisso interno com a equipe: até quando a OS e as atividades terminam */}
        <Cartao titulo="Prazo de execução" icone={CalendarClock} dado="prazos">
          <div className="space-y-2.5 text-sm">
            <LinhaPrazo rotulo="Prazo da OS" dia={prazoEfetivo(os)} situacao={central.prazoOs} feminino />
            {comPrazo.map((a: any) => {
              const p = central.prazosAtividades.find((x) => x.id === a.id);
              return p ? <LinhaPrazo key={a.id} rotulo={a.titulo} dia={a.prazo} situacao={p} feminino /> : null;
            })}
            {!comPrazo.length && <p className="text-xs text-ink-muted">Nenhuma atividade com prazo próprio.</p>}
            <AtrasoJustificado os={os} onAtualizado={(d) => onAtualizado?.(d)} />
          </div>
        </Cartao>
        </div>

        <Cartao titulo="Histórico" icone={History} dado="historico" className="min-w-0">
          <HistoricoOs historico={historico} />
        </Cartao>
        </div>

        {/* As etapas com prazo (por modelo) — a antiga aba "Prazos", que vivia dentro de Atividades: aqui, ao lado dos prazos */}
        <Card as="section" data-secao-sla data-cartao="etapas">
          <OsPrazos osId={os.id} />
        </Card>
    </div>
  );
}

/** Quantas linhas o cartão mostra antes de "Ver todo o histórico" */
const LINHAS_HISTORICO = 8;

/**
 * O histórico em duas leituras: o RESUMO do gestor (lib/os/historico: agrupado, sem códigos, com o status
 * automático junto da causa — cada linha agrupada abre os registros dela) e o REGISTRO COMPLETO, a lista
 * de auditoria exatamente como foi gravada.
 */
export function HistoricoOs({ historico }: { historico: any[] }) {
  const [modo, setModo] = useState<"resumo" | "registro">("resumo");
  const [todo, setTodo] = useState(false);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const linhas = useMemo(() => resumirHistorico(historico), [historico]);
  if (historico.length === 0) return <p className="text-sm text-ink-muted">Nenhum registro.</p>;

  const total = modo === "resumo" ? linhas.length : historico.length;
  const alternar = (id: string) => setAbertas((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ponto = <span className="absolute -left-[4.5px] top-1.5 w-2 h-2 rounded-full bg-surface-border ring-2 ring-white" aria-hidden="true" />;

  return (
    <div className="space-y-3" data-historico={modo}>
      <div className="flex items-center gap-1 text-xs" role="group" aria-label="Como ver o histórico">
        {(["resumo", "registro"] as const).map((m) => (
          <button key={m} type="button" onClick={() => { setModo(m); setTodo(false); }} aria-pressed={modo === m} data-modo-historico={m}
            className={cn("px-2.5 py-1 rounded-md font-medium transition-colors", modo === m ? "bg-surface-alt text-ink" : "text-ink-muted hover:text-ink")}>
            {m === "resumo" ? "Resumo" : "Registro completo"}
          </button>
        ))}
        <Dica rotulo="Histórico" texto="O resumo junta o que se repete (fotos, itens executados, edições seguidas) e mostra o status da OS junto do que o causou. O registro completo é a auditoria: cada evento como foi gravado, com data, hora e quem fez." />
      </div>
      <ol className="relative ml-1 border-l border-surface-border">
        {modo === "resumo"
          ? (todo ? linhas : linhas.slice(0, LINHAS_HISTORICO)).map((l) => (
            <li key={l.id} className="relative pl-4 pb-4" data-historico-item data-historico-qtd={l.quantidade}>
              {ponto}
              <p className="text-[11px] text-ink-muted tabular-nums">{formatarDataHora(l.quando)}{l.quem ? ` — ${l.quem}` : ""}</p>
              <p className="text-sm text-ink font-medium leading-snug">
                {l.titulo}
                {l.consequencia && <span className="ml-1.5 text-xs font-medium text-ink-muted" data-historico-consequencia>· {l.consequencia}</span>}
              </p>
              {l.detalhe && <p className="text-xs text-ink-muted break-words">{l.detalhe}</p>}
              {l.itens.length > 1 && (
                <>
                  <button type="button" onClick={() => alternar(l.id)} aria-expanded={abertas.has(l.id)} data-historico-abrir={l.id}
                    className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-semibold text-acento hover:underline">
                    <ChevronRight className={cn("w-3 h-3 transition-transform", abertas.has(l.id) && "rotate-90")} aria-hidden="true" />
                    {abertas.has(l.id) ? "Ocultar os registros" : `Ver os ${l.itens.length} registros`}
                  </button>
                  {abertas.has(l.id) && (
                    <ul className="mt-1 space-y-1 border-l border-surface-linha pl-3" data-historico-registros={l.id}>
                      {l.itens.map((r: any) => (
                        <li key={r.id} className="text-xs text-ink-muted">
                          <span className="tabular-nums">{formatarDataHora(r.criadoEm)}</span> — <span className="text-ink">{r.acao}</span>{r.detalhes ? `: ${r.detalhes}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </li>
          ))
          : (todo ? historico : historico.slice(0, LINHAS_HISTORICO)).map((h: any) => (
            <li key={h.id} className="relative pl-4 pb-4" data-historico-item data-historico-registro>
              {ponto}
              <p className="text-[11px] text-ink-muted tabular-nums">{formatarDataHora(h.criadoEm)} — {h.usuario?.nome}</p>
              <p className="text-sm text-ink font-medium leading-snug">{h.acao}</p>
              {h.detalhes && <p className="text-xs text-ink-muted break-words">{h.detalhes}</p>}
            </li>
          ))}
      </ol>
      {total > LINHAS_HISTORICO && (
        <button type="button" onClick={() => setTodo((v) => !v)} data-historico-todo className="text-xs font-semibold text-acento hover:underline">
          {todo ? "Mostrar menos" : modo === "resumo" ? `Ver todo o histórico (${linhas.length})` : `Ver todos os registros (${historico.length})`}
        </button>
      )}
    </div>
  );
}

function Info({ rotulo, children, acao }: { rotulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div className="flex gap-2 items-start">
      <dt className="text-ink-muted w-24 shrink-0">{rotulo}</dt>
      <dd className="text-ink min-w-0 flex-1 break-words">{children}</dd>
      {/* -my-1.5: o lápis não aumenta a altura da linha */}
      {acao && <dd className="shrink-0 -my-1.5">{acao}</dd>}
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
