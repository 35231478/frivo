"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { formatarMoeda } from "@/lib/utils";
import { Plus, X, Check, CheckCircle } from "lucide-react";

export function OsOrcamento({ osId, itens: iniciais }: { osId: string; itens: any[] }) {
  const [itens, setItens] = useState(iniciais);
  const [mostraForm, setMostraForm] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [form, setForm] = useState({ descricao: "", quantidade: "1", valorUnitario: "" });

  const total = itens.reduce((acc: number, i: any) => acc + Number(i.valorTotal), 0);
  const totalExecutado = itens.filter((i: any) => i.executado).reduce((acc: number, i: any) => acc + Number(i.valorTotal), 0);

  async function adicionar() {
    if (!form.descricao || !form.valorUnitario) { setErro("Preencha a descrição e o valor unitário."); return; }
    setSalvando(true); setErro("");
    try {
      const res = await fetch(`/api/ordens/${osId}/orcamento`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ descricao: form.descricao, quantidade: Number(form.quantidade), valorUnitario: Number(form.valorUnitario) }),
      });
      if (res.ok) {
        const novo = await res.json();
        setItens((p) => [...p, novo]);
        setForm({ descricao: "", quantidade: "1", valorUnitario: "" });
        setMostraForm(false);
      } else {
        // Gravação nunca falha em silêncio: o motivo aparece na tela
        setErro((await res.json().catch(() => null))?.erro ?? "Não foi possível adicionar o item.");
      }
    } catch { setErro("Erro de conexão. Tente novamente."); } finally { setSalvando(false); }
  }

  async function marcarExecutado(itemId: string) {
    setErro("");
    try {
      const res = await fetch(`/api/ordens/${osId}/orcamento/${itemId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executado: true }),
      });
      if (res.ok) {
        const atualizado = await res.json();
        setItens((p) => p.map((i) => (i.id === itemId ? atualizado : i)));
      } else {
        setErro((await res.json().catch(() => null))?.erro ?? "Não foi possível marcar como executado.");
      }
    } catch { setErro("Erro de conexão. Tente novamente."); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-surface-page rounded-lg p-3">
        <div className="text-sm"><span className="text-ink-muted">Total do orçamento:</span> <span className="font-bold text-ink">{formatarMoeda(total)}</span></div>
        <div className="text-sm"><span className="text-ink-muted">Executado:</span> <span className="font-bold text-ok-texto">{formatarMoeda(totalExecutado)}</span></div>
      </div>

      {erro && <p className="text-sm text-atrasado bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2" data-erro-orcamento>{erro}</p>}

      {itens.length === 0 && !mostraForm && (
        <p className="text-sm text-ink-muted text-center py-6">Nenhum item no orçamento.</p>
      )}

      <table className="w-full text-sm">
        <thead className="bg-surface-page">
          <tr>
            <th className="text-left px-3 py-2 font-medium text-ink-muted">Descrição</th>
            <th className="text-right px-3 py-2 font-medium text-ink-muted w-20">Qtd</th>
            <th className="text-right px-3 py-2 font-medium text-ink-muted w-28">Unitário</th>
            <th className="text-right px-3 py-2 font-medium text-ink-muted w-28">Total</th>
            <th className="text-center px-3 py-2 font-medium text-ink-muted w-24">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-linha">
          {itens.map((i: any) => (
            <tr key={i.id} className={i.executado ? "bg-ok-claro/60" : ""}>
              <td className="px-3 py-2 text-ink">{i.descricao}</td>
              <td className="px-3 py-2 text-right text-ink-muted">{Number(i.quantidade)}</td>
              <td className="px-3 py-2 text-right text-ink-muted">{formatarMoeda(Number(i.valorUnitario))}</td>
              <td className="px-3 py-2 text-right font-medium text-ink">{formatarMoeda(Number(i.valorTotal))}</td>
              <td className="px-3 py-2 text-center">
                {i.executado ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-ok-texto bg-ok-claro px-1.5 py-0.5 rounded-full">
                    <CheckCircle className="w-3 h-3" /> Executado
                  </span>
                ) : (
                  <Button type="button" variant="ghost" onClick={() => marcarExecutado(i.id)} className="text-[10px] h-6 px-2 text-acento">
                    Marcar executado
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {mostraForm && (
        <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-3">
          <FormGrid cols={3}>
            <FormField label="Descrição" required className="sm:col-span-3">
              <Input value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} placeholder="Item ou serviço" />
            </FormField>
            <FormField label="Quantidade"><Input type="number" value={form.quantidade} onChange={(e) => setForm((f) => ({ ...f, quantidade: e.target.value }))} min="1" /></FormField>
            <FormField label="Valor unitário (R$)"><Input type="number" step="0.01" value={form.valorUnitario} onChange={(e) => setForm((f) => ({ ...f, valorUnitario: e.target.value }))} placeholder="0,00" /></FormField>
            <FormField label="Total" className="flex items-end">
              <p className="text-sm font-medium text-ink py-2">{formatarMoeda((Number(form.quantidade) || 0) * (Number(form.valorUnitario) || 0))}</p>
            </FormField>
          </FormGrid>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMostraForm(false)}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={adicionar}><Check className="w-4 h-4" /> Adicionar</Button>
          </div>
        </div>
      )}

      {!mostraForm && (
        <Button type="button" variant="secondary" onClick={() => setMostraForm(true)} className="w-full justify-center border-dashed">
          <Plus className="w-4 h-4" /> Adicionar item
        </Button>
      )}
    </div>
  );
}
