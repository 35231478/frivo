"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Calculator, Camera, Check, Gauge, ListChecks, MessageSquareText, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Dica } from "@/components/ui/dica";
import { cn } from "@/lib/utils";
import { UNIDADES_SUGERIDAS, type TipoRespostaItem } from "@/lib/checklist/tipo";
import {
  aplicarFaixasSugeridas, ehCalculada, GASES, GRANDEZA, grandezaDoItem, NOME_GAS, type Gas, type Grandeza, type MudancaFaixa,
} from "@/lib/checklist/faixas";

interface ItemTela {
  chave: string; id?: string; texto: string; pedirFoto: boolean; pedirObservacao: boolean; respostas?: number;
  tipoResposta: TipoRespostaItem; unidade: string | null;
  /** Tipo gravado (mudar = item novo; o antigo sai com as respostas dele) */
  tipoOriginal?: TipoRespostaItem;
  /** Medição: o que mede (ΔT = calculado) e a faixa esperada (texto do campo, "8,5") */
  grandeza: Grandeza | null; minTxt: string; maxTxt: string;
}
type Sugestao = Omit<ItemTela, "chave" | "id" | "respostas" | "tipoOriginal" | "minTxt" | "maxTxt"> & { valorMin?: number | null; valorMax?: number | null };

let seq = 0;
const novaChave = () => `n${++seq}`;
const txt = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
/** "8,5" → 8.5; vazio → null; inválido → NaN */
export const lerFaixa = (t: string) => {
  const s = t.trim();
  if (!s) return null;
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return /^-?\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
};
const daApi = (i: {
  id: string; texto: string; pedirFoto: boolean; pedirObservacao: boolean; respostas?: number; tipoResposta?: TipoRespostaItem; unidade?: string | null;
  grandeza?: string | null; valorMin?: number | null; valorMax?: number | null;
}): ItemTela => ({
  chave: i.id, id: i.id, texto: i.texto, pedirFoto: i.pedirFoto, pedirObservacao: i.pedirObservacao, respostas: i.respostas, tipoResposta: i.tipoResposta ?? "OK_ATENCAO_NA",
  unidade: i.unidade ?? null, tipoOriginal: i.tipoResposta ?? "OK_ATENCAO_NA",
  grandeza: grandezaDoItem({ texto: i.texto, tipoResposta: i.tipoResposta ?? "OK_ATENCAO_NA", grandeza: i.grandeza }), minTxt: txt(i.valorMin), maxTxt: txt(i.valorMax),
});
const deSugestao = (s: Sugestao): ItemTela => ({ chave: novaChave(), ...s, grandeza: s.grandeza ?? null, minTxt: txt(s.valorMin), maxTxt: txt(s.valorMax) });

/**
 * Aba "Checklist" do tipo de equipamento: os itens que CADA equipamento deste tipo responde na OS
 * (OK · Atenção · Não se aplica, ou MEDIÇÃO: número + unidade, que o técnico só registra), com "pede
 * foto" / "pede observação". Adicionar, remover e reordenar; grava a lista inteira. Item removido sai
 * das próximas OS — as respostas antigas ficam no histórico. Trocar o tipo de resposta = item novo.
 */
export function ChecklistTipo({ tipoId, podeEditar }: { tipoId: string; podeEditar: boolean }) {
  const [itens, setItens] = useState<ItemTela[] | null>(null);
  const [sugestao, setSugestao] = useState<Sugestao[]>([]);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [faixas, setFaixas] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/tipos-equipamento/${tipoId}/checklist`).then((r) => r.json()).then((d) => {
      if (!vivo) return;
      setItens(Array.isArray(d?.itens) ? d.itens.map(daApi) : []);
      setSugestao(Array.isArray(d?.sugestao) ? d.sugestao : []);
    }).catch(() => vivo && setItens([]));
    return () => { vivo = false; };
  }, [tipoId]);

  const mudar = (f: (l: ItemTela[]) => ItemTela[]) => { setItens((l) => f(l ?? [])); setSujo(true); setMsg(null); };
  const editar = (i: number, patch: Partial<ItemTela>) => mudar((l) => l.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const mover = (i: number, d: -1 | 1) => mudar((l) => {
    const j = i + d;
    if (j < 0 || j >= l.length) return l;
    const n = [...l];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  async function salvar() {
    if (!itens) return;
    const vazio = itens.findIndex((i) => i.texto.trim().length < 2);
    if (vazio >= 0) { setMsg({ tipo: "erro", texto: `Item ${vazio + 1}: escreva o texto do item.` }); return; }
    const semUnidade = itens.findIndex((i) => i.tipoResposta === "MEDICAO" && !(i.unidade ?? "").trim());
    if (semUnidade >= 0) { setMsg({ tipo: "erro", texto: `Item ${semUnidade + 1}: informe a unidade da medição (ex.: psi, °C, A).` }); return; }
    const faixaRuim = itens.findIndex((i) => i.tipoResposta === "MEDICAO" && (Number.isNaN(lerFaixa(i.minTxt)) || Number.isNaN(lerFaixa(i.maxTxt))));
    if (faixaRuim >= 0) { setMsg({ tipo: "erro", texto: `Item ${faixaRuim + 1}: faixa com número inválido (use vírgula para decimais).` }); return; }
    const invertida = itens.findIndex((i) => { const [a, b] = [lerFaixa(i.minTxt), lerFaixa(i.maxTxt)]; return i.tipoResposta === "MEDICAO" && a !== null && b !== null && a > b; });
    if (invertida >= 0) { setMsg({ tipo: "erro", texto: `Item ${invertida + 1}: o mínimo da faixa não pode passar do máximo.` }); return; }
    setSalvando(true); setMsg(null);
    try {
      const res = await fetch(`/api/tipos-equipamento/${tipoId}/checklist`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: itens.map((i) => ({
            ...(i.id && { id: i.id }), texto: i.texto, tipoResposta: i.tipoResposta, pedirFoto: i.pedirFoto, pedirObservacao: i.pedirObservacao,
            ...(i.tipoResposta === "MEDICAO" && {
              unidade: (i.unidade ?? "").trim(), grandeza: i.grandeza, valorMin: lerFaixa(i.minTxt), valorMax: lerFaixa(i.maxTxt),
            }),
          })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tipo: "erro", texto: d.erro ?? "Não foi possível salvar o checklist." }); return; }
      setItens(d.itens.map(daApi)); setSujo(false);
      setMsg({ tipo: "ok", texto: "Checklist salvo. Vale para as próximas respostas das OS." });
    } catch {
      setMsg({ tipo: "erro", texto: "Erro de conexão." });
    } finally {
      setSalvando(false);
    }
  }

  if (!itens) return <p className="text-sm text-ink-muted py-4">Carregando…</p>;

  return (
    <div className="space-y-3" data-checklist-tipo>
      <p className="text-xs text-ink-muted">
        Cada equipamento deste tipo responde estes itens na OS: <strong>OK</strong>, <strong>Atenção</strong> ou <strong>Não se aplica</strong> —
        ou, nos itens de <strong>medição</strong>, o número com a unidade. Com a <strong>faixa esperada</strong>, o app alerta quando a medição sai dela (não bloqueia).
        Para concluir a OS, todos precisam de resposta (com foto/observação quando o item pede; “Atenção” sempre pede foto e observação).
      </p>

      {itens.length === 0 && (
        <div className="rounded-lg border border-dashed border-surface-border p-4 text-center space-y-2" data-checklist-vazio>
          <ListChecks className="w-6 h-6 text-ink-subtle mx-auto" />
          <p className="text-sm text-ink-muted">Este tipo ainda não tem checklist.</p>
          {podeEditar && sugestao.length > 0 && (
            <Button type="button" variant="secondary" data-usar-sugestao
              onClick={() => mudar(() => sugestao.map(deSugestao))}>
              <Sparkles className="w-4 h-4" /> Usar checklist sugerido ({sugestao.length} itens)
            </Button>
          )}
        </div>
      )}

      {podeEditar && itens.some((i) => i.tipoResposta === "MEDICAO") && (
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={() => setFaixas(true)} data-aplicar-faixas>
            <Gauge className="w-4 h-4" /> Aplicar faixas sugeridas
          </Button>
        </div>
      )}

      <ol className="space-y-2">
        {itens.map((it, i) => (
          <li key={it.chave} className="rounded-lg border border-surface-border bg-white p-2.5 space-y-2" data-item-checklist={i + 1}>
            <div className="flex items-start gap-2">
              <span className="text-xs font-semibold text-ink-muted w-5 pt-2.5 text-right shrink-0">{i + 1}.</span>
              <Input value={it.texto} onChange={(e) => editar(i, { texto: e.target.value })} disabled={!podeEditar} maxLength={300}
                aria-label={`Texto do item ${i + 1}`} name={`item-${i + 1}`} placeholder="Ex.: Limpeza dos filtros de ar" />
              {podeEditar && (
                <div className="flex items-center shrink-0">
                  <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="p-1.5 text-ink-subtle hover:text-ink disabled:opacity-30" aria-label={`Subir item ${i + 1}`}><ArrowUp className="w-4 h-4" /></button>
                  <button type="button" onClick={() => mover(i, 1)} disabled={i === itens.length - 1} className="p-1.5 text-ink-subtle hover:text-ink disabled:opacity-30" aria-label={`Descer item ${i + 1}`}><ArrowDown className="w-4 h-4" /></button>
                  <button type="button" onClick={() => mudar((l) => l.filter((_, j) => j !== i))} className="p-1.5 text-ink-subtle hover:text-atrasado" aria-label={`Excluir item ${i + 1}`}><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-7 text-xs">
              <label className="inline-flex items-center gap-1.5 text-ink-muted">
                Resposta
                <select disabled={!podeEditar} value={it.tipoResposta} className="rounded border border-surface-border bg-white px-1.5 py-0.5 text-xs text-ink" aria-label={`Tipo de resposta do item ${i + 1}`}
                  onChange={(e) => editar(i, { tipoResposta: e.target.value as TipoRespostaItem, unidade: e.target.value === "MEDICAO" ? it.unidade ?? "" : null })}>
                  <option value="OK_ATENCAO_NA">OK / Atenção / Não se aplica</option>
                  <option value="MEDICAO">Medição (número + unidade)</option>
                </select>
              </label>
              {it.tipoResposta === "MEDICAO" && (
                <label className="inline-flex items-center gap-1.5 text-ink-muted">
                  Unidade
                  <input list="unidades-medicao" value={it.unidade ?? ""} disabled={!podeEditar} maxLength={20} placeholder="psi" onChange={(e) => editar(i, { unidade: e.target.value })}
                    className="w-20 rounded border border-surface-border bg-white px-1.5 py-0.5 text-xs text-ink" aria-label={`Unidade do item ${i + 1}`} />
                </label>
              )}
              {it.tipoResposta === "MEDICAO" && (
                <span className="inline-flex items-center gap-1.5 text-ink-muted" data-faixa-item={i + 1}>
                  Faixa esperada
                  <input inputMode="decimal" value={it.minTxt} disabled={!podeEditar} placeholder="mín." onChange={(e) => editar(i, { minTxt: e.target.value })}
                    className="w-16 rounded border border-surface-border bg-white px-1.5 py-0.5 text-xs text-ink" aria-label={`Mínimo esperado do item ${i + 1}`} />
                  a
                  <input inputMode="decimal" value={it.maxTxt} disabled={!podeEditar} placeholder="máx." onChange={(e) => editar(i, { maxTxt: e.target.value })}
                    className="w-16 rounded border border-surface-border bg-white px-1.5 py-0.5 text-xs text-ink" aria-label={`Máximo esperado do item ${i + 1}`} />
                  {it.unidade}
                </span>
              )}
              {it.tipoResposta === "MEDICAO" && ehCalculada(it.grandeza) && (
                <span className="inline-flex items-center gap-1 text-primary-700" data-calculada-item={i + 1}>
                  <Calculator className="w-3.5 h-3.5" /> Calculado no app: {GRANDEZA[GRANDEZA[it.grandeza!].calculo![0]].nome.toLocaleLowerCase("pt-BR")} − {GRANDEZA[GRANDEZA[it.grandeza!].calculo![1]].nome.toLocaleLowerCase("pt-BR")}
                </span>
              )}
              {!!it.id && !!it.respostas && it.tipoOriginal !== it.tipoResposta && (
                <span className="text-atencao-texto" data-aviso-troca-tipo>Mudar o tipo cria um item novo; as respostas antigas ficam no histórico.</span>
              )}
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={it.pedirFoto} disabled={!podeEditar} onChange={(e) => editar(i, { pedirFoto: e.target.checked })} className="accent-primary-600" name={`foto-${i + 1}`} />
                <Camera className="w-3.5 h-3.5 text-ink-muted" /> Pede foto
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={it.pedirObservacao} disabled={!podeEditar} onChange={(e) => editar(i, { pedirObservacao: e.target.checked })} className="accent-primary-600" name={`obs-${i + 1}`} />
                <MessageSquareText className="w-3.5 h-3.5 text-ink-muted" /> Pede observação
              </label>
              {!!it.respostas && <span className="text-ink-subtle">já respondido em {it.respostas} atendimento{it.respostas === 1 ? "" : "s"}</span>}
            </div>
          </li>
        ))}
      </ol>

      {msg && <p role={msg.tipo === "erro" ? "alert" : "status"} className={cn("text-sm rounded-lg px-3 py-2 border", msg.tipo === "ok" ? "bg-success-50 border-success-200 text-success-700" : "bg-atrasado-claro border-atrasado/20 text-atrasado-texto")}>{msg.texto}</p>}

      {podeEditar && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={() => mudar((l) => [...l, { chave: novaChave(), texto: "", pedirFoto: false, pedirObservacao: false, tipoResposta: "OK_ATENCAO_NA", unidade: null, grandeza: null, minTxt: "", maxTxt: "" }])} data-adicionar-item>
            <Plus className="w-4 h-4" /> Adicionar item
          </Button>
          <div className="flex items-center gap-2">
            {sujo && <span className="text-xs text-atencao-texto">Alterações não salvas</span>}
            <Button type="button" onClick={salvar} loading={salvando} disabled={!sujo} data-salvar-checklist>
              <Check className="w-4 h-4" /> Salvar checklist
            </Button>
          </div>
        </div>
      )}
      <p className="text-[11px] text-ink-subtle">Item removido sai das próximas OS; respostas antigas ficam no histórico.</p>
      <datalist id="unidades-medicao">{UNIDADES_SUGERIDAS.map((u) => <option key={u} value={u} />)}</datalist>
      {faixas && <ModalFaixas itens={itens} onFechar={() => setFaixas(false)} onAplicar={(l) => { mudar(() => l); setFaixas(false); setMsg({ tipo: "ok", texto: "Faixas aplicadas. Confira e salve o checklist." }); }} />}
    </div>
  );
}

/** Os itens da tela no formato da regra pura, e de volta (a faixa vai como número) */
const paraRegra = (i: ItemTela) => ({ ...i, valorMin: lerFaixa(i.minTxt), valorMax: lerFaixa(i.maxTxt) });

/** Escolhe o gás e mostra o que muda antes de aplicar (a empresa confere com o fabricante e salva). */
function ModalFaixas({ itens, onFechar, onAplicar }: { itens: ItemTela[]; onFechar: () => void; onAplicar: (l: ItemTela[]) => void }) {
  const [gas, setGas] = useState<Gas>("R410A");
  const validos = itens.map(paraRegra).map((i) => ({ ...i, valorMin: Number.isNaN(i.valorMin) ? null : i.valorMin, valorMax: Number.isNaN(i.valorMax) ? null : i.valorMax }));
  const r = aplicarFaixasSugeridas<(typeof validos)[number]>(validos, gas, (b) => ({
    chave: novaChave(), texto: b.texto, pedirFoto: false, pedirObservacao: false, tipoResposta: "MEDICAO" as const, unidade: b.unidade, grandeza: b.grandeza as Grandeza,
    minTxt: "", maxTxt: "", valorMin: b.valorMin, valorMax: b.valorMax,
  }));
  const lista: ItemTela[] = r.itens.map(({ valorMin, valorMax, ...i }) => ({ ...i, grandeza: (i.grandeza as Grandeza | null) ?? null, minTxt: txt(valorMin), maxTxt: txt(valorMax) }));
  return (
    <Modal aberto titulo="Aplicar faixas sugeridas" onFechar={onFechar}>
      <div className="space-y-4" data-modal-faixas>
        <div className="space-y-1.5">
          <p className="text-sm font-semibold text-ink inline-flex items-center gap-1.5">Gás do equipamento
            <Dica rotulo="Faixas sugeridas" texto="Referências típicas em condição nominal. Confira com o fabricante; dá para ajustar item a item. Corrente fica sem faixa (depende da placa)." />
          </p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Gás">
            {GASES.map((g) => (
              <button key={g} type="button" role="radio" aria-checked={gas === g} onClick={() => setGas(g)} data-gas={g}
                className={cn("rounded-full border px-3.5 py-1.5 text-sm font-semibold", gas === g ? "bg-acento text-white border-acento" : "bg-white text-ink border-surface-border")}>
                {NOME_GAS[g]}
              </button>
            ))}
          </div>
        </div>
        {r.mudancas.length === 0
          ? <p className="text-sm text-ink-muted" data-sem-mudancas>Nada a mudar: as medições reconhecidas já estão com a faixa sugerida.</p>
          : <TabelaMudancas mudancas={r.mudancas} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="button" onClick={() => onAplicar(lista)} disabled={!r.mudancas.length} data-confirmar-faixas>Aplicar</Button>
        </div>
      </div>
    </Modal>
  );
}

function TabelaMudancas({ mudancas }: { mudancas: MudancaFaixa[] }) {
  return (
    <table className="w-full text-sm" data-mudancas-faixa>
      <thead><tr className="text-left text-xs text-ink-muted"><th className="py-1 font-semibold">Medição</th><th className="py-1 font-semibold w-28">Hoje</th><th className="py-1 font-semibold w-28">Fica</th></tr></thead>
      <tbody>
        {mudancas.map((m) => (
          <tr key={m.texto} className="border-t border-surface-linha" data-mudanca={m.novo ? "nova" : "faixa"}>
            <td className="py-1.5 pr-2 text-ink">{m.texto}{m.novo && <span className="ml-1.5 text-xs font-semibold text-primary-700">novo item</span>}</td>
            <td className="py-1.5 pr-2 text-ink-muted">{m.antes ?? "—"}</td>
            <td className="py-1.5 font-semibold text-ink">{m.depois ?? "sem faixa"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
