"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Camera, Check, ListChecks, MessageSquareText, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface ItemTela { chave: string; id?: string; texto: string; pedirFoto: boolean; pedirObservacao: boolean; respostas?: number }
type Sugestao = { texto: string; pedirFoto: boolean; pedirObservacao: boolean };

let seq = 0;
const novaChave = () => `n${++seq}`;
const daApi = (i: { id: string; texto: string; pedirFoto: boolean; pedirObservacao: boolean; respostas?: number }): ItemTela =>
  ({ chave: i.id, id: i.id, texto: i.texto, pedirFoto: i.pedirFoto, pedirObservacao: i.pedirObservacao, respostas: i.respostas });

/**
 * Aba "Checklist" do tipo de equipamento: os itens que CADA equipamento deste tipo responde na OS
 * (OK · Atenção · Não se aplica), com "pede foto" / "pede observação". Adicionar, remover e reordenar;
 * grava a lista inteira. Item removido sai das próximas OS — as respostas antigas ficam no histórico.
 */
export function ChecklistTipo({ tipoId, podeEditar }: { tipoId: string; podeEditar: boolean }) {
  const [itens, setItens] = useState<ItemTela[] | null>(null);
  const [sugestao, setSugestao] = useState<Sugestao[]>([]);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

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
    setSalvando(true); setMsg(null);
    try {
      const res = await fetch(`/api/tipos-equipamento/${tipoId}/checklist`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: itens.map((i) => ({ ...(i.id && { id: i.id }), texto: i.texto, tipoResposta: "OK_ATENCAO_NA", pedirFoto: i.pedirFoto, pedirObservacao: i.pedirObservacao })),
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
        Cada equipamento deste tipo responde estes itens na OS: <strong>OK</strong>, <strong>Atenção</strong> ou <strong>Não se aplica</strong>.
        Para concluir a OS, todos precisam de resposta (com foto/observação quando o item pede).
      </p>

      {itens.length === 0 && (
        <div className="rounded-lg border border-dashed border-surface-border p-4 text-center space-y-2" data-checklist-vazio>
          <ListChecks className="w-6 h-6 text-ink-subtle mx-auto" />
          <p className="text-sm text-ink-muted">Este tipo ainda não tem checklist.</p>
          {podeEditar && sugestao.length > 0 && (
            <Button type="button" variant="secondary" data-usar-sugestao
              onClick={() => mudar(() => sugestao.map((s) => ({ chave: novaChave(), ...s })))}>
              <Sparkles className="w-4 h-4" /> Usar checklist sugerido ({sugestao.length} itens)
            </Button>
          )}
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
                  <button type="button" onClick={() => mudar((l) => l.filter((_, j) => j !== i))} className="p-1.5 text-ink-subtle hover:text-red-600" aria-label={`Remover item ${i + 1}`}><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-7 text-xs">
              <label className="inline-flex items-center gap-1.5 text-ink-muted">
                Resposta
                <select disabled={!podeEditar} value="OK_ATENCAO_NA" onChange={() => {}} className="rounded border border-surface-border bg-white px-1.5 py-0.5 text-xs text-ink" aria-label={`Tipo de resposta do item ${i + 1}`}>
                  <option value="OK_ATENCAO_NA">OK / Atenção / Não se aplica</option>
                </select>
              </label>
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

      {msg && <p role={msg.tipo === "erro" ? "alert" : "status"} className={cn("text-sm rounded-lg px-3 py-2 border", msg.tipo === "ok" ? "bg-success-50 border-success-200 text-success-700" : "bg-red-50 border-red-200 text-red-700")}>{msg.texto}</p>}

      {podeEditar && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={() => mudar((l) => [...l, { chave: novaChave(), texto: "", pedirFoto: false, pedirObservacao: false }])} data-adicionar-item>
            <Plus className="w-4 h-4" /> Adicionar item
          </Button>
          <div className="flex items-center gap-2">
            {sujo && <span className="text-xs text-amber-700">Alterações não salvas</span>}
            <Button type="button" onClick={salvar} loading={salvando} disabled={!sujo} data-salvar-checklist>
              <Check className="w-4 h-4" /> Salvar checklist
            </Button>
          </div>
        </div>
      )}
      <p className="text-[11px] text-ink-subtle">Item removido sai das próximas OS; o que já foi respondido continua no histórico e nos relatórios, com o texto da época.</p>
    </div>
  );
}
