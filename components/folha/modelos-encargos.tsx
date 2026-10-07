"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { REGIMES, REGIME_LABEL, somaPercentuais, type ItemEncargo, type Regime } from "@/lib/folha/calculo";
import { lerValor } from "@/lib/folha/validacao";

/** Modelos de encargos por tipo de contrato, com percentuais editáveis (ajustar com o contador). */

interface Modelo { id: string; nome: string; regime: Regime; padrao: boolean; itens: ItemEncargo[]; emUso: number }
interface Edicao { id?: string; nome: string; regime: Regime; padrao: boolean; itens: { nome: string; percentual: string }[] }

const paraEdicao = (m: Modelo): Edicao => ({ id: m.id, nome: m.nome, regime: m.regime, padrao: m.padrao, itens: m.itens.map((i) => ({ nome: i.nome, percentual: String(i.percentual).replace(".", ",") })) });

export function ModelosEncargos({ modelos }: { modelos: Modelo[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<Edicao | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [ok, setOk] = useState("");

  async function salvar() {
    if (!editando) return;
    setErro("");
    const itens = editando.itens.filter((i) => i.nome.trim() || i.percentual.trim());
    if (itens.some((i) => !i.nome.trim())) { setErro("Dê um nome a cada encargo."); return; }
    if (itens.some((i) => { const v = lerValor(i.percentual); return v == null || Number.isNaN(v) || v < 0 || v > 100; })) { setErro("Percentuais devem ficar entre 0 e 100."); return; }
    setSalvando(true);
    try {
      const r = await fetch(editando.id ? `/api/folha/modelos/${editando.id}` : "/api/folha/modelos", {
        method: editando.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome: editando.nome, regime: editando.regime, padrao: editando.padrao, itens: itens.map((i) => ({ nome: i.nome.trim(), percentual: i.percentual })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.erro ?? "Erro ao salvar o modelo."); return; }
      setOk(`“${editando.nome}” salvo`);
      setEditando(null);
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function excluir(m: Modelo) {
    if (!window.confirm(`Excluir o modelo “${m.nome}”?${m.emUso ? ` ${m.emUso} colaborador(es) voltarão a usar o padrão do tipo de contrato.` : ""}`)) return;
    const r = await fetch(`/api/folha/modelos/${m.id}`, { method: "DELETE" });
    if (r.ok) { setOk(`“${m.nome}” excluído`); router.refresh(); } else setErro((await r.json().catch(() => ({}))).erro ?? "Erro ao excluir.");
  }

  const upd = (i: number, k: "nome" | "percentual", v: string) =>
    setEditando((e) => e && { ...e, itens: e.itens.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const somaEdicao = editando ? somaPercentuais(editando.itens.map((i) => ({ nome: i.nome, percentual: Number(lerValor(i.percentual)) || 0 }))) : 0;

  return (
    <div className="space-y-4">
      {ok && <p className="flex items-center gap-1.5 text-sm text-success-600"><Check className="w-4 h-4" /> {ok}</p>}
      {erro && !editando && <p className="flex items-center gap-1.5 text-sm text-red-600"><AlertCircle className="w-4 h-4" /> {erro}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {modelos.map((m) => (
          <section key={m.id} className="card-padded min-w-0" data-modelo={m.regime}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <h2 className="card-title flex items-center gap-1.5 truncate">{m.nome}{m.padrao && <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-400 shrink-0" aria-label="Padrão" />}</h2>
                <p className="text-xs text-ink-muted">{REGIME_LABEL[m.regime]}{m.padrao ? " · padrão do tipo" : ""}{m.emUso ? ` · ${m.emUso} colaborador(es) escolheram este modelo` : ""}</p>
              </div>
              <p className="text-lg font-bold text-ink tabular-nums whitespace-nowrap">{somaPercentuais(m.itens).toLocaleString("pt-BR")}%</p>
            </div>
            {m.itens.length === 0 ? <p className="text-sm text-ink-muted">Sem encargos (só salário/base e benefícios).</p> : (
              <ul className="text-sm space-y-1">
                {m.itens.map((i) => (
                  <li key={i.nome} className="flex justify-between gap-3"><span className="text-ink-muted truncate">{i.nome}</span><span className="tabular-nums text-ink">{i.percentual.toLocaleString("pt-BR")}%</span></li>
                ))}
              </ul>
            )}
            <div className="flex gap-2 mt-4">
              <Button type="button" variant="secondary" onClick={() => { setErro(""); setOk(""); setEditando(paraEdicao(m)); }} className="text-xs py-1.5 px-3 h-auto">Editar percentuais</Button>
              <Button type="button" variant="ghost" onClick={() => excluir(m)} className="text-xs py-1.5 px-2 h-auto text-red-500 hover:text-red-700" aria-label={`Excluir ${m.nome}`}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          </section>
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={() => { setErro(""); setOk(""); setEditando({ nome: "", regime: "CLT", padrao: false, itens: [{ nome: "", percentual: "" }] }); }}>
        <Plus className="w-4 h-4" /> Novo modelo
      </Button>

      {editando && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Editar modelo de encargos">
          <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4">
            <h2 className="text-base font-semibold text-ink">{editando.id ? "Editar modelo de encargos" : "Novo modelo de encargos"}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm font-semibold text-ink space-y-1.5 block">Nome
                <Input value={editando.nome} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} maxLength={80} />
              </label>
              <label className="text-sm font-semibold text-ink space-y-1.5 block">Tipo de contrato
                <Select value={editando.regime} onChange={(e) => setEditando({ ...editando, regime: e.target.value as Regime })}>
                  {REGIMES.map((r) => <option key={r} value={r}>{REGIME_LABEL[r]}</option>)}
                </Select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={editando.padrao} onChange={(e) => setEditando({ ...editando, padrao: e.target.checked })} className="w-4 h-4 rounded border-surface-border text-primary-600" />
              Padrão para {REGIME_LABEL[editando.regime]} (usado por quem não escolheu outro modelo)
            </label>
            <div className="space-y-2">
              <p className="text-sm font-semibold text-ink">Encargos (% sobre salário + adicionais + horas extras)</p>
              {editando.itens.map((i, idx) => (
                <div key={idx} className="flex gap-2">
                  <Input value={i.nome} onChange={(e) => upd(idx, "nome", e.target.value)} placeholder="Ex.: FGTS" className="flex-1 min-w-0" aria-label="Nome do encargo" />
                  <div className="relative w-28 shrink-0">
                    <Input value={i.percentual} onChange={(e) => upd(idx, "percentual", e.target.value)} inputMode="decimal" placeholder="0,00" className="pr-7" aria-label="Percentual" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-subtle">%</span>
                  </div>
                  <button type="button" onClick={() => setEditando({ ...editando, itens: editando.itens.filter((_, j) => j !== idx) })} className="p-2 text-red-500 hover:text-red-700" aria-label="Remover encargo"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <button type="button" onClick={() => setEditando({ ...editando, itens: [...editando.itens, { nome: "", percentual: "" }] })} className="text-sm text-primary-600 hover:underline inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Adicionar encargo</button>
                <span className={cn("text-sm font-semibold tabular-nums", "text-ink")}>Total: {somaEdicao.toLocaleString("pt-BR")}%</span>
              </div>
            </div>
            {erro && <p className="flex items-center gap-1.5 text-sm text-red-600"><AlertCircle className="w-4 h-4" /> {erro}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setEditando(null); setErro(""); }}>Cancelar</Button>
              <Button type="button" onClick={salvar} loading={salvando}>Salvar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
