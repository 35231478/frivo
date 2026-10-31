"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LABELS_FORMA_PAGAMENTO } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { ClienteCombobox } from "@/components/ui/cliente-combobox";
import { AlertCircle } from "lucide-react";
import { SeletorCadastro } from "@/components/cadastros/seletor-cadastro";
import { InputData } from "@/components/ui/input-data";
import { EditorParcelas } from "@/components/financeiro/editor-parcelas";
import { Dica } from "@/components/ui/dica";
import type { ParcelaPlano } from "@/lib/financeiro/parcelas";

export function CobrancaForm() {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [clienteId, setClienteId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [forma, setForma] = useState("");
  const [contaBancariaId, setContaBancariaId] = useState("");
  const [centroCustoId, setCentroCustoId] = useState("");
  const [obs, setObs] = useState("");
  // À vista (uma cobrança) ou parcelado (uma cobrança por parcela, cada uma com seu vencimento/boleto)
  const [parcelado, setParcelado] = useState(false);
  const [plano, setPlano] = useState<ParcelaPlano[]>([]);
  const [motivoPlano, setMotivoPlano] = useState<string | null>(null);

  async function salvar() {
    setErro("");
    if (!clienteId) { setErro("Selecione o cliente."); return; }
    if (!descricao.trim()) { setErro("Informe a descrição."); return; }
    if (!valor || Number(valor) <= 0) { setErro("Informe um valor válido."); return; }
    if (parcelado && motivoPlano) { setErro(motivoPlano); return; }
    setSalvando(true);
    try {
      const res = await fetch("/api/contas-receber", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clienteId, descricao, categoriaId: categoriaId || null, valor: Number(valor), dataVencimento: vencimento || null, formaPagamento: forma || null, contaBancariaId: contaBancariaId || null, centroCustoId: centroCustoId || null, observacao: obs || null, ...(parcelado && { parcelas: plano }) }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao criar cobrança."); return; }
      router.push("/financeiro/contas-receber");
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="space-y-5">
      {erro && <div className="flex items-center gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3"><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</div>}
      <div className="bg-white rounded-card shadow-card border border-surface-border p-5 sm:p-6 space-y-8">
        <FormSection title="Cobrança">
          <FormField label="Cliente" required>
            <ClienteCombobox value={clienteId} onChange={setClienteId} />
          </FormField>
          <FormGrid>
            <FormField label="Descrição / referência" required><Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex: Serviço de manutenção" /></FormField>
            <FormField label="Categoria">
              <SeletorCadastro entidade="categorias-financeiras" valor={categoriaId} vazio="Sem categoria" onChange={setCategoriaId} />
            </FormField>
          </FormGrid>
          <FormGrid cols={3}>
            <FormField label="Valor" required><Input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" /></FormField>
            {!parcelado && <FormField label="Vencimento"><InputData value={vencimento} onChange={(v) => setVencimento(v)} /></FormField>}
            <FormField label="Forma de pagamento">
              <Select value={forma} onChange={(e) => setForma(e.target.value)}>
                <option value="">Selecione…</option>
                {Object.entries(LABELS_FORMA_PAGAMENTO).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </FormField>
          </FormGrid>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-ink flex items-center gap-1" id="rotulo-condicao">
              Condição <Dica rotulo="Condição" texto="Parcelado: cada parcela vira uma cobrança, com vencimento e boleto próprios." />
            </p>
            <div className="inline-flex rounded-lg border border-surface-border p-0.5 bg-surface-alt" role="radiogroup" aria-labelledby="rotulo-condicao" data-condicao>
              {([["vista", "À vista"], ["parcelado", "Parcelado"]] as const).map(([k, rotulo]) => (
                <button key={k} type="button" role="radio" aria-checked={(k === "parcelado") === parcelado} onClick={() => setParcelado(k === "parcelado")}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${(k === "parcelado") === parcelado ? "bg-white shadow-sm text-ink font-semibold" : "text-ink-muted hover:text-ink"}`} data-condicao-opcao={k}>
                  {rotulo}
                </button>
              ))}
            </div>
          </div>
          {parcelado && (
            Number(valor) > 0
              ? <EditorParcelas total={Number(valor)} primeiroVencimento={vencimento || null} onChange={(p, m) => { setPlano(p); setMotivoPlano(m); }} />
              : <p className="text-sm text-ink-muted" data-parcelar-sem-valor>Informe o valor para dividir em parcelas.</p>
          )}
          <FormGrid>
            <FormField label="Conta bancária" dica="Onde o dinheiro entra. Cadastre em Financeiro › Contas bancárias.">
              <SeletorCadastro entidade="contas-bancarias" valor={contaBancariaId} vazio="Não definida" onChange={setContaBancariaId} nome="contaBancariaId" />
            </FormField>
            <FormField label="Centro de custo">
              <SeletorCadastro entidade="centros-custo" valor={centroCustoId} vazio="Sem centro de custo" onChange={setCentroCustoId} nome="centroCustoId" />
            </FormField>
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
