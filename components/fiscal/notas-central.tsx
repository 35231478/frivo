"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Ban, CheckCircle2, Download, ExternalLink, Eye, FileText,
  Loader2, RefreshCw, RotateCcw, Search, Send, Sigma, XCircle, FileClock,
} from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { ItemMenu, MenuAcoes } from "@/components/ui/menu-acoes";
import { Dica } from "@/components/ui/dica";
import { StatusPill } from "@/components/ui/status-pill";
import { toast } from "@/components/ui/avisos";
import { Paginacao, ListaVazia } from "@/components/listagem/listagem-ui";
import { BarraPeriodo, CardResumo, GradeCards } from "@/components/listagem/periodo-cards";
import { BarraFiltros, inputFiltro } from "@/components/listagem/barra-filtros";
import { CampoBusca } from "@/components/listagem/listagem-ui";
import { useListagemUrl } from "@/components/listagem/use-listagem-url";
import { cn, formatarData, formatarDataHora, formatarMoeda } from "@/lib/utils";
import { PLANILHA, valorSemMoeda } from "@/lib/planilha";
import { TabelaPro } from "@/components/listagem/tabela-pro";
import { CheckboxSelecao, CheckboxSelecaoPagina, SelecaoLinhasProvider, useSelecaoLinhas } from "@/components/listagem/selecao-linhas";
import { PainelTotais, type LinhaTotal } from "@/components/listagem/painel-totais";
import { CHAVES_NOTAS, totaisNotas } from "@/lib/listagem/totais-selecao";
import { formatarDocumento } from "@/lib/documento";
import { LABEL_AMBIENTE } from "@/lib/nfse/regras";
import {
  acoesDaNota, dataDaNota, GRUPOS_SITUACAO, hrefMedicao, hrefOs, motivoSemArquivo,
  TOM_STATUS_NOTA, type GrupoSituacao,
} from "@/lib/nfse/central";
import type { DadosCentral, DetalheNota, NotaLinha } from "@/lib/nfse/central-server";

/**
 * Tela central "Notas fiscais de serviço" (Financeiro › Fiscal): período (mês com ‹ › ou
 * intervalo), busca, situação e ambiente na URL (filtro no servidor); cards do período; a lista
 * (tabela no desktop, cartões no celular) e, por nota, só as ações que funcionam no status dela.
 */
export function NotasCentralView({ dados }: { dados: DadosCentral }) {
  // Seleção da página (realce da linha + painel "Total dos N selecionados")
  return <SelecaoLinhasProvider idsPagina={dados.notas.map((n) => n.id)}><NotasCentralCorpo dados={dados} /></SelecaoLinhasProvider>;
}

function NotasCentralCorpo({ dados }: { dados: DadosCentral }) {
  const router = useRouter();
  const { filtros, resumo } = dados;
  const { selecionados } = useSelecaoLinhas();
  const selecionadas = useMemo(() => dados.notas.filter((n) => selecionados.has(n.id)), [dados.notas, selecionados]);
  const totaisSelecao = useMemo(() => totaisNotas(selecionadas), [selecionadas]);
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
    <div className="space-y-3" data-notas-central>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-surface-alt rounded-lg"><FileText className="w-5 h-5 text-ink-muted" /></div>
        <h1 className="page-title">Notas fiscais de serviço</h1>
        <Dica texto="NFS-e emitidas pelo PlugNotas a partir das medições e das OS concluídas." rotulo="Notas fiscais de serviço" lado="direita" />
      </div>

      {/* Barra enxuta: período (pela data da nota) + busca + "Mais filtros" (painel recolhido) — padrão da casa */}
      <BarraFiltros
        periodo={<BarraPeriodo rotulo="Data da nota" periodo={filtros.periodo} navegar={navegar} permitirTodos dica="Pela data de autorização da nota (ou de envio, se ainda não autorizada)." />}
        busca={<CampoBusca valor={busca} onChange={setBusca} placeholder="Pesquisar" rotulo="Pesquisar notas" carregando={pendente} />}
        paramBusca="q" navegar={navegar}
        filtros={[
          { id: "situacao", label: "Situação", params: ["situacao"], render: () => (
            <select value={filtros.situacao ?? ""} onChange={(e) => navegar({ situacao: e.target.value || null })} aria-label="Situação" className={inputFiltro(filtros.situacao)} data-filtro-situacao>
              <option value="">Todas as situações</option>
              {(Object.keys(GRUPOS_SITUACAO) as GrupoSituacao[]).map((g) => <option key={g} value={g}>{GRUPOS_SITUACAO[g].rotulo}</option>)}
            </select>
          ) },
          { id: "ambiente", label: "Ambiente", params: ["ambiente"], render: () => (
            <select value={filtros.ambiente ?? ""} onChange={(e) => navegar({ ambiente: e.target.value || null })} aria-label="Ambiente" className={inputFiltro(filtros.ambiente)} data-filtro-ambiente>
              <option value="">Todos os ambientes</option>
              <option value="HOMOLOGACAO">Homologação</option>
              <option value="PRODUCAO">Produção</option>
            </select>
          ) },
        ]}
      />

      {/* Cards do período (e do ambiente escolhido) */}
      <GradeCards colunas={6}>
        <CardResumo id="aberto" rotulo="Em aberto" icone={FileClock} cor="text-previsto-texto" q={resumo.aberto.q} v={resumo.aberto.v}
          unidade={["medição", "medições"]}
          dica="Medições aprovadas no período (pedido de compra recebido) ainda sem NFS-e." href="/financeiro/medicoes?status=PC_RECEBIDO" />
        <CardResumo id="transmissao" rotulo="Em transmissão" icone={Send} cor="text-atencao-texto" q={resumo.transmissao.q} v={resumo.transmissao.v} {...cardSituacao("transmissao")} />
        <CardResumo id="emitidas" rotulo="Emitidas" icone={CheckCircle2} cor="text-ok-texto" q={resumo.emitidas.q} v={resumo.emitidas.v} {...cardSituacao("emitidas")} />
        <CardResumo id="falha" rotulo="Com falha" icone={XCircle} cor="text-atrasado-texto" q={resumo.falha.q} v={resumo.falha.v} {...cardSituacao("falha")} />
        <CardResumo id="canceladas" rotulo="Canceladas" icone={Ban} cor="text-ink-muted" q={resumo.canceladas.q} v={resumo.canceladas.v} {...cardSituacao("canceladas")} />
        <CardResumo id="total" rotulo="Total emitido" icone={Sigma} cor="text-primary-600" v={resumo.total.v}
          legenda={`${resumo.total.q} ${resumo.total.q === 1 ? "nota" : "notas"} no período`} dica="Soma dos serviços das notas autorizadas no período." />
      </GradeCards>

      <div className="card overflow-hidden">
        {dados.notas.length === 0 ? (
          <ListaVazia mensagem={`Nenhuma nota em ${filtros.periodo.tipo === "mes" ? filtros.periodo.rotulo.toLowerCase() : "o período"}`} busca={filtros.q || undefined} onLimpar={() => { setBusca(""); navegar({ q: null }); }} />
        ) : (
          <>
            {/* Desktop: a tabela profissional (components/listagem/tabela-pro — colunas redimensionáveis, menu "Colunas", preferência por usuário) */}
            <div data-tabela-rolagem>
              <TabelaPro
                tela="notas-fiscais"
                atributos={{ "data-tabela": true }}
                colunas={[
                  { id: "sel", titulo: "Selecionar a página", fixa: true, largura: 36, cabecalho: <CheckboxSelecaoPagina />, classe: "pl-3" },
                  { id: "situacao", titulo: "Situação", largura: 200, obrigatoria: true },
                  { id: "numero", titulo: "Número", largura: 96 },
                  { id: "data", titulo: "Data", largura: 96 },
                  { id: "tomador", titulo: "Tomador", obrigatoria: true },
                  { id: "origem", titulo: "Origem", largura: 160 },
                  { id: "valor", titulo: "Valor (R$)", alinhar: "direita", largura: 120, obrigatoria: true },
                  { id: "ambiente", titulo: "Ambiente", largura: 120 },
                  { id: "acoes", titulo: "Ações", fixa: true, largura: 72, semTitulo: true, alinhar: "direita", classe: "py-0.5" },
                ]}
                linhas={dados.notas.map((n) => ({
                  id: n.id,
                  atributos: { "data-nota": n.id, "data-status": n.status },
                  celulas: {
                    sel: <CheckboxSelecao id={n.id} rotulo={n.numero ? `nota ${n.numero}` : n.tomadorNome} />,
                    situacao: <Situacao n={n} />,
                    numero: <span className={cn(PLANILHA.codigo, "font-normal text-ink")}>{n.numero ?? "—"}</span>,
                    data: <span className={cn(PLANILHA.data, PLANILHA.apagado)}><DataNota n={n} /></span>,
                    tomador: (
                      <>
                        <p className={cn(PLANILHA.nome, "truncate")} title={n.tomadorNome}>{n.tomadorNome}</p>
                        <p className="text-[11px] text-ink-subtle whitespace-nowrap tabular-nums">{formatarDocumento(n.tomadorCpfCnpj)}</p>
                      </>
                    ),
                    origem: <Origem n={n} />,
                    valor: <span className={cn(PLANILHA.numero, "font-semibold text-ink")} data-valor>{valorSemMoeda(n.valorServicos)}</span>,
                    ambiente: <Ambiente a={n.ambiente} />,
                    acoes: <span data-celula-acoes><AcoesNota n={n} onDetalhes={() => setDetalheId(n.id)} onReconsultar={() => reconsultar(n.id)} consultando={consultando === n.id} /></span>,
                  },
                }))}
              />
            </div>

            {/* Celular: cartões (nada de tabela cortada) */}
            <ul className="md:hidden divide-y divide-surface-border" data-cartoes>
              {dados.notas.map((n) => (
                <li key={n.id} className={cn("p-3 space-y-2", selecionados.has(n.id) && "bg-primary-50")} data-nota={n.id} data-status={n.status} data-selecionada={selecionados.has(n.id) ? "" : undefined}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="pt-0.5 w-4 shrink-0"><CheckboxSelecao id={n.id} rotulo={n.numero ? `nota ${n.numero}` : n.tomadorNome} /></div>
                    <div className="min-w-0 flex-1 space-y-1">
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

        {dados.notas.length > 0 && (
          <PainelTotais unidade={["nota", "notas"]}
            periodo={{
              rotulo: filtros.periodo.rotulo, subtitulo: filtros.periodo.rotulo,
              total: linhaTotal("total", resumo.total),
              linhas: CHAVES_NOTAS.filter((k) => k !== "total").map((k) => linhaTotal(k, resumo[k])),
            }}
            selecao={{ n: selecionados.size, naPagina: selecionadas.length, total: linhaTotal("total", totaisSelecao.total), linhas: CHAVES_NOTAS.filter((k) => k !== "total").map((k) => linhaTotal(k, totaisSelecao[k])) }}
          />
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
        <Link href={hrefMedicao(n.medicaoId)} className={cn("hover:underline whitespace-nowrap", os ? "text-xs text-ink-muted" : "text-acento")}>{n.medicaoRotulo ?? `Medição ${n.medicaoNumero}`}</Link>
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
            {a.origem && <ItemMenu icone={ExternalLink} href={a.origem} id="origem">{n.origem === "OS" && n.osNumero ? `Abrir OS ${n.osNumero}` : (n.medicaoRotulo ? `Abrir ${n.medicaoRotulo.replace(/^\S/, (c) => c.toLowerCase())}` : `Abrir medição${n.medicaoNumero ? ` ${n.medicaoNumero}` : ""}`)}</ItemMenu>}
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
              {n.contaReceber && <Campo rotulo="Conta a receber"><Link href={`/financeiro/contas-receber?q=${encodeURIComponent(n.contaReceber.numero)}&periodo=todos`} className="text-acento hover:underline">{n.contaReceber.numero}</Link></Campo>}
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

/** Uma linha do painel de totais com o rótulo e a cor do card correspondente */
const ROTULO_TOTAL: Record<string, { rotulo: string; cor?: string }> = {
  transmissao: { rotulo: "Em transmissão", cor: "text-atencao-texto" }, emitidas: { rotulo: "Emitidas", cor: "text-ok-texto" },
  falha: { rotulo: "Com falha", cor: "text-atrasado-texto" }, canceladas: { rotulo: "Canceladas", cor: "text-ink-muted" }, total: { rotulo: "Total emitido" },
};
const linhaTotal = (chave: string, s: { v: number; q: number }): LinhaTotal => ({ chave, ...ROTULO_TOTAL[chave], v: s.v, q: s.q });
