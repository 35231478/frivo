"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Ban, CalendarRange, CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, Eye, FileText,
  Loader2, RefreshCw, RotateCcw, Search, Send, Sigma, X, XCircle, FileClock,
} from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { ItemMenu, MenuAcoes } from "@/components/ui/menu-acoes";
import { Dica } from "@/components/ui/dica";
import { InputData } from "@/components/ui/input-data";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/avisos";
import { Paginacao, ListaVazia } from "@/components/listagem/listagem-ui";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { cn, formatarData, formatarDataHora, formatarMoeda } from "@/lib/utils";
import { formatarDocumento } from "@/lib/documento";
import { LABEL_AMBIENTE } from "@/lib/nfse/regras";
import {
  acoesDaNota, dataDaNota, GRUPOS_SITUACAO, hrefMedicao, hrefOs, mesAtual, mesVizinho, motivoSemArquivo, rotuloMes,
  TOM_STATUS_NOTA, type GrupoSituacao,
} from "@/lib/nfse/central";
import type { DadosCentral, DetalheNota, NotaLinha } from "@/lib/nfse/central-server";

/**
 * Tela central "Notas fiscais de serviço" (Financeiro › Fiscal): período (mês com ‹ › ou
 * intervalo), busca, situação e ambiente na URL (filtro no servidor); cards do período; a lista
 * (tabela no desktop, cartões no celular) e, por nota, só as ações que funcionam no status dela.
 */
export function NotasCentralView({ dados }: { dados: DadosCentral }) {
  const router = useRouter();
  const { filtros, resumo } = dados;
  const { busca, setBusca, navegar, pendente } = useListagemUrl({ chave: "notas-fiscais", qAtual: filtros.q, paramBusca: "q", lembrarFiltros: false });
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [consultando, setConsultando] = useState<string | null>(null);
  const [versaoDetalhe, setVersaoDetalhe] = useState(0);

  const reconsultar = useCallback(async (id: string) => {
    setConsultando(id);
    try {
      const r = await fetch(`/api/fiscal/notas/${id}/consultar`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { toast(d.erro ?? "Não foi possível consultar o PlugNotas.", "erro"); return; }
      toast(d.status === "CONCLUIDO" ? "Nota autorizada." : d.status === "REJEITADO" ? "A prefeitura rejeitou a nota." : "Status consultado no PlugNotas.", d.status === "REJEITADO" ? "erro" : "sucesso");
      setVersaoDetalhe((v) => v + 1);
      router.refresh();
    } catch { toast("Sem conexão. Tente novamente.", "erro"); } finally { setConsultando(null); }
  }, [router]);

  const cardSituacao = (g: GrupoSituacao) => ({ ativo: filtros.situacao === g, onClick: () => navegar({ situacao: filtros.situacao === g ? null : g }) });

  return (
    <div className="space-y-5" data-notas-central>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary-50 rounded-lg"><FileText className="w-5 h-5 text-primary-600" /></div>
        <h1 className="page-title">Notas fiscais de serviço</h1>
        <Dica texto="NFS-e emitidas pelo PlugNotas a partir das medições e das OS concluídas." rotulo="Notas fiscais de serviço" lado="direita" />
      </div>

      <BarraPeriodo periodo={filtros.periodo} navegar={navegar} />

      {/* Cards do período (e do ambiente escolhido) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-cards>
        <Card id="aberto" rotulo="Em aberto" icone={FileClock} cor="text-previsto-texto" q={resumo.aberto.q} v={resumo.aberto.v}
          unidade={["medição", "medições"]}
          dica="Medições aprovadas no período (pedido de compra recebido) ainda sem NFS-e." href="/financeiro/medicoes?status=PC_RECEBIDO" />
        <Card id="transmissao" rotulo="Em transmissão" icone={Send} cor="text-atencao-texto" q={resumo.transmissao.q} v={resumo.transmissao.v} {...cardSituacao("transmissao")} />
        <Card id="emitidas" rotulo="Emitidas" icone={CheckCircle2} cor="text-ok-texto" q={resumo.emitidas.q} v={resumo.emitidas.v} {...cardSituacao("emitidas")} />
        <Card id="falha" rotulo="Com falha" icone={XCircle} cor="text-atrasado-texto" q={resumo.falha.q} v={resumo.falha.v} {...cardSituacao("falha")} />
        <Card id="canceladas" rotulo="Canceladas" icone={Ban} cor="text-ink-muted" q={resumo.canceladas.q} v={resumo.canceladas.v} {...cardSituacao("canceladas")} />
        <Card id="total" rotulo="Total emitido" icone={Sigma} cor="text-primary-600" v={resumo.total.v}
          legenda={`${resumo.total.q} ${resumo.total.q === 1 ? "nota" : "notas"} no período`} dica="Soma dos serviços das notas autorizadas no período." />
      </div>

      <div className="card overflow-hidden">
        {/* Busca + situação + ambiente */}
        <div className="p-3 border-b border-surface-border flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[220px]">
            {pendente
              ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle animate-spin pointer-events-none" />
              : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />}
            <input value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar notas"
              placeholder="Número, tomador (nome ou CNPJ), OS ou medição" className={cn(INPUT, "w-full pl-9")} data-busca />
          </div>
          <select value={filtros.situacao} onChange={(e) => navegar({ situacao: e.target.value || null })} aria-label="Situação" className={cn(INPUT, "flex-1 sm:flex-none")} data-filtro-situacao>
            <option value="">Todas as situações</option>
            {(Object.keys(GRUPOS_SITUACAO) as GrupoSituacao[]).map((g) => <option key={g} value={g}>{GRUPOS_SITUACAO[g].rotulo}</option>)}
          </select>
          <select value={filtros.ambiente} onChange={(e) => navegar({ ambiente: e.target.value || null })} aria-label="Ambiente" className={cn(INPUT, "flex-1 sm:flex-none")} data-filtro-ambiente>
            <option value="">Todos os ambientes</option>
            <option value="HOMOLOGACAO">Homologação</option>
            <option value="PRODUCAO">Produção</option>
          </select>
        </div>

        {dados.notas.length === 0 ? (
          <ListaVazia mensagem={`Nenhuma nota em ${filtros.periodo.tipo === "mes" ? filtros.periodo.rotulo.toLowerCase() : "o período"}`} busca={filtros.q || undefined} onLimpar={() => { setBusca(""); navegar({ q: null }); }} />
        ) : (
          <>
            {/* Desktop: tabela. Ações fixas à direita: com nomes/motivos longos a tabela rola, as ações não somem */}
            <div className="hidden md:block overflow-x-auto" data-tabela-rolagem>
              <table className="w-full text-sm" data-tabela>
                <thead className="bg-surface-alt border-b border-surface-border">
                  <tr>
                    {["Situação", "Número", "Data", "Tomador", "Origem"].map((h) => <th key={h} className={TH}>{h}</th>)}
                    <th className={cn(TH, "text-right")}>Valor dos serviços</th>
                    <th className={cn(TH, "hidden 2xl:table-cell")}>Ambiente</th>
                    <th className={cn(TH, "text-right sticky right-0 bg-surface-alt")}><span className="sr-only">Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {dados.notas.map((n) => (
                    <tr key={n.id} className="group border-b border-surface-border last:border-b-0 hover:bg-surface-alt/60 align-top" data-nota={n.id} data-status={n.status}>
                      <td className="px-3 py-3">
                        <Situacao n={n} />
                        <span className="2xl:hidden mt-1 inline-flex"><Ambiente a={n.ambiente} /></span>
                      </td>
                      <td className="px-3 py-3 font-mono text-ink whitespace-nowrap">{n.numero ?? "—"}</td>
                      <td className="px-3 py-3 text-ink-muted whitespace-nowrap"><DataNota n={n} /></td>
                      <td className="px-3 py-3 max-w-[200px]">
                        <p className="font-medium text-ink truncate" title={n.tomadorNome}>{n.tomadorNome}</p>
                        <p className="text-xs text-ink-subtle whitespace-nowrap">{formatarDocumento(n.tomadorCpfCnpj)}</p>
                      </td>
                      <td className="px-3 py-3"><Origem n={n} /></td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink whitespace-nowrap">{formatarMoeda(n.valorServicos)}</td>
                      <td className="px-3 py-3 hidden 2xl:table-cell"><Ambiente a={n.ambiente} /></td>
                      <td className="px-2 py-2.5 text-right sticky right-0 bg-white group-hover:bg-surface-alt" data-celula-acoes>
                        <AcoesNota n={n} onDetalhes={() => setDetalheId(n.id)} onReconsultar={() => reconsultar(n.id)} consultando={consultando === n.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Celular: cartões (nada de tabela cortada) */}
            <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
              {dados.notas.map((n) => (
                <li key={n.id} className="p-3 space-y-2" data-nota={n.id} data-status={n.status}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <Situacao n={n} />
                      <p className="font-medium text-ink truncate">{n.tomadorNome}</p>
                      <p className="text-xs text-ink-subtle">{formatarDocumento(n.tomadorCpfCnpj)}</p>
                    </div>
                    <AcoesNota n={n} onDetalhes={() => setDetalheId(n.id)} onReconsultar={() => reconsultar(n.id)} consultando={consultando === n.id} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-ink-muted">
                    <span>Nº <span className="font-mono text-ink">{n.numero ?? "—"}</span> · <DataNota n={n} /></span>
                    <span className="font-semibold text-sm text-ink tabular-nums">{formatarMoeda(n.valorServicos)}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><Origem n={n} /><Ambiente a={n.ambiente} /></div>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="px-4 py-3 border-t border-surface-border bg-surface-alt/40">
          <Paginacao total={dados.total} pagina={dados.pagina} porPagina={dados.porPagina} onNavegar={navegar} rotulo={dados.total === 1 ? "nota" : "notas"} />
        </div>
      </div>

      <GavetaNota id={detalheId} versao={versaoDetalhe} onFechar={() => setDetalheId(null)}
        onReconsultar={reconsultar} consultando={!!detalheId && consultando === detalheId} />
    </div>
  );
}

/** Altura máxima do menu ⋮ (7 itens): abaixo disso de espaço, ele abre para cima */
const INPUT = "bg-white border border-surface-border rounded-lg px-3 py-2 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";
const TH = "text-left px-3 py-3 font-semibold text-ink-muted text-xs uppercase tracking-wider whitespace-nowrap";

/* ───────── Período: ‹ mês › ou intervalo personalizado ───────── */
function BarraPeriodo({ periodo, navegar }: { periodo: DadosCentral["filtros"]["periodo"]; navegar: (m: Record<string, string | null>) => void }) {
  const [personalizado, setPersonalizado] = useState(periodo.tipo === "intervalo");
  const [de, setDe] = useState(periodo.de ?? "");
  const [ate, setAte] = useState(periodo.ate ?? "");
  const mes = periodo.mes ?? mesAtual();
  const irMes = (m: string) => { setPersonalizado(false); navegar({ mes: m === mesAtual() ? null : m, de: null, ate: null }); };
  return (
    <div className="flex flex-wrap items-center gap-2" data-periodo={periodo.tipo}>
      {!personalizado ? (
        <div className="inline-flex items-center rounded-lg border border-surface-border bg-white">
          <button type="button" onClick={() => irMes(mesVizinho(mes, -1))} aria-label="Mês anterior" className="p-2 text-ink-muted hover:text-primary-600" data-mes-anterior><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-2 min-w-[9.5rem] text-center text-sm font-semibold text-ink" data-mes-rotulo>{rotuloMes(mes)}</span>
          <button type="button" onClick={() => irMes(mesVizinho(mes, 1))} aria-label="Mês seguinte" className="p-2 text-ink-muted hover:text-primary-600" data-mes-seguinte><ChevronRight className="w-4 h-4" /></button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2" data-intervalo>
          <div className="w-40"><InputData value={de} onChange={setDe} aria-label="De" /></div>
          <span className="text-sm text-ink-muted pb-2">até</span>
          <div className="w-40"><InputData value={ate} onChange={setAte} aria-label="Até" /></div>
          <button type="button" onClick={() => navegar({ de: de || null, ate: ate || null, mes: null })} disabled={!de && !ate}
            className="text-sm font-semibold text-white bg-primary-500 hover:bg-primary-600 px-4 py-2 rounded-lg disabled:opacity-50" data-aplicar-intervalo>Aplicar</button>
        </div>
      )}
      <button type="button" onClick={() => (personalizado ? irMes(mesAtual()) : setPersonalizado(true))}
        className="inline-flex items-center gap-1.5 text-sm text-acento hover:underline px-1" data-alternar-periodo>
        {personalizado ? <><X className="w-3.5 h-3.5" /> Voltar ao mês atual</> : <><CalendarRange className="w-3.5 h-3.5" /> Período personalizado</>}
      </button>
      {periodo.tipo === "intervalo" && <span className="text-xs text-ink-muted" data-periodo-rotulo>{periodo.rotulo}</span>}
    </div>
  );
}

/* ───────── Card de resumo ───────── */
function Card({ id, rotulo, icone: Icone, cor, q, v, legenda, unidade, dica, href, ativo, onClick }: {
  id: string; rotulo: string; icone: React.ComponentType<{ className?: string }>; cor: string; q?: number; v: number;
  legenda?: string; unidade?: [string, string]; dica?: string; href?: string; ativo?: boolean; onClick?: () => void;
}) {
  const corpo = (
    <>
      <div className="flex items-start justify-between gap-1">
        <Icone className={cn("w-5 h-5", cor)} />
        {ativo && <X className="w-3.5 h-3.5 text-ink-subtle" />}
      </div>
      <p className="text-xs text-ink-muted mt-2 flex items-center gap-1">{rotulo}{dica && <Dica texto={dica} rotulo={rotulo} />}</p>
      <p className="text-lg font-bold text-ink mt-0.5 tabular-nums" data-card-valor>{formatarMoeda(v)}</p>
      <p className="text-[11px] text-ink-subtle mt-0.5" data-card-qtd>{legenda ?? `${q} ${unidade ? (q === 1 ? unidade[0] : unidade[1]) : q === 1 ? "nota" : "notas"}`}</p>
    </>
  );
  const cls = cn("block text-left rounded-card border border-surface-border bg-white p-3.5 transition-all", (href || onClick) && "hover:shadow-card hover:border-primary-200",
    ativo && "bg-primary-50 ring-2 ring-offset-1 ring-primary-200");
  if (href) return <Link href={href} className={cls} data-card={id}>{corpo}</Link>;
  if (onClick) return <button type="button" onClick={onClick} aria-pressed={!!ativo} className={cls} data-card={id}>{corpo}</button>;
  return <div className={cls} data-card={id}>{corpo}</div>;
}

/* ───────── Células ───────── */
function Situacao({ n }: { n: NotaLinha }) {
  const falhou = n.status === "REJEITADO" || n.status === "INTERROMPIDO";
  return (
    <div className="space-y-1 max-w-[190px]">
      <StatusPill tom={TOM_STATUS_NOTA[n.status] ?? "previsto"} tamanho="sm" data-situacao={n.status}>
        {(n.status === "ENVIANDO" || n.status === "PROCESSANDO") && <Loader2 className="w-3 h-3 animate-spin" />}{n.statusLabel}
      </StatusPill>
      {falhou && n.motivo && (
        <p className="text-xs text-atrasado-texto line-clamp-2 flex gap-1" title={n.motivo} data-motivo><AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />{n.motivo}</p>
      )}
    </div>
  );
}
function DataNota({ n }: { n: NotaLinha }) {
  return <span title={n.autorizadaEm ? "Data da autorização" : "Data do envio"}>{formatarData(dataDaNota(n))}</span>;
}
function Origem({ n }: { n: NotaLinha }) {
  const os = n.ordemServicoId && n.osNumero && n.origem === "OS";
  return (
    <span className="inline-flex flex-col gap-0.5" data-origem>
      {os && <Link href={hrefOs(n.ordemServicoId!)} className="text-acento hover:underline whitespace-nowrap">OS {n.osNumero}</Link>}
      {n.medicaoId && n.medicaoNumero && (
        <Link href={hrefMedicao(n.medicaoId)} className={cn("hover:underline whitespace-nowrap", os ? "text-xs text-ink-muted" : "text-acento")}>Medição {n.medicaoNumero}</Link>
      )}
      {!os && !n.medicaoId && <span className="text-ink-subtle">—</span>}
    </span>
  );
}
function Ambiente({ a }: { a: string }) {
  return <StatusPill tom={a === "PRODUCAO" ? "ok-solido" : "acento"} tamanho="sm" data-ambiente={a}>{a === "PRODUCAO" ? "Produção" : "Homologação"}</StatusPill>;
}

/* ───────── Ações por nota: ícone de detalhes + menu ⋮ (components/ui/menu-acoes) ───────── */
function AcoesNota({ n, onDetalhes, onReconsultar, consultando }: { n: NotaLinha; onDetalhes: () => void; onReconsultar: () => void; consultando: boolean }) {
  const a = acoesDaNota(n);
  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={onDetalhes} title="Ver detalhes" aria-label="Ver detalhes" className="p-1.5 rounded text-ink-muted hover:text-primary-600" data-acao="detalhes"><Eye className="w-4 h-4" /></button>
      <MenuAcoes ocupado={consultando}>
        {(fechar) => (
          <>
            <ItemMenu icone={Eye} onClick={() => { fechar(); onDetalhes(); }} id="detalhes">Ver detalhes</ItemMenu>
            {a.origem && <ItemMenu icone={ExternalLink} href={a.origem} id="origem">{n.origem === "OS" && n.osNumero ? `Abrir OS ${n.osNumero}` : `Abrir medição${n.medicaoNumero ? ` ${n.medicaoNumero}` : ""}`}</ItemMenu>}
            <ItemMenu icone={Download} href={`/api/fiscal/notas/${n.id}/arquivo?tipo=pdf`} novaAba desabilitado={!a.pdf} motivo={motivoSemArquivo(n.status, "pdf")} id="pdf">Baixar DANFSE (PDF)</ItemMenu>
            <ItemMenu icone={Download} href={`/api/fiscal/notas/${n.id}/arquivo?tipo=xml`} desabilitado={!a.xml} motivo={motivoSemArquivo(n.status, "xml")} id="xml">Baixar XML</ItemMenu>
            {a.reconsultar && <ItemMenu icone={RefreshCw} onClick={() => { fechar(); onReconsultar(); }} id="reconsultar">Reconsultar status</ItemMenu>}
            {a.reemitir && <ItemMenu icone={RotateCcw} href={a.reemitir} id="reemitir">Corrigir e reemitir</ItemMenu>}
            {a.cancelar && <ItemMenu icone={Ban} desabilitado motivo="Em breve: o cancelamento pelo PlugNotas ainda não está disponível." perigo id="cancelar">Cancelar nota</ItemMenu>}
          </>
        )}
      </MenuAcoes>
    </div>
  );
}

/* ───────── Gaveta: detalhe da nota ───────── */
function GavetaNota({ id, versao, onFechar, onReconsultar, consultando }: {
  id: string | null; versao: number; onFechar: () => void; onReconsultar: (id: string) => void; consultando: boolean;
}) {
  const [nota, setNota] = useState<DetalheNota | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!id) { setNota(null); setErro(null); return; }
    let vivo = true;
    setErro(null);
    fetch(`/api/fiscal/notas/${id}`)
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!vivo) return; if (r.ok) setNota(d); else setErro(d.erro ?? "Não foi possível carregar a nota."); })
      .catch(() => { if (vivo) setErro("Sem conexão. Tente novamente."); });
    return () => { vivo = false; };
  }, [id, versao]);

  const n = nota && nota.id === id ? nota : null;
  const a = n ? acoesDaNota(n) : null;
  return (
    <Drawer aberto={!!id} onFechar={onFechar} largura="w-full sm:w-[40rem] sm:max-w-[92vw]"
      titulo={n ? <span className="flex items-center gap-2">NFS-e {n.numero ?? "sem número"}</span> : "Nota fiscal"}
      rodape={n && a ? (
        <div className="flex flex-wrap justify-end gap-2" data-gaveta-acoes>
          {a.reconsultar && <button type="button" onClick={() => onReconsultar(n.id)} disabled={consultando} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-gaveta="reconsultar"><RefreshCw className={cn("w-4 h-4", consultando && "animate-spin")} /> Reconsultar status</button>}
          {a.reemitir && <Link href={a.reemitir} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-gaveta="reemitir"><RotateCcw className="w-4 h-4" /> Corrigir e reemitir</Link>}
          {a.pdf && <a href={`/api/fiscal/notas/${n.id}/arquivo?tipo=pdf`} target="_blank" rel="noreferrer" className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-gaveta="pdf"><Download className="w-4 h-4" /> PDF</a>}
          {a.xml && <a href={`/api/fiscal/notas/${n.id}/arquivo?tipo=xml`} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-gaveta="xml"><Download className="w-4 h-4" /> XML</a>}
          {a.origem && <Link href={a.origem} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-gaveta="origem"><ExternalLink className="w-4 h-4" /> Abrir origem</Link>}
        </div>
      ) : undefined}>
      {erro ? <p role="alert" className="text-sm text-atrasado" data-gaveta-erro>{erro}</p>
        : !n ? <div className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>
        : (
          <div className="space-y-5 text-sm" data-gaveta-nota={n.id}>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tom={TOM_STATUS_NOTA[n.status] ?? "previsto"} data-gaveta-situacao={n.status}>{n.statusLabel}</StatusPill>
              <Ambiente a={n.ambiente} />
            </div>
            {(n.status === "REJEITADO" || n.status === "INTERROMPIDO") && n.motivo && (
              <div role="alert" className="rounded-lg bg-atrasado-claro text-atrasado-texto px-3 py-2 flex gap-2" data-gaveta-motivo>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div><p className="font-semibold">Motivo da rejeição</p><p>{n.motivo}</p></div>
              </div>
            )}

            <Secao titulo="Dados fiscais">
              <Campo rotulo="Número">{n.numero ?? "—"}</Campo>
              <Campo rotulo="Código de verificação">{n.codigoVerificacao ?? "—"}</Campo>
              <Campo rotulo="Autorizada em">{n.autorizadaEm ? formatarDataHora(n.autorizadaEm) : "—"}</Campo>
              <Campo rotulo="Enviada em">{formatarDataHora(n.criadoEm)}{n.emitidaPor ? ` por ${n.emitidaPor}` : ""}</Campo>
              <Campo rotulo="Serviço (LC 116)">{n.codigoLc116 ?? "—"}</Campo>
              <Campo rotulo="Código municipal">{n.codigoTributacao ?? "—"}</Campo>
              <Campo rotulo="Alíquota do ISS">{n.aliquotaIss != null ? `${n.aliquotaIss.toLocaleString("pt-BR")}%` : "—"}{n.issRetido ? " · retido" : ""}</Campo>
              <Campo rotulo="Protocolo">{n.protocolo ?? "—"}</Campo>
              <Campo rotulo="Ambiente">{LABEL_AMBIENTE[n.ambiente as keyof typeof LABEL_AMBIENTE] ?? n.ambiente}</Campo>
            </Secao>

            <Secao titulo="Tomador">
              <Campo rotulo="Nome">{n.tomadorNome}</Campo>
              <Campo rotulo="CPF/CNPJ">{formatarDocumento(n.tomadorCpfCnpj)}</Campo>
            </Secao>

            <Secao titulo="Valores">
              <Campo rotulo="Serviços">{formatarMoeda(n.valorServicos)}</Campo>
              <Campo rotulo="Desconto">{formatarMoeda(n.valorDesconto)}</Campo>
              <Campo rotulo="Valor líquido"><strong>{formatarMoeda(n.valorServicos - n.valorDesconto)}</strong></Campo>
              {n.contaReceber && <Campo rotulo="Conta a receber"><Link href={`/financeiro/contas-receber?q=${encodeURIComponent(n.contaReceber.numero)}`} className="text-acento hover:underline">{n.contaReceber.numero}</Link></Campo>}
            </Secao>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">Discriminação</h3>
              <p className="whitespace-pre-wrap rounded-lg bg-surface-alt/60 p-3 text-ink" data-gaveta-discriminacao>{n.discriminacao}</p>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">Itens</h3>
              <ul className="divide-y divide-surface-border rounded-lg border border-surface-border">
                {n.itens.map((i, k) => (
                  <li key={k} className="flex justify-between gap-3 px-3 py-2">
                    <span className="text-ink">{i.descricao}{i.quantidade !== 1 ? <span className="text-ink-muted"> · {i.quantidade.toLocaleString("pt-BR")}×</span> : null}</span>
                    <span className="tabular-nums text-ink whitespace-nowrap">{formatarMoeda(i.valorTotal)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">Histórico</h3>
              <ol className="space-y-2 border-l-2 border-surface-border pl-3" data-gaveta-historico>
                {n.eventos.map((e, k) => (
                  <li key={k}>
                    <p className="text-xs text-ink-muted">{formatarDataHora(e.criadoEm)} · {e.usuario ?? "Sistema"}</p>
                    <p className="text-ink">{e.mensagem ?? e.status ?? e.tipo}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
    </Drawer>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-1.5">{titulo}</h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">{children}</dl>
    </div>
  );
}
function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return <div><dt className="text-xs text-ink-muted">{rotulo}</dt><dd className="text-ink break-words">{children}</dd></div>;
}
