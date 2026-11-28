"use client";

import { erroDoEnvio, lerArquivoComoDataUrl, lerValorPedido, MSG_ARQUIVO_ILEGIVEL, MSG_ARQUIVO_PEDIDO_GRANDE, TAMANHO_MAX_PEDIDO } from "@/lib/pedido-cliente/arquivo";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, ExternalLink, FileText, Paperclip, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { InputData } from "@/components/ui/input-data";
import { limparNumeroPedido, reais } from "@/lib/pedido-cliente/regra";
import { ROTULO_SITUACAO_PORTAL, ehSituacaoPedido } from "@/lib/pedido-cliente/lembretes";

export interface ItemPortal {
  tipo: "os" | "orcamento"; id: string; numero: string; concluidoEm: string | null; valor: number;
  diasEsperando: number | null; unidade: string | null; documento: string | null;
  emConferencia: { pedidoId: string; numero: string } | null;
}
export interface PedidoEnviado {
  id: string; numero: string; data: string; valor: number | null; situacao: string; motivoRecusa: string | null;
  enviadoEm: string; itens: string[];
  /** "os:id" / "orcamento:id" dos itens que o pedido cobria */
  chaves?: string[];
  /** O nome do arquivo enviado (o cliente pode abrir o que mandou) */
  anexoNome?: string | null;
}

const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const dataBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null);
const diaBR = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });
const rotuloItem = (i: Pick<ItemPortal, "tipo" | "numero">) => (i.tipo === "os" ? i.numero : `Orçamento ${i.numero}`);

/**
 * PC-2 — "Pedido de compra" no portal: o comprador vê o que aguarda o pedido (nº, conclusão, valor, o relatório em
 * PDF), escolhe um ou mais serviços e anexa o pedido (nº, data, valor, arquivo). Depois acompanha a situação: em
 * conferência, confirmado ou recusado (com o motivo do escritório).
 */
export function PedidoCompraPortal({ itens, enviados }: { itens: ItemPortal[]; enviados: PedidoEnviado[] }) {
  const router = useRouter();
  const livres = itens.filter((i) => !i.emConferencia);
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(livres.length === 1 ? [`${livres[0].tipo}:${livres[0].id}`] : []));
  const [numero, setNumero] = useState("");
  const [data, setData] = useState(hoje());
  const [valor, setValor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [anexo, setAnexo] = useState<{ conteudo: string; nome: string } | null>(null);
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<string | null>(null);

  const escolhidos = useMemo(() => livres.filter((i) => marcados.has(`${i.tipo}:${i.id}`)), [livres, marcados]);
  const total = escolhidos.reduce((s, i) => s + i.valor, 0);
  const valorNum = lerValorPedido(valor);
  const numeroOk = limparNumeroPedido(numero);
  const valorOk = valorNum === null || (!Number.isNaN(valorNum) && valorNum >= 0);
  // A recusa só aparece no topo enquanto algum serviço dela ainda espera o pedido (resolvido, o aviso sai)
  const esperando = new Set(itens.map((i) => `${i.tipo}:${i.id}`));
  const recusados = enviados.filter((p) => p.situacao === "RECUSADO" && (p.chaves ?? []).some((c) => esperando.has(c)));

  function alternar(chave: string) {
    setMarcados((m) => { const n = new Set(m); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; });
  }

  async function escolherArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > TAMANHO_MAX_PEDIDO) { setErro(MSG_ARQUIVO_PEDIDO_GRANDE); return; }
    setErro(null);
    try { setAnexo({ conteudo: await lerArquivoComoDataUrl(f), nome: f.name }); } catch { setErro(MSG_ARQUIVO_ILEGIVEL); }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setTentou(true); setErro(null);
    if (!escolhidos.length) { setErro("Escolha ao menos um serviço que o pedido cobre."); return; }
    if (!numeroOk || !valorOk) return;
    if (!anexo) { setErro("Anexe o pedido de compra (PDF ou foto)."); return; }
    setEnviando(true);
    const res = await fetch("/api/portal/pedidos-compra", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        numero: numeroOk, data, valor: valorNum, observacao, anexo,
        osIds: escolhidos.filter((i) => i.tipo === "os").map((i) => i.id),
        orcamentoIds: escolhidos.filter((i) => i.tipo === "orcamento").map((i) => i.id),
      }),
    }).catch(() => null);
    const j = await res?.json().catch(() => ({}));
    setEnviando(false);
    if (!res?.ok) { setErro(erroDoEnvio(res?.status, j, "Não foi possível enviar o pedido de compra. Tente de novo.")); return; }
    setEnviado(numeroOk);
    setNumero(""); setValor(""); setObservacao(""); setAnexo(null); setMarcados(new Set()); setTentou(false);
    router.refresh();
  }

  return (
    <div className="space-y-6" data-pedido-compra-portal>
      {enviado && (
        <p role="status" className="flex items-start gap-2 text-sm rounded-lg px-3 py-2 border bg-ok-claro border-ok/20 text-ok-texto" data-pedido-enviado>
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> Pedido de compra nº {enviado} recebido. A equipe confere e libera o faturamento; a situação aparece abaixo.
        </p>
      )}
      {recusados.slice(0, 3).map((p) => (
        <p key={p.id} role="alert" className="flex items-start gap-2 text-sm rounded-lg px-3 py-2 border bg-atrasado-claro border-atrasado/20 text-atrasado-texto" data-pedido-recusado>
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <span>Pedido de compra nº {p.numero} recusado{p.motivoRecusa ? `: ${p.motivoRecusa}` : "."} Envie um novo pedido para os serviços abaixo.</span>
        </p>
      ))}

      <section className="bg-white rounded-card border border-surface-border overflow-hidden" aria-labelledby="titulo-aguardando">
        <div className="px-4 py-3 border-b border-surface-border">
          <h2 id="titulo-aguardando" className="text-sm font-bold text-ink">Aguardando pedido de compra</h2>
          <p className="text-xs text-ink-muted mt-0.5">Serviços prestados que aguardam o pedido de compra para faturamento. Um pedido pode cobrir mais de um.</p>
        </div>
        {itens.length === 0 ? (
          <p className="px-4 py-8 text-sm text-ink-subtle text-center" data-nada-pendente>Nenhum serviço aguardando pedido de compra.</p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {itens.map((i) => {
              const chave = `${i.tipo}:${i.id}`;
              const marcado = marcados.has(chave);
              return (
                <li key={chave} className={cn("flex items-start gap-3 px-4 py-3", marcado && "bg-primary-50/50")} data-item-pendente={chave}>
                  {i.emConferencia ? (
                    <span className="w-11 h-11 shrink-0" aria-hidden />
                  ) : (
                    <label className="w-11 h-11 shrink-0 flex items-center justify-center cursor-pointer -ml-2">
                      <input type="checkbox" checked={marcado} onChange={() => alternar(chave)} className="w-5 h-5 accent-[var(--portal-cor)]" aria-label={`Incluir ${rotuloItem(i)} no pedido`} data-marcar-item={chave} />
                    </label>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">{rotuloItem(i)}{i.unidade ? <span className="font-normal text-ink-muted"> · {i.unidade}</span> : null}</p>
                    <p className="text-xs text-ink-muted">
                      {[
                        i.concluidoEm ? `${i.tipo === "os" ? "Concluída" : "Aprovado"} em ${dataBR(i.concluidoEm)}` : "Ainda não concluída",
                        i.diasEsperando ? `há ${i.diasEsperando} dia${i.diasEsperando === 1 ? "" : "s"}` : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                    {i.emConferencia && <p className="text-xs font-semibold text-acento mt-1" data-em-conferencia>Pedido nº {i.emConferencia.numero} enviado — em conferência</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-ink">{i.valor > 0 ? reais(i.valor) : "—"}</p>
                    {i.documento && (
                      <a href={i.documento} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-acento hover:underline min-h-[44px]" data-documento-item>
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden /> {i.tipo === "os" ? "Relatório (PDF)" : "Orçamento"}
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {livres.length > 0 && (
        <form onSubmit={enviar} className="bg-white rounded-card border border-surface-border p-4 space-y-4" noValidate data-form-pedido-compra>
          <div>
            <h2 className="text-sm font-bold text-ink">Enviar o pedido de compra</h2>
            <p className="text-xs text-ink-muted mt-0.5" data-resumo-escolhidos>
              {escolhidos.length
                ? `Cobre ${escolhidos.map(rotuloItem).join(", ")} · total ${reais(total)}`
                : "Marque acima os serviços que o pedido cobre."}
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <label className="block text-sm">
              <span className="font-medium text-ink">Número do pedido *</span>
              <input value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={60} className={cn("input-base mt-1", tentou && !numeroOk && "border-atrasado")} data-pc-numero />
              {tentou && !numeroOk && <span className="text-xs text-atrasado-texto">Informe o número do pedido de compra.</span>}
            </label>
            <div className="block text-sm">
              <span className="font-medium text-ink">Data do pedido</span>
              {/* dd/mm/aaaa em qualquer navegador (o nativo mostra mm/dd/yyyy num navegador em inglês) */}
              <span className="block mt-1" data-pc-data><InputData value={data} onChange={setData} aria-label="Data do pedido" /></span>
            </div>
            <label className="block text-sm">
              <span className="font-medium text-ink">Valor (R$)</span>
              <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="0,00" className={cn("input-base mt-1", tentou && !valorOk && "border-atrasado")} data-pc-valor />
              {tentou && !valorOk && <span className="text-xs text-atrasado-texto">Valor inválido.</span>}
            </label>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg border border-surface-border bg-white text-sm text-ink cursor-pointer hover:bg-surface-page">
              <Paperclip className="w-4 h-4" aria-hidden /> {anexo ? "Trocar arquivo" : "Anexar o pedido (PDF ou foto) *"}
              <input type="file" accept=".pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={escolherArquivo} data-pc-anexo />
            </label>
            {anexo && <span className="inline-flex items-center gap-1 text-sm text-ink truncate max-w-[16rem]" data-pc-anexo-nome><FileText className="w-4 h-4" aria-hidden /> {anexo.nome}</span>}
          </div>
          <label className="block text-sm">
            <span className="font-medium text-ink">Observação</span>
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} maxLength={1000} className="input-base mt-1" data-pc-observacao />
          </label>
          {erro && <p role="alert" className="text-sm text-atrasado-texto bg-atrasado-claro rounded-lg px-3 py-2" data-erro-pc>{erro}</p>}
          <button type="submit" disabled={enviando} className="inline-flex items-center justify-center gap-2 min-h-[44px] w-full sm:w-auto bg-primary-500 hover:bg-primary-600 disabled:opacity-60 text-white px-4 rounded-lg text-sm font-semibold" data-enviar-pc>
            <Send className="w-4 h-4" aria-hidden /> {enviando ? "Enviando…" : "Enviar pedido de compra"}
          </button>
        </form>
      )}

      {enviados.length > 0 && (
        <section className="bg-white rounded-card border border-surface-border overflow-hidden" aria-labelledby="titulo-enviados">
          <h2 id="titulo-enviados" className="px-4 py-3 border-b border-surface-border text-sm font-bold text-ink">Pedidos de compra enviados</h2>
          <ul className="divide-y divide-surface-border">
            {enviados.map((p) => {
              const situacao = ehSituacaoPedido(p.situacao) ? p.situacao : "CONFERIR";
              return (
                <li key={p.id} className="px-4 py-3" data-pedido-enviado-linha={situacao}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">Pedido nº {p.numero} <span className="font-normal text-ink-muted">· {diaBR(p.data)}{p.valor != null ? ` · ${reais(p.valor)}` : ""}</span></p>
                      <p className="text-xs text-ink-muted">{p.itens.join(", ") || "—"} · enviado em {dataBR(p.enviadoEm)}</p>
                    </div>
                    <span className={cn("shrink-0 text-xs font-semibold rounded-full px-2.5 py-1",
                      situacao === "CONFIRMADO" ? "bg-ok-claro text-ok-texto" : situacao === "RECUSADO" ? "bg-atrasado-claro text-atrasado-texto" : "bg-primary-50 text-primary-700")}
                      data-situacao-pedido>
                      {ROTULO_SITUACAO_PORTAL[situacao]}
                    </span>
                  </div>
                  {situacao === "RECUSADO" && p.motivoRecusa && <p className="text-xs text-atrasado-texto mt-1" data-motivo-recusa-portal>Motivo: {p.motivoRecusa}</p>}
                  {p.anexoNome && (
                    <a href={`/api/portal/pedidos-compra/${p.id}/anexo?inline=1`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-xs text-acento hover:underline min-h-[44px]" data-arquivo-enviado>
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden /> Ver o arquivo enviado
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
