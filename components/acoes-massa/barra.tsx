"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, CheckCircle2, Download, FileText, Loader2, Printer, QrCode, RotateCcw, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { usePainelGaveta } from "@/components/ui/drawer";
import { abrirCamada, fecharCamada, noTopo } from "@/components/ui/camadas";
import { useSelecaoMassa } from "@/components/acoes-massa/selecao";
import {
  ENTIDADE, LIMITE_CONFIRMACAO_REFORCADA, MAX_SELECAO, TAMANHO_PARTE, podeAcao, podeExportar, type AcaoItem,
} from "@/lib/acoes-massa/acoes";
import { FormAplicarFiscalMassa } from "@/components/servicos/aplicar-fiscal-massa";
import { dadosDoForm, FORM_VAZIO, totalCampos, type FormAplicarFiscal } from "@/lib/nfse/aplicar-fiscal";

/**
 * Barra de ação em massa: aparece quando há seleção, mostra "N selecionados", as ações que o
 * perfil pode fazer e o atalho "selecionar todos do filtro". Confirmação obrigatória (reforçada
 * em lote grande), progresso em partes e resultado item a item ("X feitas · Y não puderam").
 */

interface Item { id: string; rotulo: string; ok: boolean; detalhe?: string; codigo?: string; motivo?: string; qrcodeId?: string }

const ICONE: Record<AcaoItem, React.ComponentType<{ className?: string }>> = { inativar: Ban, reativar: RotateCcw, "gerar-qr": QrCode, "aplicar-fiscal": FileText };
const fmt = (n: number) => n.toLocaleString("pt-BR");

/** `aoConcluir`: listas carregadas no cliente recarregam por aqui (padrão: router.refresh()). */
export function BarraAcoesMassa({ aoConcluir }: { aoConcluir?: () => void } = {}) {
  const sel = useSelecaoMassa();
  const { permissoes, role, pode } = usePermissoes();
  const router = useRouter();
  const def = ENTIDADE[sel.entidade];
  const [montado, setMontado] = useState(false);
  const [acao, setAcao] = useState<AcaoItem | null>(null);
  const [exportando, setExportando] = useState(false);
  const [erro, setErro] = useState("");
  // Lista dentro de uma gaveta (ex.: cadastros em Configurações): barra e modal vão para o painel dela
  const painel = usePainelGaveta();
  useEffect(() => setMontado(true), []);

  const acoes = (Object.keys(def.acoes) as AcaoItem[]).filter((a) => podeAcao(permissoes, role, sel.entidade, a));
  const exportar = podeExportar(permissoes, role, sel.entidade);
  const n = sel.selecionados.size;

  async function baixar() {
    setExportando(true); setErro("");
    try {
      const r = await fetch("/api/acoes-massa", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entidade: sel.entidade, acao: "exportar", ids: [...sel.selecionados] }),
      });
      if (!r.ok) { setErro((await r.json().catch(() => ({}))).erro ?? "Não foi possível exportar."); return; }
      const blob = await r.blob();
      const nome = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? `${sel.entidade}.csv`;
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: nome });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setErro("Erro de conexão ao exportar.");
    } finally {
      setExportando(false);
    }
  }

  if (!montado || (n === 0 && !acao)) return null;
  const faltam = Math.min(sel.total, MAX_SELECAO) - n;

  return createPortal(
    <>
      {n > 0 && (
        <div className="fixed z-40 inset-x-2 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 bottom-20 lg:bottom-6 sm:max-w-[min(960px,calc(100vw-2rem))]"
          role="region" aria-label="Ações em massa" data-barra-massa>
          <div className="rounded-card bg-white text-ink border border-surface-border shadow-elevated px-3 sm:px-4 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <button type="button" onClick={sel.limpar} className="p-1 rounded-md text-ink-muted hover:text-ink hover:bg-surface-page" aria-label="Limpar seleção" title="Limpar seleção">
                <X className="w-4 h-4" />
              </button>
              <div className="min-w-0 text-sm">
                <p className="font-semibold tabular-nums whitespace-nowrap" data-contagem>{fmt(n)} {n === 1 ? "selecionado" : "selecionados"}</p>
                {sel.todosDoFiltro ? (
                  <p className="text-[11px] text-ink-muted">
                    {sel.total > MAX_SELECAO ? `Os primeiros ${fmt(MAX_SELECAO)} dos ${fmt(sel.total)} do filtro (máximo por vez)` : `Todos os ${fmt(sel.total)} que batem no filtro`}
                  </p>
                ) : faltam > 0 ? (
                  <button type="button" onClick={sel.selecionarFiltro} disabled={sel.carregandoFiltro} data-acao="selecionar-filtro"
                    className="text-[11px] text-acento hover:text-acento-hover underline underline-offset-2 disabled:opacity-60 text-left">
                    {sel.carregandoFiltro ? "Selecionando…" : sel.total > MAX_SELECAO
                      ? `Selecionar os primeiros ${fmt(MAX_SELECAO)} dos ${fmt(sel.total)} do filtro`
                      : `Selecionar todos os ${fmt(sel.total)} que batem no filtro`}
                  </button>
                ) : null}
                {(sel.erroFiltro || erro) && <p className="text-[11px] text-atrasado">{sel.erroFiltro || erro}</p>}
              </div>
            </div>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 sm:ml-auto">
              {exportar && (
                <button type="button" onClick={baixar} disabled={exportando} data-acao-massa="exportar"
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-surface-border bg-white hover:bg-surface-page px-3 py-1.5 text-sm font-medium disabled:opacity-60">
                  {exportando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Exportar
                </button>
              )}
              {acoes.map((a) => {
                const d = def.acoes[a]!;
                const Icone = ICONE[a];
                return (
                  <button key={a} type="button" onClick={() => setAcao(a)} data-acao-massa={a}
                    className={cn("shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap",
                      d.perigo ? "bg-atrasado text-white hover:brightness-95" : "border border-surface-border bg-white hover:bg-surface-page")}>
                    <Icone className="w-4 h-4" /> {d.rotulo}
                  </button>
                );
              })}
              {!exportar && acoes.length === 0 && <span className="text-xs text-ink-muted">Seu perfil não tem ações em massa nesta lista.</span>}
            </div>
          </div>
        </div>
      )}
      {acao && (
        <ExecucaoMassa
          acao={acao} ids={[...sel.selecionados]}
          podeImprimirQr={pode("qrcodes", "visualizar")}
          onFechar={(houveMudanca) => { setAcao(null); if (houveMudanca) { sel.limpar(); if (aoConcluir) aoConcluir(); else router.refresh(); } }}
        />
      )}
    </>,
    painel ?? document.body,
  );
}

function ExecucaoMassa({ acao, ids, podeImprimirQr, onFechar }: { acao: AcaoItem; ids: string[]; podeImprimirQr: boolean; onFechar: (houveMudanca: boolean) => void }) {
  const sel = useSelecaoMassa();
  const ent = ENTIDADE[sel.entidade];
  const def = ent.acoes[acao]!;
  const total = ids.length;
  const reforcada = total >= LIMITE_CONFIRMACAO_REFORCADA;
  const [etapa, setEtapa] = useState<"confirmar" | "executando" | "resultado">("confirmar");
  const [digitado, setDigitado] = useState("");
  const [motivo, setMotivo] = useState("");
  const [feitos, setFeitos] = useState(0);
  const [itens, setItens] = useState<Item[]>([]);
  // Formulário da ação (ex.: dados fiscais): só os campos preenchidos vão junto com cada parte do lote
  const [form, setForm] = useState<FormAplicarFiscal>(FORM_VAZIO);
  const dados = def.formulario ? dadosDoForm(form) : undefined;

  // É uma camada: com ela aberta, o Esc e o Tab não vão para a gaveta de baixo (se houver)
  const [camada] = useState(() => abrirCamada());
  useEffect(() => () => fecharCamada(camada), [camada]);
  useEffect(() => {
    const fechar = (e: KeyboardEvent) => { if (e.key === "Escape" && etapa === "confirmar" && noTopo(camada)) onFechar(false); };
    document.addEventListener("keydown", fechar);
    return () => document.removeEventListener("keydown", fechar);
  }, [etapa, onFechar, camada]);

  async function executar() {
    setEtapa("executando");
    const partes: string[][] = [];
    for (let i = 0; i < ids.length; i += TAMANHO_PARTE) partes.push(ids.slice(i, i + TAMANHO_PARTE));
    const loteId = Math.random().toString(36).slice(2, 10);
    const acumulado: Item[] = [];
    let parar = "";
    for (let p = 0; p < partes.length; p++) {
      const parte = partes[p];
      if (parar) {
        acumulado.push(...parte.map((id) => ({ id, rotulo: id, ok: false, codigo: "nao_processado", motivo: `Não processado: ${parar}` })));
      } else {
        try {
          const r = await fetch("/api/acoes-massa", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entidade: sel.entidade, acao, ids: parte, motivo: motivo.trim() || undefined, dados, lote: { id: loteId, parte: p + 1, partes: partes.length } }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) acumulado.push(...(d.resultados as Item[]));
          else {
            const msg = d.erro ?? `erro ${r.status}`;
            acumulado.push(...parte.map((id) => ({ id, rotulo: id, ok: false, codigo: "erro", motivo: msg })));
            if (r.status === 401 || r.status === 403) parar = msg; // não adianta continuar
          }
        } catch {
          acumulado.push(...parte.map((id) => ({ id, rotulo: id, ok: false, codigo: "erro", motivo: "Erro de conexão nesta parte" })));
        }
      }
      setFeitos(acumulado.length);
      setItens([...acumulado]);
    }
    setEtapa("resultado");
  }

  const ok = itens.filter((i) => i.ok);
  const falhas = itens.filter((i) => !i.ok);
  const jaEstavam = ok.filter((i) => i.detalhe?.startsWith("Já")).length;
  const qrIds = useMemo(() => itens.map((i) => i.qrcodeId).filter(Boolean) as string[], [itens]);
  const pct = total ? Math.round((feitos / total) * 100) : 0;
  const podeConfirmar = (!reforcada || digitado.replace(/\D/g, "") === String(total)) && (!def.formulario || totalCampos(form) > 0);
  const [um, varios] = def.resultado ?? ["feita", "feitas"];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={`${def.rotulo} em massa`} data-modal-massa={etapa}>
      <div className="absolute inset-0 bg-ink/40" onClick={() => etapa === "confirmar" && onFechar(false)} />
      <div className={cn("relative bg-white w-full rounded-t-card sm:rounded-card border border-surface-border shadow-elevated max-h-[92vh] overflow-y-auto",
        def.formulario ? "sm:max-w-2xl" : "sm:max-w-lg")}>
        <div className="px-5 py-4 border-b border-surface-border flex items-center justify-between gap-3 sticky top-0 bg-white">
          <h3 className="font-display text-base font-semibold text-ink">
            {etapa === "resultado" ? "Resultado" : `${def.rotulo} ${fmt(total)} ${total === 1 ? ent.singular : ent.plural}`}
          </h3>
          {etapa !== "executando" && (
            <button type="button" onClick={() => onFechar(etapa === "resultado" && ok.length > 0)} className="text-ink-muted hover:text-ink" aria-label="Fechar"><X className="w-5 h-5" /></button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {etapa === "confirmar" && (
            <>
              <p className="text-sm text-ink">{def.impacto}</p>
              {def.formulario === "fiscal-servico" && <FormAplicarFiscalMassa valor={form} onChange={setForm} />}
              {sel.todosDoFiltro && <p className="text-xs text-ink-muted">Inclui registros de outras páginas (todos os que batem no filtro atual).</p>}
              {def.comMotivo && (
                <label className="block text-sm font-semibold text-ink space-y-1.5">
                  <span>Motivo <span className="font-normal text-ink-muted">(opcional, vai para o histórico)</span></span>
                  <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} rows={2}
                    className="w-full rounded-lg border border-surface-border px-3 py-2 text-sm font-normal focus:outline-none focus:border-acento focus:ring-4 focus:ring-acento/15" />
                </label>
              )}
              {reforcada && (
                <div className="rounded-lg border border-atencao/20 bg-atencao-claro p-3 space-y-2" data-confirmacao-reforcada>
                  <p className="flex gap-2 text-sm text-atencao-texto"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> Lote grande: {fmt(total)} registros de uma vez.</p>
                  <label className="block text-sm text-atencao-texto">
                    Para confirmar, digite <strong>{total}</strong>:
                    <input value={digitado} onChange={(e) => setDigitado(e.target.value)} inputMode="numeric" autoFocus aria-label="Digite a quantidade para confirmar"
                      className="mt-1 block w-32 rounded-lg border border-atencao/40 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-atencao" />
                  </label>
                </div>
              )}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
                <button type="button" onClick={() => onFechar(false)} className="btn-secondary text-sm">Cancelar</button>
                <button type="button" onClick={executar} disabled={!podeConfirmar} data-acao="confirmar-massa"
                  className={cn("inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50",
                    def.perigo ? "bg-atrasado hover:brightness-95" : "bg-primary-600 hover:bg-primary-700")}>
                  {def.rotulo} {fmt(total)}
                </button>
              </div>
            </>
          )}

          {etapa === "executando" && (
            <div className="space-y-2 py-2" aria-live="polite">
              <div className="flex items-center justify-between text-sm text-ink">
                <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Processando…</span>
                <span className="tabular-nums">{fmt(feitos)} de {fmt(total)}</span>
              </div>
              <div className="h-2 rounded-full bg-surface-alt overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={feitos}>
                <div className="h-full bg-primary-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-ink-muted">Não feche esta janela. Cada registro passa pelas mesmas regras da ação individual.</p>
            </div>
          )}

          {etapa === "resultado" && (
            <div className="space-y-4" data-resultado-massa>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className="flex items-center gap-1.5 font-semibold text-success-700"><CheckCircle2 className="w-4 h-4" /> {fmt(ok.length)} {ok.length === 1 ? um : varios}</span>
                <span className={cn("flex items-center gap-1.5 font-semibold", falhas.length ? "text-atrasado-texto" : "text-ink-muted")}><XCircle className="w-4 h-4" /> {fmt(falhas.length)} não {falhas.length === 1 ? "pôde" : "puderam"}</span>
              </div>
              {jaEstavam > 0 && <p className="text-xs text-ink-muted">{jaEstavam === 1 ? `1 já estava assim (conta como ${um}; nada mudou).` : `${fmt(jaEstavam)} já estavam assim (contam como ${varios}; nada mudou).`}</p>}
              {falhas.length > 0 && (
                <div className="rounded-lg border border-atrasado/20">
                  <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-atrasado-texto border-b border-atrasado/20 bg-atrasado-claro">Não puderam — motivo de cada um</p>
                  <ul className="divide-y divide-surface-border max-h-72 overflow-y-auto">
                    {falhas.map((f) => (
                      <li key={f.id} className="px-3 py-2 text-sm">
                        <p className="font-medium text-ink break-words">{f.rotulo}</p>
                        <p className="text-xs text-atrasado-texto break-words">{f.motivo}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {acao === "gerar-qr" && qrIds.length > 0 && podeImprimirQr && (
                <div className="flex flex-wrap gap-2">
                  {Array.from({ length: Math.ceil(qrIds.length / 100) }, (_, i) => (
                    <a key={i} href={`/qrcodes/imprimir?ids=${qrIds.slice(i * 100, (i + 1) * 100).join(",")}`} target="_blank" rel="noreferrer"
                      className="btn-secondary inline-flex items-center gap-1.5 text-sm">
                      <Printer className="w-4 h-4" /> Imprimir etiquetas{qrIds.length > 100 ? ` (${i * 100 + 1}–${Math.min((i + 1) * 100, qrIds.length)})` : ""}
                    </a>
                  ))}
                </div>
              )}
              <div className="flex justify-end">
                <button type="button" onClick={() => onFechar(ok.length > 0)} className="btn-primary text-sm" data-acao="fechar-resultado">Fechar</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
