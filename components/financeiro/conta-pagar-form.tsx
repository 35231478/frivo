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
import { SeletorCadastro } from "@/components/cadastros/seletor-cadastro";
import { CampoBoleto } from "@/components/financeiro/campo-boleto";
import { lerBoleto } from "@/lib/financeiro/boleto";
import { InputData } from "@/components/ui/input-data";

export function ContaPagarForm({ initialData }: { initialData?: any }) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [pedidos, setPedidos] = useState<any[]>([]);

  const [form, setForm] = useState({
    fornecedorId: initialData?.fornecedorId ?? "",
    descricao: initialData?.descricao ?? "",
    valorTotal: initialData?.valorTotal != null ? String(initialData.valorTotal) : "",
    dataVencimento: initialData?.dataVencimento ? String(initialData.dataVencimento).slice(0, 10) : "",
    formaPagamento: initialData?.formaPagamento ?? "",
    banco: initialData?.banco ?? "",
    pedidoCompraId: initialData?.pedidoCompraId ?? "",
    observacao: initialData?.observacao ?? "",
    categoriaId: initialData?.categoriaId ?? "",
    centroCustoId: initialData?.centroCustoId ?? "",
    boleto: initialData?.linhaDigitavel ?? "",
  });
  const upd = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  // Conta antiga cujo fornecedor (texto) não casou com nenhum cadastro: mostra o texto e pede a escolha
  const textoAntigo = isEditing && !initialData?.fornecedorId && initialData?.fornecedor ? String(initialData.fornecedor) : null;

  useEffect(() => {
    if (isEditing) return;
    fetch("/api/pedidos-compra").then((r) => r.json()).then((d) => setPedidos(Array.isArray(d) ? d : [])).catch(() => {});
  }, [isEditing]);

  async function salvar() {
    setErro("");
    if (!form.fornecedorId && !textoAntigo) { setErro("Escolha o fornecedor."); return; }
    if (!form.descricao.trim()) { setErro("Descrição é obrigatória."); return; }
    if (!form.valorTotal || Number(form.valorTotal) <= 0) { setErro("Informe um valor válido."); return; }
    if (form.boleto.replace(/\D/g, "")) { const b = lerBoleto(form.boleto); if (!b.ok) { setErro(`Boleto: ${b.erro}`); return; } }
    setSalvando(true);
    try {
      const url = isEditing ? `/api/contas-pagar/${initialData.id}` : "/api/contas-pagar";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          // Só manda o fornecedor quando há um escolhido (conta antiga sem cadastro segue com o texto)
          fornecedorId: form.fornecedorId || undefined,
          dataVencimento: form.dataVencimento || null,
          formaPagamento: form.formaPagamento || null,
          banco: form.banco || null,
          pedidoCompraId: form.pedidoCompraId || null,
          observacao: form.observacao || null,
          categoriaId: form.categoriaId || null,
          centroCustoId: form.centroCustoId || null,
          boleto: form.boleto.trim() || null,
        }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao salvar."); return; }
      router.push("/financeiro/contas-pagar");
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-5">
      {erro && <div className="flex items-center gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3"><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</div>}

      <div className="bg-white rounded-card shadow-card border border-surface-border p-5 sm:p-6 space-y-8">
        <FormSection title="Fornecedor">
          <FormField label="Fornecedor" required>
            {/* Só ativos para nova escolha; o fornecedor atual segue visível mesmo inativo (“(inativo)”) */}
            <SeletorCadastro entidade="fornecedores" valor={form.fornecedorId} vazio={textoAntigo ? "Escolha o fornecedor…" : "Selecione o fornecedor…"} onChange={(v) => upd("fornecedorId", v)} />
            {textoAntigo && !form.fornecedorId && (
              <p className="text-xs text-atencao-texto mt-1" data-fornecedor-antigo>
                Fornecedor antigo: “{textoAntigo}”{initialData?.fornecedorCnpj ? ` (${initialData.fornecedorCnpj})` : ""} — sem cadastro. Escolha o fornecedor para ligar esta conta.
              </p>
            )}
            {/* Fornecedor novo? "+ Novo fornecedor…" no próprio seletor cria sem sair da tela */}
          </FormField>
          <FormGrid>
            <FormField label="Descrição" required><Input value={form.descricao} onChange={(e) => upd("descricao", e.target.value)} placeholder="Ex: Compra de peças" /></FormField>
            <FormField label="Categoria">
              {/* Só ativas para nova escolha; a categoria atual segue visível mesmo inativa */}
              <SeletorCadastro entidade="categorias-financeiras" valor={form.categoriaId} vazio="Sem categoria" onChange={(v) => upd("categoriaId", v)} />
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Centro de custo">
              <SeletorCadastro entidade="centros-custo" valor={form.centroCustoId} vazio="Sem centro de custo" onChange={(v) => upd("centroCustoId", v)} />
            </FormField>
          </FormGrid>
        </FormSection>

        <FormSection title="Pagamento">
          <FormGrid cols={3}>
            <FormField label="Valor total" required><Input type="number" step="0.01" value={form.valorTotal} onChange={(e) => upd("valorTotal", e.target.value)} placeholder="0,00" /></FormField>
            <FormField label="Vencimento"><InputData value={form.dataVencimento} onChange={(v) => upd("dataVencimento", v)} /></FormField>
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
          <CampoBoleto valor={form.boleto} onChange={(v) => upd("boleto", v)} name="boleto"
            valorParcela={Number(form.valorTotal) > 0 ? Number(form.valorTotal) : null} vencimentoParcela={form.dataVencimento || null} />
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
