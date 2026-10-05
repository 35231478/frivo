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
import { SelectCadastroRapido } from "@/components/ui/select-cadastro-rapido";
import { CLIENTE, UNIDADE } from "@/components/cadastro-rapido/definicoes";

type Item = { id: string; nome: string; nomeFantasia?: string | null };
type UnidadeItem = { id: string; nome: string; cidade?: string | null };
type ContratoItem = { id: string; numero: string };

export default function NovaOrdemPage() {
  const router = useRouter();
  const [clientes, setClientes] = useState<Item[]>([]);
  const [unidades, setUnidades] = useState<UnidadeItem[]>([]);
  const [contratos, setContratos] = useState<ContratoItem[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [carregandoClientes, setCarregandoClientes] = useState(true);
  const [carregandoUnidades, setCarregandoUnidades] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    prioridade: "NORMAL", descricao: "", unidadeId: "", contratoId: "",
    previsaoConclusao: "", observacoes: "",
  });

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then((d) => setClientes(Array.isArray(d) ? d : [])).catch(() => {})
      .finally(() => setCarregandoClientes(false));
  }, []);

  // Pré-preenchimento opcional via URL (ex.: "Abrir OS" na ficha do equipamento)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const cli = sp.get("clienteId");
    if (cli) setClienteId(cli);
    const unidadeId = sp.get("unidadeId") ?? "";
    const descricao = sp.get("descricao") ?? "";
    if (unidadeId || descricao) setForm((f) => ({ ...f, unidadeId: unidadeId || f.unidadeId, descricao: descricao || f.descricao }));
  }, []);

  useEffect(() => {
    if (!clienteId) { setUnidades([]); setContratos([]); return; }
    setCarregandoUnidades(true);
    fetch(`/api/unidades?clienteId=${clienteId}`).then((r) => r.json()).then((d) => setUnidades(Array.isArray(d) ? d : [])).catch(() => {})
      .finally(() => setCarregandoUnidades(false));
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
            <SelectCadastroRapido
              value={clienteId}
              onChange={(v) => { setClienteId(v); setForm((f) => ({ ...f, unidadeId: "", contratoId: "" })); }}
              opcoes={clientes.map(CLIENTE.opcao)}
              entidade={CLIENTE.entidade}
              placeholder="Selecione o cliente"
              carregando={carregandoClientes}
              campos={CLIENTE.campos}
              valoresIniciais={CLIENTE.valoresIniciais}
              campoBusca="nome"
              permissao={CLIENTE.permissao}
              linkCadastroCompleto={CLIENTE.link}
              criar={async (v) => {
                const c = await CLIENTE.criar(v);
                setClientes((l) => [...l, c]);
                return CLIENTE.opcao(c);
              }}
            />
          </FormField>
          <FormGrid>
            <FormField label="Endereço do cliente">
              <SelectCadastroRapido
                value={form.unidadeId}
                onChange={(v) => setForm((f) => ({ ...f, unidadeId: v }))}
                opcoes={unidades.map(UNIDADE.opcao)}
                entidade={UNIDADE.entidade}
                contexto="para este cliente"
                placeholder="Selecione"
                disabled={!clienteId}
                textoDesabilitado="Selecione um cliente primeiro"
                carregando={carregandoUnidades}
                campos={UNIDADE.campos}
                campoBusca="nome"
                permissao={UNIDADE.permissao}
                linkCadastroCompleto={clienteId ? UNIDADE.link(clienteId) : undefined}
                criar={async (v) => {
                  const u = await UNIDADE.criar(clienteId, v, unidades.length === 0);
                  setUnidades((l) => [...l, u]);
                  return UNIDADE.opcao(u);
                }}
              />
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
