"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { AlertCircle } from "lucide-react";

export function ContaPagarForm({ initialData }: { initialData?: any }) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [pedidos, setPedidos] = useState<any[]>([]);

  const [form, setForm] = useState({
    fornecedor: initialData?.fornecedor ?? "",
    fornecedorCnpj: initialData?.fornecedorCnpj ?? "",
    descricao: initialData?.descricao ?? "",
    valorTotal: initialData?.valorTotal != null ? String(initialData.valorTotal) : "",
    dataVencimento: initialData?.dataVencimento ? String(initialData.dataVencimento).slice(0, 10) : "",
    formaPagamento: initialData?.formaPagamento ?? "",
    banco: initialData?.banco ?? "",
    pedidoCompraId: initialData?.pedidoCompraId ?? "",
    observacao: initialData?.observacao ?? "",
  });
  const upd = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (isEditing) return;
    fetch("/api/pedidos-compra").then((r) => r.json()).then((d) => setPedidos(Array.isArray(d) ? d : [])).catch(() => {});
  }, [isEditing]);

  async function salvar() {
    setErro("");
    if (!form.fornecedor.trim()) { setErro("Fornecedor é obrigatório."); return; }
    if (!form.descricao.trim()) { setErro("Descrição é obrigatória."); return; }
    if (!form.valorTotal || Number(form.valorTotal) <= 0) { setErro("Informe um valor válido."); return; }
    setSalvando(true);
    try {
      const url = isEditing ? `/api/contas-pagar/${initialData.id}` : "/api/contas-pagar";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          fornecedorCnpj: form.fornecedorCnpj || null,
          dataVencimento: form.dataVencimento || null,
          formaPagamento: form.formaPagamento || null,
          banco: form.banco || null,
          pedidoCompraId: form.pedidoCompraId || null,
          observacao: form.observacao || null,
        }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao salvar."); return; }
      router.push("/financeiro/contas-pagar");
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-5">
      {erro && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3"><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</div>}

      <div className="bg-white rounded-2xl shadow-card border border-surface-border p-5 sm:p-6 space-y-8">
        <FormSection title="Fornecedor">
          <FormGrid>
            <FormField label="Fornecedor" required><Input value={form.fornecedor} onChange={(e) => upd("fornecedor", e.target.value)} /></FormField>
            <FormField label="CNPJ"><Input value={form.fornecedorCnpj} onChange={(e) => upd("fornecedorCnpj", e.target.value)} placeholder="00.000.000/0000-00" /></FormField>
          </FormGrid>
          <FormField label="Descrição" required><Input value={form.descricao} onChange={(e) => upd("descricao", e.target.value)} placeholder="Ex: Compra de peças" /></FormField>
        </FormSection>

        <FormSection title="Pagamento">
          <FormGrid cols={3}>
            <FormField label="Valor total" required><Input type="number" step="0.01" value={form.valorTotal} onChange={(e) => upd("valorTotal", e.target.value)} placeholder="0,00" /></FormField>
            <FormField label="Vencimento"><Input type="date" value={form.dataVencimento} onChange={(e) => upd("dataVencimento", e.target.value)} /></FormField>
            <FormField label="Forma de pagamento">
              <Select value={form.formaPagamento} onChange={(e) => upd("formaPagamento", e.target.value)}>
                <option value="">Selecione…</option>
                {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Banco do fornecedor"><Input value={form.banco} onChange={(e) => upd("banco", e.target.value)} /></FormField>
            {!isEditing && (
              <FormField label="Vincular a pedido de compra" hint="Opcional">
                <Select value={form.pedidoCompraId} onChange={(e) => upd("pedidoCompraId", e.target.value)}>
                  <option value="">Nenhum</option>
                  {pedidos.map((p) => <option key={p.id} value={p.id}>{p.numero}</option>)}
                </Select>
              </FormField>
            )}
          </FormGrid>
          <FormField label="Observação"><Textarea value={form.observacao} onChange={(e) => upd("observacao", e.target.value)} rows={2} /></FormField>
        </FormSection>
      </div>

      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button loading={salvando} onClick={salvar}>{isEditing ? "Salvar alterações" : "Criar conta a pagar"}</Button>
      </div>
    </div>
  );
}
