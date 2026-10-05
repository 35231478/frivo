"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { cn, formatarData, formatarDataHora, LABELS_STATUS_OS } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { EquipamentoAtivoBotao } from "@/components/equipamentos/equipamento-ativo-botao";
import type { EventoHistorico } from "@/lib/equipamento-historico";
import {
  Pencil, QrCode, ClipboardList, User, ExternalLink, CircleCheck, History, Wrench, FileText, Camera,
} from "lucide-react";

interface Props {
  equipamento: any;
  tipoNome: string;
  historico: any[];
  linhaDoTempo: EventoHistorico[];
  abaInicial?: string;
}

type Aba = "dados" | "historico" | "formularios";
const ABAS_VALIDAS: Aba[] = ["dados", "historico", "formularios"];

const COR_STATUS: Record<string, string> = {
  CONCLUIDA: "text-emerald-700 bg-emerald-50",
  CANCELADA: "text-red-600 bg-red-50",
  EM_ANDAMENTO: "text-sky-700 bg-sky-50",
  AGENDADA: "text-indigo-700 bg-indigo-50",
};

export function EquipamentoPerfil({ equipamento: e, tipoNome, historico, linhaDoTempo, abaInicial }: Props) {
  const { pode } = usePermissoes();
  const podeEditar = pode("equipamentos", "editar");
  // ?aba=historico abre direto na linha do tempo (ex.: link "histórico completo" do QR Code)
  const [aba, setAba] = useState<Aba>(ABAS_VALIDAS.includes(abaInicial as Aba) ? (abaInicial as Aba) : "dados");
  const cliente = e.unidade?.cliente;
  const titulo = e.nome ? e.nome : `${e.marca} ${e.modelo}`;

  const ultimaManutencao = linhaDoTempo.find((ev) => ev.status === "CONCLUIDA")?.data ?? null;
  const proximaAgendada = [...linhaDoTempo].reverse().find((ev) => ev.status === "AGENDADA" && new Date(ev.data) >= new Date())?.data ?? null;

  const abas: { id: Aba; label: string; badge?: number }[] = [
    { id: "dados", label: "Ficha técnica" },
    { id: "historico", label: "Histórico", badge: linhaDoTempo.length },
    { id: "formularios", label: "Formulários", badge: historico.length },
  ];

  const identificacao: { label: string; valor?: string | null }[] = [
    { label: "Tipo", valor: tipoNome },
    { label: "Marca", valor: e.marca },
    { label: "Modelo", valor: e.modelo },
    { label: "Nº de série", valor: e.numeroSerie },
    { label: "Patrimônio / TAG", valor: e.patrimonio },
    { label: "Ano fabricação", valor: e.anoFabricacao },
  ];
  const tecnicos: { label: string; valor?: string | null }[] = [
    { label: "Capacidade", valor: e.capacidade },
    { label: "Fluido refrigerante", valor: e.fluido },
    { label: "Tensão", valor: e.tensao },
    { label: "Potência", valor: e.potencia },
    { label: "Fase", valor: e.fase },
    { label: "Corrente nominal", valor: e.correnteNominal },
  ];
  const localizacao: { label: string; valor?: string | null }[] = [
    { label: "Cliente", valor: cliente ? (cliente.nomeFantasia ?? cliente.nome) : null },
    { label: "Endereço / Unidade", valor: e.unidade?.nome },
    { label: "Ambiente / setor", valor: e.localizacao },
  ];
  const datas: { label: string; valor?: string | null }[] = [
    { label: "Instalação", valor: e.dataInstalacao ? formatarData(e.dataInstalacao) : null },
    { label: "Garantia até", valor: e.garantiaAte ? formatarData(e.garantiaAte) : null },
    { label: "Última manutenção", valor: ultimaManutencao ? formatarData(ultimaManutencao) : null },
    { label: "Próxima agendada", valor: proximaAgendada ? formatarData(proximaAgendada) : null },
    { label: "QR Code", valor: e.qrcode?.codigo ?? null },
  ];

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={titulo}
        description={`${tipoNome}${cliente ? ` · ${cliente.nomeFantasia ?? cliente.nome}` : ""}${e.ativo ? "" : " · Inativo"}`}
        backHref="/equipamentos"
        actions={
          <>
            <EquipamentoAtivoBotao id={e.id} nome={titulo} ativo={e.ativo} variante="botao" />
            {podeEditar && (
              <>
                <Link href={`/equipamentos/${e.id}/editar?aba=qrcode`} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-primary-600 border border-surface-border rounded-lg px-3 py-2">
                  <QrCode className="w-4 h-4" /> QR Code
                </Link>
                <Link href={`/equipamentos/${e.id}/editar`} className="inline-flex items-center gap-1.5 text-sm bg-primary-500 hover:bg-primary-600 text-white rounded-lg px-3 py-2">
                  <Pencil className="w-4 h-4" /> Editar
                </Link>
              </>
            )}
          </>
        }
      />

      {/* Abas */}
      <div className="flex gap-1 border-b border-surface-border mb-4 overflow-x-auto">
        {abas.map((a) => (
          <button key={a.id} onClick={() => setAba(a.id)}
            className={cn("px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
              aba === a.id ? "border-primary-500 text-primary-600" : "border-transparent text-ink-muted hover:text-ink")}>
            {a.label}
            {a.badge !== undefined && a.badge > 0 && <span className="ml-1.5 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{a.badge}</span>}
          </button>
        ))}
      </div>

      {/* ── Ficha técnica ── */}
      {aba === "dados" && (
        <div className="bg-white rounded-xl border border-surface-border p-5 space-y-5">
          <BlocoSpecs titulo="Identificação" itens={identificacao} />
          <BlocoSpecs titulo="Dados técnicos" itens={tecnicos} />
          <BlocoSpecs titulo="Localização" itens={localizacao} />
          <BlocoSpecs titulo="Datas e manutenção" itens={datas} />
          {e.observacoesTecnicas && (
            <div className="pt-4 border-t border-surface-border">
              <p className="text-[11px] text-ink-muted uppercase tracking-wide mb-1">Observações técnicas</p>
              <p className="text-sm text-ink whitespace-pre-wrap">{e.observacoesTecnicas}</p>
            </div>
          )}
          {e.observacoes && (
            <div className="pt-4 border-t border-surface-border">
              <p className="text-[11px] text-ink-muted uppercase tracking-wide mb-1">Observações</p>
              <p className="text-sm text-ink whitespace-pre-wrap">{e.observacoes}</p>
            </div>
          )}
        </div>
      )}

      {/* ── Histórico (linha do tempo de atendimentos) ── */}
      {aba === "historico" && (
        linhaDoTempo.length === 0 ? (
          <div className="bg-white rounded-xl border border-surface-border text-center py-10">
            <History className="w-6 h-6 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-ink-muted">Nenhum atendimento registrado para este equipamento.</p>
          </div>
        ) : (
          <ol className="relative ml-3 border-l border-surface-border space-y-4">
            {linhaDoTempo.map((ev) => (
              <li key={ev.chave} className="ml-5">
                <span className={cn(
                  "absolute -left-[7px] mt-4 w-3.5 h-3.5 rounded-full border-2 border-white",
                  ev.status === "CONCLUIDA" ? "bg-emerald-500" : ev.status === "CANCELADA" ? "bg-red-400" : "bg-primary-400",
                )} />
                <div className="bg-white rounded-xl border border-surface-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] text-ink-muted">{formatarData(ev.data)}</p>
                      <p className="text-sm font-semibold text-ink mt-0.5 flex items-center gap-2 flex-wrap">
                        {ev.tipoServico && (
                          <span className="text-[10px] font-medium text-white px-1.5 py-px rounded-full" style={{ backgroundColor: ev.tipoServico.cor ?? "#64748B" }}>
                            {ev.tipoServico.nome}
                          </span>
                        )}
                        <span className="truncate">{ev.titulo}</span>
                      </p>
                      <p className="text-[11px] text-ink-muted mt-1 flex items-center gap-3 flex-wrap">
                        {ev.tecnico && <span className="flex items-center gap-1"><Wrench className="w-3 h-3" />{ev.tecnico}</span>}
                        {ev.equipamentoFeito && <span className="flex items-center gap-1 text-emerald-600"><CircleCheck className="w-3 h-3" />Equipamento atendido</span>}
                      </p>
                    </div>
                    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap shrink-0", COR_STATUS[ev.status] ?? "text-ink-muted bg-surface-alt")}>
                      {LABELS_STATUS_OS[ev.status] ?? ev.status}
                    </span>
                  </div>

                  {ev.resumo && <p className="text-xs text-ink mt-2 whitespace-pre-wrap line-clamp-3">{ev.resumo}</p>}

                  {ev.formularios.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {ev.formularios.map((f, i) => (
                        <div key={i} className="flex items-center gap-2 flex-wrap text-xs">
                          <span className="inline-flex items-center gap-1 text-ink-muted"><ClipboardList className="w-3.5 h-3.5 text-primary-500" />{f.nome}</span>
                          {f.fotos.length > 0 && <span className="inline-flex items-center gap-1 text-ink-subtle"><Camera className="w-3 h-3" />{f.fotos.length}</span>}
                          {f.fotos.slice(0, 4).map((url, j) => (
                            <a key={j} href={url} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={f.nome} className="w-9 h-9 rounded-md object-cover border border-surface-border" />
                            </a>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 pt-2 border-t border-surface-border/60 flex items-center gap-4 flex-wrap text-[11px]">
                    <Link href={`/ordens/${ev.os.id}`} className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
                      OS {ev.os.numero} <ExternalLink className="w-3 h-3" />
                    </Link>
                    {ev.formularios.length > 0 && (
                      <button type="button" onClick={() => setAba("formularios")} className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
                        <ClipboardList className="w-3 h-3" /> Ver respostas
                      </button>
                    )}
                    {ev.atividadeId && ev.status === "CONCLUIDA" && (
                      <a href={`/relatorio/atividade/${ev.atividadeId}`} target="_blank" rel="noreferrer" className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Relatório
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )
      )}

      {/* ── Formulários (histórico por OS) ── */}
      {aba === "formularios" && (
        <div className="space-y-3">
          {historico.length === 0 ? (
            <div className="bg-white rounded-xl border border-surface-border text-center py-10">
              <ClipboardList className="w-6 h-6 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-ink-muted">Nenhum formulário respondido para este equipamento.</p>
            </div>
          ) : (
            historico.map((h) => (
              <div key={h.chave} className="bg-white rounded-xl border border-surface-border overflow-hidden">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-surface-alt border-b border-surface-border">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink flex items-center gap-2">
                      <ClipboardList className="w-3.5 h-3.5 text-primary-500" /> {h.formularioNome}
                    </p>
                    <p className="text-[11px] text-ink-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {h.tipoOs && <span className="text-white px-1.5 py-px rounded-full" style={{ backgroundColor: h.tipoOs.cor }}>{h.tipoOs.nome}</span>}
                      <span>{formatarDataHora(h.respondidoEm)}</span>
                      {h.respondidoPor && <span className="flex items-center gap-1"><User className="w-3 h-3" />{h.respondidoPor}</span>}
                    </p>
                  </div>
                  <Link href={`/ordens/${h.osId}`} className="text-[11px] text-primary-600 hover:text-primary-700 flex items-center gap-1 whitespace-nowrap shrink-0">
                    OS {h.osNumero} <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
                <div className="divide-y divide-surface-border/60">
                  {h.campos.map((c: any, i: number) => (
                    <div key={i} className="flex items-start justify-between gap-4 px-4 py-2">
                      <span className="text-xs text-ink-muted">{c.label}</span>
                      <span className="text-sm text-ink text-right max-w-[60%]">{renderValor(c)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BlocoSpecs({ titulo, itens }: { titulo: string; itens: { label: string; valor?: string | null }[] }) {
  const preenchidos = itens.filter((s) => s.valor);
  if (preenchidos.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-ink mb-2">{titulo}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
        {preenchidos.map((s) => (
          <div key={s.label}>
            <p className="text-[11px] text-ink-muted uppercase tracking-wide">{s.label}</p>
            <p className="text-sm text-ink font-medium">{s.valor}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderValor(c: any) {
  if (c.tipo === "FOTO") {
    return c.arquivoUrl
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={c.arquivoUrl} alt={c.label} className="w-14 h-14 rounded-lg object-cover border border-surface-border inline-block" />
      : <span className="text-ink-muted">—</span>;
  }
  if (c.tipo === "SIM_NAO") {
    const sim = c.resposta === "Sim" || c.resposta === "true";
    return <span className={cn("inline-flex items-center gap-1", sim ? "text-green-600" : "text-ink")}>{sim && <CircleCheck className="w-3.5 h-3.5" />}{c.resposta || "—"}</span>;
  }
  return <span>{c.resposta || "—"}</span>;
}
