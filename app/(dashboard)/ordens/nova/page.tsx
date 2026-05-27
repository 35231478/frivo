"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { LABELS_PRIORIDADE } from "@/lib/utils";

type Item = { id: string; nome: string; nomeFantasia?: string | null };
type UnidadeItem = { id: string; nome: string; cidade?: string | null };
type ContratoItem = { id: string; numero: string };

export default function NovaOrdemPage() {
  const router = useRouter();
  const [clientes, setClientes] = useState<Item[]>([]);
  const [unidades, setUnidades] = useState<UnidadeItem[]>([]);
  const [contratos, setContratos] = useState<ContratoItem[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    prioridade: "NORMAL", descricao: "", unidadeId: "", contratoId: "",
    previsaoConclusao: "", observacoes: "",
  });

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then(setClientes).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clienteId) { setUnidades([]); setContratos([]); return; }
    fetch(`/api/unidades?clienteId=${clienteId}`).then((r) => r.json()).then(setUnidades).catch(() => {});
    fetch(`/api/contratos?clienteId=${clienteId}`).then((r) => r.json()).then(setContratos).catch(() => {});
  }, [clienteId]);

  async function salvar() {
    if (!clienteId || !form.descricao.trim()) { setErro("Cliente e descrição são obrigatórios."); return; }
    setErro(""); setSalvando(true);
    try {
      const res = await fetch("/api/ordens", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, clienteId }),
      });
      if (!res.ok) { const e = await res.json(); setErro(e.erro ?? "Erro ao criar OS."); return; }
      const os = await res.json();
      router.push(`/ordens/${os.id}`);
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader title="Nova ordem de serviço" backHref="/ordens" />
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>}

        <FormSection title="Informações gerais">
          <FormField label="Cliente" required>
            <Select value={clienteId} onChange={(e) => setClienteId(e.target.value)} placeholder="Selecione o cliente">
              {clientes.map((c) => (<option key={c.id} value={c.id}>{c.nomeFantasia ?? c.nome}</option>))}
            </Select>
          </FormField>
          <FormGrid>
            <FormField label="Endereço do cliente">
              <Select value={form.unidadeId} onChange={(e) => setForm((f) => ({ ...f, unidadeId: e.target.value }))} placeholder={clienteId ? "Selecione" : "Selecione um cliente primeiro"} disabled={!clienteId}>
                {unidades.map((u) => (<option key={u.id} value={u.id}>{u.nome}{u.cidade ? ` — ${u.cidade}` : ""}</option>))}
              </Select>
            </FormField>
            <FormField label="Contrato vinculado">
              <Select value={form.contratoId} onChange={(e) => setForm((f) => ({ ...f, contratoId: e.target.value }))} placeholder="Sem contrato" disabled={!clienteId}>
                {contratos.map((c) => (<option key={c.id} value={c.id}>{c.numero}</option>))}
              </Select>
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Prioridade" required>
              <Select value={form.prioridade} onChange={(e) => setForm((f) => ({ ...f, prioridade: e.target.value }))}>
                {Object.entries(LABELS_PRIORIDADE).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </Select>
            </FormField>
            <FormField label="Previsão de conclusão">
              <Input type="date" value={form.previsaoConclusao} onChange={(e) => setForm((f) => ({ ...f, previsaoConclusao: e.target.value }))} />
            </FormField>
          </FormGrid>
        </FormSection>

        <FormSection title="Descrição">
          <FormField label="Descreva o serviço ou problema" required>
            <Textarea value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} rows={4} placeholder="Descreva o que precisa ser feito…" />
          </FormField>
          <FormField label="Observações">
            <Textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} rows={2} placeholder="Informações adicionais…" />
          </FormField>
        </FormSection>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
          <Button loading={salvando} onClick={salvar}>Abrir ordem de serviço</Button>
        </div>
      </div>
    </div>
  );
}
