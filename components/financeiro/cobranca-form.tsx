"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { ClienteCombobox } from "@/components/ui/cliente-combobox";
import { AlertCircle } from "lucide-react";

export function CobrancaForm() {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [categorias, setCategorias] = useState<any[]>([]);

  const [clienteId, setClienteId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoria, setCategoria] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [forma, setForma] = useState("");
  const [banco, setBanco] = useState("");
  const [obs, setObs] = useState("");

  useEffect(() => {
    fetch("/api/categorias-financeiras").then((r) => r.json()).then((d) => setCategorias(Array.isArray(d) ? d.filter((c: any) => c.ativo !== false) : [])).catch(() => {});
  }, []);

  async function salvar() {
    setErro("");
    if (!clienteId) { setErro("Selecione o cliente."); return; }
    if (!descricao.trim()) { setErro("Informe a descrição."); return; }
    if (!valor || Number(valor) <= 0) { setErro("Informe um valor válido."); return; }
    setSalvando(true);
    try {
      const res = await fetch("/api/contas-receber", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, descricao, categoria: categoria || null, valor: Number(valor), dataVencimento: vencimento || null, formaPagamento: forma || null, banco: banco || null, observacao: obs || null }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao criar cobrança."); return; }
      router.push("/financeiro/contas-receber");
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-5">
      {erro && <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3"><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</div>}
      <div className="bg-white rounded-2xl shadow-card border border-surface-border p-5 sm:p-6 space-y-8">
        <FormSection title="Cobrança">
          <FormField label="Cliente" required>
            <ClienteCombobox value={clienteId} onChange={setClienteId} />
          </FormField>
          <FormGrid>
            <FormField label="Descrição / referência" required><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Serviço de manutenção" /></FormField>
            <FormField label="Categoria">
              <Select value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="">Sem categoria</option>
                {categorias.map((c) => <option key={c.id} value={c.nome}>{c.nome}</option>)}
              </Select>
            </FormField>
          </FormGrid>
          <FormGrid cols={3}>
            <FormField label="Valor" required><Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" /></FormField>
            <FormField label="Vencimento"><Input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} /></FormField>
            <FormField label="Forma de pagamento">
              <Select value={forma} onChange={(e) => setForma(e.target.value)}>
                <option value="">Selecione…</option>
                {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Banco para recebimento"><Input value={banco} onChange={(e) => setBanco(e.target.value)} /></FormField>
          </FormGrid>
          <FormField label="Observação"><Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} /></FormField>
        </FormSection>
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button loading={salvando} onClick={salvar}>Criar cobrança</Button>
      </div>
    </div>
  );
}
