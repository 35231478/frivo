"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Download, ExternalLink, FileText, Info, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { StatusPill, type TomStatus } from "@/components/ui/status-pill";
import { SeletorCadastro } from "@/components/cadastros/seletor-cadastro";
import { cn, formatarDataHora, formatarMoeda } from "@/lib/utils";
import { formatarDocumento } from "@/lib/documento";
import { aguardandoResposta, MAX_DISCRIMINACAO, type Pendencia } from "@/lib/nfse/nota";

/**
 * NFS-e da medição (ou da OS concluída, pela medição dela): as notas emitidas, com status, nº,
 * código de verificação, PDF/XML e o motivo da rejeição; e o botão "Emitir NFS-e" (Financeiro ›
 * Fiscal), que abre a pré-validação e a prévia das notas (uma por código de serviço).
 * Enquanto alguma nota processa, a tela consulta sozinha o PlugNotas.
 */

interface Evento { tipo: string; status: string | null; mensagem: string | null; criadoEm: string; usuario: { nome: string } | null }
interface Nota {
  id: string; status: string; statusLabel: string; ambiente: string; codigoLc116: string | null; codigoTributacao: string | null;
  aliquotaIss: number | null; issRetido: boolean; valorServicos: number; valorDesconto: number; discriminacao: string;
  protocolo: string | null; numero: string | null; codigoVerificacao: string | null; autorizadaEm: string | null; motivo: string | null;
  criadoEm: string; medicao: { id: string; numero: string; rotulo?: string } | null; contaReceber: { id: string; numero: string } | null;
  emitidaPor: { nome: string } | null; itens: { descricao: string; valorTotal: number }[]; eventos: Evento[];
}
interface Grupo {
  chave: string; rotulo: string; codigoLc116: string; codigoTributacao: string; aliquota: number; retido: boolean;
  valorServicos: number; valorDesconto: number; discriminacao: string;
  itens: { id: string; descricao: string; quantidade: number; valorTotal: number; desconto: number }[];
}
interface Previa {
  medicao: { id: string; numero: string; status: string; rotulo?: string }; ambiente: string; ambienteLabel: string;
  tomador: { nome: string; cpfCnpj: string }; pendencias: Pendencia[]; grupos: Grupo[];
  itensSemServico: { id: string; descricao: string; valorTotal: number }[]; jaEmNota: number; produtos: { quantidade: number; valor: number };
}

const TOM: Record<string, TomStatus> = {
  ENVIANDO: "atencao", PROCESSANDO: "atencao", CONCLUIDO: "ok", REJEITADO: "atrasado", CANCELADO: "previsto", INTERROMPIDO: "atrasado",
};
/** A tela consulta a cada 6 s, por até ~3 min; depois, só no botão */
const INTERVALO_MS = 6_000;
const MAX_RODADAS = 30;

const codigoNota = (n: Pick<Nota, "codigoTributacao" | "codigoLc116">) =>
  `Código ${n.codigoTributacao ?? n.codigoLc116 ?? "—"}${n.codigoTributacao && n.codigoLc116 && n.codigoTributacao !== n.codigoLc116 ? ` (LC 116 ${n.codigoLc116})` : ""}`;

export function NotasFiscais({ medicaoId, osId, origem, avulsa, abrirEmissao, onAbriu }: {
  medicaoId?: string; osId?: string; origem: "OS" | "MEDICAO";
  /** OS avulsa (sem contrato): a nota sai da fatura ("Faturar"), não de uma medição */
  avulsa?: boolean;
  /** Abre a emissão ao carregar (botão "Emitir NFS-e" do cabeçalho da OS; "Corrigir e reemitir" da central) */
  abrirEmissao?: boolean; onAbriu?: () => void;
}) {
  const [dados, setDados] = useState<{ medicaoId: string | null; podeEmitir: boolean; notas: Nota[] } | null>(null);
  const [erro, setErro] = useState("");
  const [emitindo, setEmitindo] = useState(false);
  const [atualizando, setAtualizando] = useState<string | null>(null);
  const [rodadas, setRodadas] = useState(0);
  const query = medicaoId ? `medicaoId=${encodeURIComponent(medicaoId)}` : `osId=${encodeURIComponent(osId ?? "")}`;

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/fiscal/notas?${query}`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(d?.notas)) { setErro(d?.erro ?? "Não foi possível carregar as notas."); return; }
      setDados(d); setErro("");
    } catch { setErro("Erro de conexão."); }
  }, [query]);
  useEffect(() => { void carregar(); }, [carregar]);

  // Uma vez por pedido: recarregar as notas (ex.: depois de emitir) não reabre a emissão
  const abriu = useRef(false);
  useEffect(() => {
    if (!abrirEmissao) { abriu.current = false; return; }
    if (!abriu.current && dados?.podeEmitir && dados.medicaoId) { abriu.current = true; setEmitindo(true); onAbriu?.(); }
  }, [abrirEmissao, dados, onAbriu]);

  const consultar = useCallback(async (id: string, manual = false) => {
    if (manual) setAtualizando(id);
    try {
      const r = await fetch(`/api/fiscal/notas/${id}/consultar`, { method: "POST" });
      if (!r.ok && manual) setErro((await r.json().catch(() => null))?.erro ?? "Não foi possível consultar o PlugNotas.");
    } catch { if (manual) setErro("Erro de conexão."); } finally {
      if (manual) { setAtualizando(null); setRodadas(0); }
      await carregar();
    }
  }, [carregar]);

  // Enquanto alguma nota espera a prefeitura, consulta sozinha (no servidor há um intervalo mínimo por nota)
  const pendentes = (dados?.notas ?? []).filter((n) => aguardandoResposta(n.status)).map((n) => n.id);
  const chavePendentes = pendentes.join(",");
  useEffect(() => {
    if (!chavePendentes || rodadas >= MAX_RODADAS) return;
    const t = setTimeout(async () => {
      for (const id of chavePendentes.split(",")) await consultar(id);
      setRodadas((n) => n + 1);
    }, INTERVALO_MS);
    return () => clearTimeout(t);
  }, [chavePendentes, rodadas, consultar]);

  if (!dados) {
    return erro
      ? <p className="text-sm text-atrasado-texto">{erro}</p>
      : <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando notas…</p>;
  }

  return (
    <section className="space-y-3" data-nfse-notas>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="section-title flex items-center gap-2"><FileText className="w-4 h-4 text-acento" /> Notas fiscais (NFS-e)</h3>
        {dados.podeEmitir && dados.medicaoId && (
          <Button size="sm" onClick={() => setEmitindo(true)} data-acao="emitir-nfse"><Send className="w-4 h-4" /> Emitir NFS-e</Button>
        )}
      </div>
      {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2">{erro}</p>}

      {!dados.medicaoId && (
        <p className="text-sm text-ink-muted bg-surface-page rounded-lg px-3 py-2.5" data-sem-medicao>
          {avulsa
            ? "A NFS-e sai da fatura. Use “Faturar” para emitir a nota."
            : "A NFS-e sai da medição (o documento de cobrança). Gere a medição desta OS e aprove-a para emitir a nota."}
        </p>
      )}
      {dados.medicaoId && dados.notas.length === 0 && <p className="text-sm text-ink-muted">Nenhuma nota emitida ainda.</p>}
      {pendentes.length > 0 && rodadas >= MAX_RODADAS && (
        <p className="text-xs text-atencao-texto bg-atencao-claro rounded-lg px-3 py-2">A prefeitura ainda está processando. Use “Atualizar status” daqui a pouco.</p>
      )}

      <ul className="space-y-2.5">
        {dados.notas.map((n) => (
          <li key={n.id} className="rounded-lg border border-surface-border p-3 sm:p-4 space-y-2" data-nota={n.id} data-status={n.status}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-ink flex flex-wrap items-center gap-2">
                  {codigoNota(n)}
                  <StatusPill tom={TOM[n.status] ?? "previsto"} tamanho="sm">
                    {aguardandoResposta(n.status) && <Loader2 className="w-3 h-3 animate-spin" />}{n.statusLabel}
                  </StatusPill>
                  {n.ambiente === "HOMOLOGACAO" && <StatusPill tom="acento" tamanho="sm" data-homologacao="">Homologação</StatusPill>}
                </p>
                <p className="text-xs text-ink-muted mt-0.5">
                  {n.medicao && origem === "OS" ? <>{n.medicao.rotulo ?? `Medição ${n.medicao.numero}`} · </> : null}
                  Enviada em {formatarDataHora(n.criadoEm)}{n.emitidaPor ? ` por ${n.emitidaPor.nome}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="font-semibold text-ink tabular-nums">{formatarMoeda(n.valorServicos - n.valorDesconto)}</p>
                {n.valorDesconto > 0 && <p className="text-[11px] text-ink-muted">serviços {formatarMoeda(n.valorServicos)} − desconto {formatarMoeda(n.valorDesconto)}</p>}
              </div>
            </div>

            {n.status === "CONCLUIDO" && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" data-autorizada>
                <span>NFS-e nº <strong className="font-mono">{n.numero ?? "—"}</strong></span>
                {n.codigoVerificacao && <span className="text-ink-muted">Código de verificação <span className="font-mono text-ink">{n.codigoVerificacao}</span></span>}
                <span className="flex gap-2 ml-auto">
                  <a href={`/api/fiscal/notas/${n.id}/arquivo?tipo=pdf`} target="_blank" rel="noreferrer" className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-baixar="pdf"><Download className="w-4 h-4" /> PDF</a>
                  <a href={`/api/fiscal/notas/${n.id}/arquivo?tipo=xml`} className="btn-secondary inline-flex items-center gap-1.5 text-sm" data-baixar="xml"><Download className="w-4 h-4" /> XML</a>
                </span>
              </div>
            )}
            {n.motivo && (n.status === "REJEITADO" || n.status === "INTERROMPIDO" || n.status === "ENVIANDO") && (
              <div role={n.status === "ENVIANDO" ? undefined : "alert"} className={cn("text-sm rounded-lg px-3 py-2 flex gap-2", n.status === "ENVIANDO" ? "bg-atencao-claro text-atencao-texto" : "bg-atrasado-claro text-atrasado-texto")} data-motivo>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <p>{n.motivo}</p>
                  {n.status !== "ENVIANDO" && dados.podeEmitir && <p className="text-xs mt-1">Corrija o que a prefeitura apontou e use “Emitir NFS-e” de novo: estes serviços voltaram a ficar livres.</p>}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
              {n.contaReceber && <a href={`/financeiro/contas-receber?q=${encodeURIComponent(n.contaReceber.numero)}&periodo=todos`} className="inline-flex items-center gap-1 text-acento hover:underline">Conta a receber {n.contaReceber.numero} <ExternalLink className="w-3 h-3" /></a>}
              {n.protocolo && <span>Protocolo {n.protocolo}</span>}
              {aguardandoResposta(n.status) && (
                <button type="button" onClick={() => consultar(n.id, true)} disabled={atualizando === n.id} className="inline-flex items-center gap-1 text-acento hover:underline disabled:opacity-60" data-acao="atualizar-status">
                  <RefreshCw className={cn("w-3 h-3", atualizando === n.id && "animate-spin")} /> Atualizar status
                </button>
              )}
              <details className="w-full" data-historico>
                <summary className="cursor-pointer inline-flex items-center gap-1 select-none"><ChevronDown className="w-3 h-3" /> Itens e histórico</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <ul className="space-y-1">
                    {n.itens.map((i, k) => <li key={k} className="flex justify-between gap-2"><span className="text-ink">{i.descricao}</span><span className="tabular-nums">{formatarMoeda(i.valorTotal)}</span></li>)}
                  </ul>
                  <ol className="space-y-1">
                    {n.eventos.map((e, k) => (
                      <li key={k}><span className="text-ink">{formatarDataHora(e.criadoEm)}</span>{e.usuario ? ` · ${e.usuario.nome}` : ""} — {e.mensagem ?? e.status ?? e.tipo}</li>
                    ))}
                  </ol>
                </div>
              </details>
            </div>
          </li>
        ))}
      </ul>

      {emitindo && dados.medicaoId && (
        <EmitirNfseModal
          medicaoId={dados.medicaoId} origem={origem} ordemServicoId={origem === "OS" ? osId : undefined}
          onFechar={() => setEmitindo(false)}
          onEmitido={() => { setEmitindo(false); setRodadas(0); void carregar(); }}
        />
      )}
    </section>
  );
}

/* ───────── Emitir: pré-validação + prévia das notas ───────── */
export function EmitirNfseModal({ medicaoId, origem, ordemServicoId, onFechar, onEmitido }: {
  medicaoId: string; origem: "OS" | "MEDICAO"; ordemServicoId?: string; onFechar: () => void; onEmitido: () => void;
}) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [vinculando, setVinculando] = useState<string | null>(null);
  const [disc, setDisc] = useState<Record<string, string>>({});
  const discRef = useRef(disc);
  discRef.current = disc;

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/fiscal/notas?medicaoId=${encodeURIComponent(medicaoId)}&previa=1`, { cache: "no-store" });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.previa) { setErro(d?.erro ?? "Não foi possível preparar a emissão."); return; }
      setPrevia(d.previa); setErro("");
    } catch { setErro("Erro de conexão."); }
  }, [medicaoId]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function vincular(itemId: string, servicoId: string) {
    if (!servicoId) return;
    setVinculando(itemId); setErro("");
    try {
      const r = await fetch("/api/fiscal/notas/vincular-servico", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ medicaoId, itemId, servicoId }),
      });
      if (!r.ok) setErro((await r.json().catch(() => null))?.erro ?? "Não foi possível ligar o serviço.");
      await carregar();
    } catch { setErro("Erro de conexão."); } finally { setVinculando(null); }
  }

  async function emitir() {
    if (!previa) return;
    setEnviando(true); setErro("");
    try {
      const discriminacoes = Object.fromEntries(previa.grupos.map((g) => [g.chave, discRef.current[g.chave] ?? g.discriminacao]));
      const r = await fetch("/api/fiscal/notas", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medicaoId, origem, ordemServicoId: ordemServicoId ?? null, discriminacoes }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok) { onEmitido(); return; }
      setErro(d?.erro ?? "Não foi possível emitir.");
      if (d?.pendencias) setPrevia((p) => (p ? { ...p, pendencias: d.pendencias } : p));
    } catch { setErro("Erro de conexão."); } finally { setEnviando(false); }
  }

  const n = previa?.grupos.length ?? 0;
  const textoDe = (g: Grupo) => disc[g.chave] ?? g.discriminacao;
  const discInvalida = previa?.grupos.some((g) => { const t = textoDe(g).trim(); return !t || t.length > MAX_DISCRIMINACAO; }) ?? false;
  const bloqueado = !previa || previa.pendencias.length > 0 || n === 0 || discInvalida;

  return (
    <Modal aberto onFechar={onFechar} titulo={previa ? `Emitir NFS-e — ${(previa.medicao.rotulo ?? `Medição ${previa.medicao.numero}`).replace(/^\w/, (l) => l.toLowerCase())}` : "Emitir NFS-e"} tamanho="lg">
      {!previa ? (
        erro ? <p className="text-sm text-atrasado-texto">{erro}</p> : <p className="text-sm text-ink-muted flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Conferindo os dados…</p>
      ) : (
        <div className="space-y-4" data-emitir-nfse>
          <p className={cn("text-sm rounded-lg px-3 py-2 flex gap-2", previa.ambiente === "HOMOLOGACAO" ? "bg-acento-claro text-acento" : "bg-atencao-claro text-atencao-texto")} data-ambiente={previa.ambiente}>
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            {previa.ambiente === "HOMOLOGACAO"
              ? <span><strong>{previa.ambienteLabel}</strong>: a nota vai para o ambiente de testes do PlugNotas e não tem valor fiscal.</span>
              : <span><strong>{previa.ambienteLabel}</strong>: a nota vale de verdade.</span>}
          </p>
          <p className="text-sm text-ink">Tomador: <strong>{previa.tomador.nome}</strong> · {formatarDocumento(previa.tomador.cpfCnpj)}</p>

          {previa.pendencias.length > 0 && (
            <div className="rounded-lg border border-atrasado/20 bg-atrasado-claro/50 p-3 space-y-2" data-pendencias>
              <p className="text-sm font-semibold text-atrasado-texto">Antes de emitir, falta corrigir:</p>
              <ul className="space-y-1.5 text-sm">
                {previa.pendencias.filter((p) => p.area !== "item").map((p, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2" data-pendencia={p.area}>
                    <span className="text-atrasado-texto">• {p.texto}</span>
                    {p.link && <a href={p.link} target="_blank" rel="noreferrer" className="text-xs text-acento hover:underline inline-flex items-center gap-1">{p.rotuloLink ?? "Corrigir"} <ExternalLink className="w-3 h-3" /></a>}
                  </li>
                ))}
              </ul>
              {previa.itensSemServico.length > 0 && (
                <div className="space-y-2 pt-1" data-itens-sem-servico>
                  <p className="text-sm text-atrasado-texto">Itens sem o serviço do catálogo (de onde vêm o código e o ISS): escolha o serviço de cada um.</p>
                  {previa.itensSemServico.map((it) => (
                    <div key={it.id} className="grid sm:grid-cols-[1fr_16rem] gap-2 items-center" data-item-sem-servico={it.id}>
                      <span className="text-sm text-ink">{it.descricao} <span className="text-ink-muted">· {formatarMoeda(it.valorTotal)}</span></span>
                      <SeletorCadastro entidade="servicos" semCriar valor="" placeholder="Escolha o serviço…" disabled={vinculando === it.id} onChange={(id) => vincular(it.id, id)} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {n > 1 && (
            <p className="text-sm text-atencao-texto bg-atencao-claro rounded-lg px-3 py-2" data-varias-notas>
              Vão sair <strong>{n} notas</strong>, uma por código de serviço: a prefeitura não aceita códigos diferentes (nem regras de ISS diferentes) na mesma nota.
            </p>
          )}
          {n === 0 && previa.pendencias.length === 0 && <p className="text-sm text-ink-muted">Nada a emitir: os serviços desta medição já estão em notas.</p>}

          <ol className="space-y-3">
            {previa.grupos.map((g, i) => {
              const texto = textoDe(g);
              return (
                <li key={g.chave} className="rounded-lg border border-surface-border p-3 space-y-2" data-grupo={g.codigoTributacao}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-medium text-ink">{n > 1 ? `Nota ${i + 1} de ${n} — ` : ""}{g.rotulo}</p>
                    <p className="text-sm tabular-nums">
                      <strong>{formatarMoeda(g.valorServicos - g.valorDesconto)}</strong>
                      {g.valorDesconto > 0 && <span className="text-ink-muted"> ({formatarMoeda(g.valorServicos)} − desconto {formatarMoeda(g.valorDesconto)})</span>}
                    </p>
                  </div>
                  <p className="text-xs text-ink-muted">ISS {String(g.aliquota).replace(".", ",")}%{g.retido ? " · retido pelo tomador" : ""}</p>
                  <ul className="text-sm space-y-0.5">
                    {g.itens.map((it) => <li key={it.id} className="flex justify-between gap-2"><span>{it.descricao}</span><span className="tabular-nums text-ink-muted">{formatarMoeda(it.valorTotal)}</span></li>)}
                  </ul>
                  <label className="block text-xs font-medium text-ink space-y-1">
                    <span>Discriminação (vai impressa na nota; “|” quebra a linha)</span>
                    <textarea
                      value={texto} onChange={(e) => setDisc((d) => ({ ...d, [g.chave]: e.target.value }))} rows={3}
                      className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm font-normal focus:outline-none focus:border-acento focus:ring-4 focus:ring-acento/15"
                      data-discriminacao={g.chave}
                    />
                    <span className={cn("block text-right font-normal", texto.trim().length > MAX_DISCRIMINACAO || !texto.trim() ? "text-atrasado-texto" : "text-ink-subtle")}>
                      {texto.trim().length}/{MAX_DISCRIMINACAO}
                    </span>
                  </label>
                </li>
              );
            })}
          </ol>

          {(previa.produtos.quantidade > 0 || previa.jaEmNota > 0) && (
            <ul className="text-xs text-ink-muted space-y-0.5">
              {previa.produtos.quantidade > 0 && <li>Produtos ({formatarMoeda(previa.produtos.valor)}) não entram na NFS-e.</li>}
              {previa.jaEmNota > 0 && <li>{previa.jaEmNota} {previa.jaEmNota === 1 ? "item já está" : "itens já estão"} em nota emitida ou em processamento.</li>}
            </ul>
          )}
          {erro && <p role="alert" className="text-sm text-atrasado-texto">{erro}</p>}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
            <Button onClick={emitir} loading={enviando} disabled={bloqueado} data-acao="confirmar-emissao">
              <Send className="w-4 h-4" /> {n > 1 ? `Emitir ${n} notas` : "Emitir a nota"}{previa.ambiente === "HOMOLOGACAO" ? " (homologação)" : ""}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
