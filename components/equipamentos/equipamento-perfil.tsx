"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn, formatarData, formatarDataHora, LABELS_STATUS_OS } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { EquipamentoAtivoBotao } from "@/components/equipamentos/equipamento-ativo-botao";
import { TipoBadge, TipoIcone } from "@/components/equipamentos/tipo-equipamento";
import { GarantiaSelo, StatusSelo } from "@/components/equipamentos/selos";
import type { EventoHistorico } from "@/lib/equipamento-historico";
import { situacaoGarantia, diasRestantesGarantia } from "@/lib/equipamento-garantia";
import {
  Pencil, QrCode, ClipboardList, User, ExternalLink, CircleCheck, History, Wrench, FileText, Camera,
  ChevronLeft, ChevronRight, ClipboardPlus, Printer, CalendarCheck, CalendarClock, Hash, ShieldCheck,
  Cpu, MapPin, IdCard, StickyNote, ListChecks,
} from "lucide-react";

interface Indicadores {
  ultimoAtendimento: string | null;
  proxima: { data: string; origem: string; osId: string | null } | null;
  totalAtendimentos: number;
}

interface Props {
  equipamento: any;
  tipoNome: string;
  historico: any[];
  linhaDoTempo: EventoHistorico[];
  indicadores: Indicadores;
  abaInicial?: string;
}

type Aba = "dados" | "atendimentos" | "formularios";
const ABAS_VALIDAS: Aba[] = ["dados", "atendimentos", "formularios"];

/** Aceita o nome antigo da aba (?aba=historico) para links já distribuídos. */
function resolverAba(aba?: string): Aba {
  if (aba === "historico") return "atendimentos";
  return ABAS_VALIDAS.includes(aba as Aba) ? (aba as Aba) : "dados";
}

const COR_STATUS: Record<string, string> = {
  CONCLUIDA: "text-emerald-700 bg-emerald-50",
  CANCELADA: "text-red-600 bg-red-50",
  EM_ANDAMENTO: "text-sky-700 bg-sky-50",
  AGENDADA: "text-indigo-700 bg-indigo-50",
};
const COR_PONTO: Record<string, string> = {
  CONCLUIDA: "bg-emerald-500",
  CANCELADA: "bg-red-400",
  EM_ANDAMENTO: "bg-sky-500",
  AGENDADA: "bg-indigo-400",
};

function haQuanto(iso: string) {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  if (dias < 365) { const m = Math.floor(dias / 30); return m === 1 ? "há 1 mês" : `há ${m} meses`; }
  const a = Math.floor(dias / 365);
  return a === 1 ? "há 1 ano" : `há ${a} anos`;
}
function emQuanto(iso: string) {
  const dias = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "amanhã";
  return `em ${dias} dias`;
}

export function EquipamentoPerfil({ equipamento: e, tipoNome, historico, linhaDoTempo, indicadores, abaInicial }: Props) {
  const { pode } = usePermissoes();
  const podeEditar = pode("equipamentos", "editar");
  const podeAbrirOs = pode("ordens", "criar");
  const podeEtiqueta = pode("qrcodes", "visualizar");
  // ?aba=atendimentos abre direto na linha do tempo (ex.: atalho do QR Code para a equipe)
  const [aba, setAba] = useState<Aba>(resolverAba(abaInicial));
  const [fotoAtual, setFotoAtual] = useState(0);
  const abasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (abaInicial && resolverAba(abaInicial) !== "dados") abasRef.current?.scrollIntoView({ block: "start" });
  }, [abaInicial]);

  const cliente = e.unidade?.cliente;
  const clienteNome = cliente ? (cliente.nomeFantasia ?? cliente.nome) : null;
  const titulo = e.nome ? e.nome : `${e.marca} ${e.modelo}`;
  const fotos: string[] = e.fotos ?? [];
  const diasGarantia = diasRestantesGarantia(e.garantiaAte);
  const situacao = situacaoGarantia(e.garantiaAte);

  // Links "ver todos os equipamentos deste local"
  const qsLocal = (nivel: "cliente" | "unidade" | "setor") => {
    const p = new URLSearchParams();
    if (cliente) p.set("cliente", cliente.id);
    if (nivel !== "cliente") p.set("unidade", e.unidadeId);
    if (nivel === "setor" && e.setor) p.set("setor", e.setor);
    return `/equipamentos?${p.toString()}`;
  };

  // "Abrir OS" já com cliente/unidade e a identificação do equipamento na descrição
  const novaOsHref = (() => {
    const p = new URLSearchParams();
    if (cliente) p.set("clienteId", cliente.id);
    p.set("unidadeId", e.unidadeId);
    const ident = [titulo, e.numeroSerie && `S/N ${e.numeroSerie}`, e.patrimonio && `TAG ${e.patrimonio}`].filter(Boolean).join(" · ");
    const local = [e.setor, e.localizacao].filter(Boolean).join(" · ");
    p.set("descricao", `Atendimento ao equipamento ${ident}${local ? ` (${local})` : ""}.`);
    return `/ordens/nova?${p.toString()}`;
  })();

  const abas: { id: Aba; label: string; icone: typeof History; badge?: number }[] = [
    { id: "dados", label: "Ficha técnica", icone: ListChecks },
    { id: "atendimentos", label: "Atendimentos", icone: History, badge: linhaDoTempo.length },
    { id: "formularios", label: "Formulários", icone: ClipboardList, badge: historico.length },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* ── HERO ── */}
      <section className="bg-white rounded-2xl border border-surface-border overflow-hidden">
        <div className="flex flex-col md:flex-row">
          {/* Imagem principal */}
          <div className="relative md:w-72 shrink-0 bg-surface-alt h-36 sm:h-48 md:h-auto md:min-h-[240px]">
            {fotos.length > 0 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fotos[Math.min(fotoAtual, fotos.length - 1)]} alt={titulo} className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 p-4 md:p-8"><TipoIcone tipo={e.tipo} tamanho="xl" /></div>
            )}
            <Link href="/equipamentos" className="absolute top-3 left-3 inline-flex items-center gap-1 bg-white/90 backdrop-blur text-ink text-xs font-medium rounded-full pl-1.5 pr-2.5 py-1 shadow-sm hover:bg-white">
              <ChevronLeft className="w-4 h-4" /> Equipamentos
            </Link>
            {fotos.length > 1 && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                {fotos.map((_, i) => (
                  <button key={i} onClick={() => setFotoAtual(i)} aria-label={`Foto ${i + 1}`}
                    className={cn("w-2 h-2 rounded-full transition-colors", i === fotoAtual ? "bg-white" : "bg-white/50")} />
                ))}
              </div>
            )}
          </div>

          {/* Identificação */}
          <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-3">
            {/* Breadcrumb de local */}
            <nav className="flex items-center gap-1 text-xs text-ink-muted flex-wrap" aria-label="Local do equipamento">
              <MapPin className="w-3.5 h-3.5 text-ink-subtle" />
              {clienteNome && <Link href={qsLocal("cliente")} className="hover:text-primary-600 font-medium">{clienteNome}</Link>}
              {e.unidade?.nome && (<><ChevronRight className="w-3 h-3 text-ink-subtle" /><Link href={qsLocal("unidade")} className="hover:text-primary-600">{e.unidade.nome}</Link></>)}
              {e.setor && (<><ChevronRight className="w-3 h-3 text-ink-subtle" /><Link href={qsLocal("setor")} className="hover:text-primary-600">{e.setor}</Link></>)}
              {e.localizacao && (<><ChevronRight className="w-3 h-3 text-ink-subtle" /><span className="text-ink">{e.localizacao}</span></>)}
            </nav>

            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-ink tracking-tight leading-tight">{titulo}</h1>
              <p className="text-sm text-ink-muted mt-0.5">
                {e.nome ? `${e.modelo} · ${e.marca}` : null}
                {e.numeroSerie && <span className="font-mono text-xs text-ink-subtle">{e.nome ? " · " : ""}S/N {e.numeroSerie}</span>}
                {e.patrimonio && <span className="font-mono text-xs text-ink-subtle"> · TAG {e.patrimonio}</span>}
              </p>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <TipoBadge tipo={e.tipo} label={tipoNome} />
              <StatusSelo ativo={e.ativo} />
              <GarantiaSelo fim={e.garantiaAte} />
              {e.qrcode && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full text-slate-600 bg-slate-100 font-mono">
                  <QrCode className="w-3 h-3" /> {e.qrcode.codigo}
                </span>
              )}
            </div>

            {/* Ações */}
            <div className="flex items-center gap-2 flex-wrap mt-auto pt-1">
              {podeAbrirOs && e.ativo && (
                <Link href={novaOsHref} className="inline-flex items-center gap-1.5 text-sm font-semibold bg-primary-500 hover:bg-primary-600 text-white rounded-lg px-3.5 py-2 shadow-sm">
                  <ClipboardPlus className="w-4 h-4" /> Abrir OS
                </Link>
              )}
              {e.qrcode && podeEtiqueta ? (
                <Link href={`/qrcodes/imprimir?ids=${e.qrcode.id}`} target="_blank" className="inline-flex items-center gap-1.5 text-sm text-ink border border-surface-border rounded-lg px-3 py-2 hover:border-primary-300 hover:text-primary-600">
                  <Printer className="w-4 h-4" /> Etiqueta QR
                </Link>
              ) : null}
              {podeEditar && (
                <Link href={`/equipamentos/${e.id}/editar?aba=qrcode`} className="inline-flex items-center gap-1.5 text-sm text-ink border border-surface-border rounded-lg px-3 py-2 hover:border-primary-300 hover:text-primary-600">
                  <QrCode className="w-4 h-4" /> {e.qrcode ? "QR Code" : "Gerar QR"}
                </Link>
              )}
              {podeEditar && (
                <Link href={`/equipamentos/${e.id}/editar`} className="inline-flex items-center gap-1.5 text-sm text-ink border border-surface-border rounded-lg px-3 py-2 hover:border-primary-300 hover:text-primary-600">
                  <Pencil className="w-4 h-4" /> Editar
                </Link>
              )}
              <EquipamentoAtivoBotao id={e.id} nome={titulo} ativo={e.ativo} variante="botao" />
            </div>
          </div>
        </div>

        {/* ── VISÃO RÁPIDA ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-surface-border divide-x divide-y lg:divide-y-0 divide-surface-border">
          <Indicador
            icone={CalendarCheck} rotulo="Último atendimento"
            valor={indicadores.ultimoAtendimento ? formatarData(indicadores.ultimoAtendimento) : "—"}
            detalhe={indicadores.ultimoAtendimento ? haQuanto(indicadores.ultimoAtendimento) : "Nenhum registrado"}
          />
          <Indicador
            icone={CalendarClock} rotulo="Próxima manutenção"
            valor={indicadores.proxima ? formatarData(indicadores.proxima.data) : "—"}
            detalhe={indicadores.proxima ? `${emQuanto(indicadores.proxima.data)} · ${indicadores.proxima.origem}` : "Nada agendado"}
            href={indicadores.proxima?.osId ? `/ordens/${indicadores.proxima.osId}` : undefined}
          />
          <Indicador
            icone={Wrench} rotulo="Atendimentos" valor={String(indicadores.totalAtendimentos)}
            detalhe="concluídos" onClick={() => setAba("atendimentos")}
          />
          <Indicador
            icone={ShieldCheck} rotulo="Garantia"
            valor={diasGarantia === null ? "—" : diasGarantia >= 0 ? `${diasGarantia} dias` : "Vencida"}
            detalhe={
              diasGarantia === null ? "Não informada"
                : diasGarantia >= 0 ? `restantes · até ${formatarData(e.garantiaAte)}`
                  : `há ${Math.abs(diasGarantia)} dias · ${formatarData(e.garantiaAte)}`
            }
            tom={situacao === "vencida" ? "text-red-600" : situacao === "vencendo" ? "text-amber-600" : undefined}
          />
        </div>
      </section>

      {/* ── Abas ── */}
      <div ref={abasRef} className="flex gap-1 border-b border-surface-border overflow-x-auto sticky top-0 z-10 bg-surface-page/95 backdrop-blur -mx-1 px-1 scroll-mt-2">
        {abas.map((a) => (
          <button key={a.id} onClick={() => setAba(a.id)}
            className={cn("inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
              aba === a.id ? "border-primary-500 text-primary-600" : "border-transparent text-ink-muted hover:text-ink")}>
            <a.icone className="w-4 h-4" />
            {a.label}
            {a.badge !== undefined && a.badge > 0 && <span className="text-[10px] bg-surface-alt text-ink-muted px-1.5 py-0.5 rounded-full">{a.badge}</span>}
          </button>
        ))}
      </div>

      {/* ── Ficha técnica ── */}
      {aba === "dados" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CardFicha titulo="Identificação" icone={IdCard} itens={[
            { label: "Tipo", valor: tipoNome },
            { label: "Marca", valor: e.marca },
            { label: "Modelo", valor: e.modelo },
            { label: "Nº de série", valor: e.numeroSerie, mono: true },
            { label: "Patrimônio / TAG", valor: e.patrimonio, mono: true },
            { label: "Ano de fabricação", valor: e.anoFabricacao },
          ]} />
          <CardFicha titulo="Especificações técnicas" icone={Cpu} itens={[
            { label: "Capacidade", valor: e.capacidade },
            { label: "Fluido refrigerante", valor: e.fluido },
            { label: "Tensão", valor: e.tensao },
            { label: "Potência", valor: e.potencia },
            { label: "Fase", valor: e.fase },
            { label: "Corrente nominal", valor: e.correnteNominal },
          ]} />
          <CardFicha
            titulo="Localização" icone={MapPin}
            acao={<Link href={qsLocal(e.setor ? "setor" : "unidade")} className="text-xs text-primary-600 hover:text-primary-700">Ver equipamentos deste local</Link>}
            itens={[
              { label: "Cliente", valor: clienteNome },
              { label: "Endereço / Unidade", valor: e.unidade?.nome },
              { label: "Setor", valor: e.setor },
              { label: "Ambiente", valor: e.localizacao },
              { label: "Instalação", valor: e.dataInstalacao ? formatarData(e.dataInstalacao) : null },
            ]}
          />
          <CardFicha titulo="Garantia" icone={ShieldCheck} itens={[
            { label: "Situação", valor: e.garantiaAte ? <GarantiaSelo fim={e.garantiaAte} /> : null },
            { label: "Início", valor: e.garantiaInicio ? formatarData(e.garantiaInicio) : null },
            { label: "Fim", valor: e.garantiaAte ? formatarData(e.garantiaAte) : null },
            { label: "Dias restantes", valor: diasGarantia !== null && diasGarantia >= 0 ? String(diasGarantia) : null },
          ]} vazio="Garantia não informada." />
          <CardFicha
            titulo="QR Code" icone={QrCode}
            acao={podeEditar ? <Link href={`/equipamentos/${e.id}/editar?aba=qrcode`} className="text-xs text-primary-600 hover:text-primary-700">{e.qrcode ? "Gerenciar" : "Gerar QR"}</Link> : undefined}
            itens={[
              { label: "Código", valor: e.qrcode?.codigo, mono: true },
              { label: "Situação", valor: e.qrcode ? (e.qrcode.ativo === false ? "Inativo" : "Vinculado") : null },
            ]}
            vazio="Nenhum QR Code vinculado."
          />
          {(e.observacoesTecnicas || e.observacoes) && (
            <section className="bg-white rounded-xl border border-surface-border p-4 space-y-3">
              <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><StickyNote className="w-4 h-4 text-primary-500" /> Observações</h3>
              {e.observacoesTecnicas && (
                <div>
                  <p className="text-[11px] text-ink-muted uppercase tracking-wide mb-0.5">Técnicas</p>
                  <p className="text-sm text-ink whitespace-pre-wrap">{e.observacoesTecnicas}</p>
                </div>
              )}
              {e.observacoes && (
                <div>
                  <p className="text-[11px] text-ink-muted uppercase tracking-wide mb-0.5">Gerais</p>
                  <p className="text-sm text-ink whitespace-pre-wrap">{e.observacoes}</p>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ── Atendimentos (linha do tempo) ── */}
      {aba === "atendimentos" && <LinhaDoTempo eventos={linhaDoTempo} onVerRespostas={() => setAba("formularios")} />}

      {/* ── Formulários (histórico por OS) ── */}
      {aba === "formularios" && (
        <div className="space-y-3">
          {historico.length === 0 ? (
            <Vazio icone={ClipboardList} texto="Nenhum formulário respondido para este equipamento." />
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

/* ───────── Visão rápida ───────── */
function Indicador({ icone: Icone, rotulo, valor, detalhe, tom, href, onClick }: {
  icone: typeof Wrench; rotulo: string; valor: string; detalhe: string; tom?: string; href?: string; onClick?: () => void;
}) {
  const conteudo = (
    <>
      <p className="text-[11px] font-medium text-ink-muted uppercase tracking-wide flex items-center gap-1.5">
        <Icone className="w-3.5 h-3.5" /> {rotulo}
      </p>
      <p className={cn("text-lg font-bold text-ink mt-1 tabular-nums leading-tight", tom)}>{valor}</p>
      <p className="text-[11px] text-ink-muted mt-0.5 line-clamp-2">{detalhe}</p>
    </>
  );
  const classe = "block text-left p-3.5 sm:p-4 min-w-0";
  if (href) return <Link href={href} className={cn(classe, "hover:bg-surface-alt/60")}>{conteudo}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cn(classe, "hover:bg-surface-alt/60")}>{conteudo}</button>;
  return <div className={classe}>{conteudo}</div>;
}

/* ───────── Ficha técnica ───────── */
function CardFicha({ titulo, icone: Icone, itens, acao, vazio }: {
  titulo: string; icone: typeof Wrench;
  itens: { label: string; valor?: React.ReactNode; mono?: boolean }[];
  acao?: React.ReactNode; vazio?: string;
}) {
  const preenchidos = itens.filter((i) => i.valor);
  return (
    <section className="bg-white rounded-xl border border-surface-border p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-ink flex items-center gap-2"><Icone className="w-4 h-4 text-primary-500" /> {titulo}</h3>
        {acao}
      </div>
      {preenchidos.length === 0 ? (
        <p className="text-sm text-ink-subtle">{vazio ?? "Nada informado."}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          {preenchidos.map((i) => (
            <div key={i.label} className="min-w-0">
              <dt className="text-[11px] text-ink-muted uppercase tracking-wide">{i.label}</dt>
              <dd className={cn("text-sm text-ink font-medium mt-0.5 break-words", i.mono && "font-mono text-[13px]")}>{i.valor}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/* ───────── Linha do tempo ───────── */
function LinhaDoTempo({ eventos, onVerRespostas }: { eventos: EventoHistorico[]; onVerRespostas: () => void }) {
  if (eventos.length === 0) return <Vazio icone={History} texto="Nenhum atendimento registrado para este equipamento." />;

  // Agrupa por mês/ano para leitura rápida
  const grupos: { chave: string; rotulo: string; itens: EventoHistorico[] }[] = [];
  for (const ev of eventos) {
    const d = new Date(ev.data);
    const chave = `${d.getFullYear()}-${d.getMonth()}`;
    let g = grupos[grupos.length - 1];
    if (!g || g.chave !== chave) {
      const rotulo = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
      g = { chave, rotulo: rotulo.charAt(0).toUpperCase() + rotulo.slice(1), itens: [] };
      grupos.push(g);
    }
    g.itens.push(ev);
  }

  return (
    <div className="space-y-5">
      {grupos.map((g) => (
        <div key={g.chave}>
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">{g.rotulo}</p>
          <ol className="relative ml-2 border-l-2 border-surface-border space-y-3">
            {g.itens.map((ev) => {
              const d = new Date(ev.data);
              return (
                <li key={ev.chave} className="relative pl-5">
                  <span className={cn("absolute -left-[7px] top-4 w-3 h-3 rounded-full ring-4 ring-surface-page", COR_PONTO[ev.status] ?? "bg-primary-400")} />
                  <div className="bg-white rounded-xl border border-surface-border p-3.5 sm:p-4">
                    <div className="flex items-start gap-3">
                      {/* Data em destaque */}
                      <div className="text-center shrink-0 w-11">
                        <p className="text-lg font-bold text-ink leading-none tabular-nums">{String(d.getDate()).padStart(2, "0")}</p>
                        <p className="text-[10px] text-ink-muted uppercase mt-0.5">{d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-ink leading-snug">
                            {ev.tipoServico && (
                              <span className="inline-block align-middle text-[10px] font-medium text-white px-1.5 py-px rounded-full mr-1.5" style={{ backgroundColor: ev.tipoServico.cor ?? "#64748B" }}>
                                {ev.tipoServico.nome}
                              </span>
                            )}
                            {ev.titulo}
                          </p>
                          <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap shrink-0", COR_STATUS[ev.status] ?? "text-ink-muted bg-surface-alt")}>
                            {LABELS_STATUS_OS[ev.status] ?? ev.status}
                          </span>
                        </div>
                        <p className="text-[11px] text-ink-muted mt-1 flex items-center gap-3 flex-wrap">
                          {ev.tecnico && <span className="flex items-center gap-1"><Wrench className="w-3 h-3" />{ev.tecnico}</span>}
                          {ev.equipamentoFeito && <span className="flex items-center gap-1 text-emerald-600"><CircleCheck className="w-3 h-3" />Equipamento atendido</span>}
                          <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{ev.os.numero}</span>
                        </p>

                        {ev.resumo && <p className="text-xs text-ink mt-2 whitespace-pre-wrap line-clamp-3">{ev.resumo}</p>}

                        {ev.formularios.length > 0 && (
                          <div className="mt-2.5 space-y-2">
                            {ev.formularios.map((fm, i) => (
                              <div key={i}>
                                <p className="text-xs text-ink-muted flex items-center gap-1.5">
                                  <ClipboardList className="w-3.5 h-3.5 text-primary-500" />{fm.nome}
                                  {fm.fotos.length > 0 && <span className="inline-flex items-center gap-0.5 text-ink-subtle"><Camera className="w-3 h-3" />{fm.fotos.length}</span>}
                                </p>
                                {fm.fotos.length > 0 && (
                                  <div className="flex gap-1.5 mt-1.5 overflow-x-auto">
                                    {fm.fotos.slice(0, 6).map((url, j) => (
                                      <a key={j} href={url} target="_blank" rel="noreferrer" className="shrink-0">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={url} alt={fm.nome} loading="lazy" className="w-14 h-14 rounded-lg object-cover border border-surface-border" />
                                      </a>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 flex items-center gap-4 flex-wrap text-xs">
                          <Link href={`/ordens/${ev.os.id}`} className="font-medium text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
                            Abrir OS <ExternalLink className="w-3 h-3" />
                          </Link>
                          {ev.formularios.length > 0 && (
                            <button type="button" onClick={onVerRespostas} className="text-primary-600 hover:text-primary-700 inline-flex items-center gap-1">
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
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

function Vazio({ icone: Icone, texto }: { icone: typeof History; texto: string }) {
  return (
    <div className="bg-white rounded-xl border border-surface-border text-center py-12">
      <Icone className="w-7 h-7 text-ink-subtle mx-auto mb-2" />
      <p className="text-sm text-ink-muted">{texto}</p>
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
