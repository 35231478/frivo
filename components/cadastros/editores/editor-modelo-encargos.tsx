"use client";

import { useEffect, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Drawer } from "@/components/ui/drawer";
import { salvarCadastro, type EditorCadastroProps } from "@/components/cadastros/cadastro-padrao";
import { REGIMES, REGIME_LABEL, somaPercentuais, type Regime } from "@/lib/folha/calculo";
import { lerValor } from "@/lib/folha/validacao";

type ItemEdicao = { nome: string; percentual: string };
const paraEdicao = (itens: unknown): ItemEdicao[] =>
  (Array.isArray(itens) ? itens : []).map((i: any) => ({ nome: String(i?.nome ?? ""), percentual: String(i?.percentual ?? "").replace(".", ",") }));

/** Editor de modelo de encargos (CadastroPadrao › modelos-encargos): nome, tipo de contrato, padrão e percentuais. */
export function EditorModeloEncargos({ item, aberto, onFechar, onSalvo }: EditorCadastroProps) {
  const [nome, setNome] = useState("");
  const [regime, setRegime] = useState<Regime>("CLT");
  const [padrao, setPadrao] = useState(false);
  const [itens, setItens] = useState<ItemEdicao[]>([]);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro("");
    setNome(item?.nome ?? ""); setRegime((item?.regime as Regime) ?? "CLT"); setPadrao(!!item?.padrao);
    setItens(item ? paraEdicao(item.itens) : [{ nome: "", percentual: "" }]);
  }, [aberto, item]);

  const upd = (i: number, k: keyof ItemEdicao, v: string) => setItens((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const total = somaPercentuais(itens.map((i) => ({ nome: i.nome, percentual: Number(lerValor(i.percentual)) || 0 })));

  async function salvar() {
    setErro("");
    const validos = itens.filter((i) => i.nome.trim() || i.percentual.trim());
    if (!nome.trim()) { setErro("Informe o nome do modelo."); return; }
    if (validos.some((i) => !i.nome.trim())) { setErro("Dê um nome a cada encargo."); return; }
    if (validos.some((i) => { const v = lerValor(i.percentual); return v == null || Number.isNaN(v) || v < 0 || v > 100; })) { setErro("Percentuais devem ficar entre 0 e 100."); return; }
    setSalvando(true);
    const r = await salvarCadastro("modelos-encargos", item?.id ?? null, {
      nome: nome.trim(), regime, padrao, itens: validos.map((i) => ({ nome: i.nome.trim(), percentual: i.percentual })),
    });
    setSalvando(false);
    if (!r.ok) { setErro(r.erro); return; }
    onSalvo(r.item);
  }

  return (
    <Drawer
      aberto={aberto} onFechar={onFechar}
      titulo={item ? `Editar ${item.nome}` : "Novo modelo de encargos"}
      rodape={<>
        <Button type="button" variant="secondary" onClick={onFechar}>Cancelar</Button>
        <Button type="button" loading={salvando} onClick={salvar}><Check className="w-4 h-4" /> Salvar</Button>
      </>}
    >
      <div className="space-y-4">
        {erro && <div role="alert" className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{erro}</div>}
        {item && !item.ativo && <p className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">Modelo inativo: não aparece para novas escolhas até ser reativado.</p>}
        <FormGrid>
          <FormField label="Nome" required><Input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} /></FormField>
          <FormField label="Tipo de contrato">
            <Select value={regime} onChange={(e) => setRegime(e.target.value as Regime)}>
              {REGIMES.map((r) => <option key={r} value={r}>{REGIME_LABEL[r]}</option>)}
            </Select>
          </FormField>
        </FormGrid>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={padrao} onChange={(e) => setPadrao(e.target.checked)} className="w-4 h-4 rounded border-surface-border text-primary-600" />
          Padrão para {REGIME_LABEL[regime]} (usado por quem não escolheu outro modelo)
        </label>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink">Encargos (% sobre salário + adicionais + horas extras)</p>
          {itens.map((i, idx) => (
            <div key={idx} className="flex gap-2">
              <Input value={i.nome} onChange={(e) => upd(idx, "nome", e.target.value)} placeholder="Ex.: FGTS" className="flex-1 min-w-0" aria-label="Nome do encargo" />
              <div className="relative w-28 shrink-0">
                <Input value={i.percentual} onChange={(e) => upd(idx, "percentual", e.target.value)} inputMode="decimal" placeholder="0,00" className="pr-7" aria-label="Percentual" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-subtle">%</span>
              </div>
              <button type="button" onClick={() => setItens((xs) => xs.filter((_, j) => j !== idx))} className="p-2 text-red-500 hover:text-red-700" aria-label="Remover encargo"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setItens((xs) => [...xs, { nome: "", percentual: "" }])} className="text-sm text-primary-600 hover:underline inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Adicionar encargo</button>
            <span className="text-sm font-semibold tabular-nums text-ink">Total: {total.toLocaleString("pt-BR")}%</span>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
