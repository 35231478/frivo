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
import { CLIENTE, UNIDADE, EQUIPAMENTO } from "@/components/cadastro-rapido/definicoes";
import type { OpcaoCadastro } from "@/components/ui/select-cadastro-rapido";
import { Inbox } from "lucide-react";

type Item = { id: string; nome: string; nomeFantasia?: string | null };
type UnidadeItem = { id: string; nome: string; cidade?: string | null };
type ContratoItem = { id: string; numero: string };
type EquipItem = { id: string; nome?: string | null; marca: string; modelo: string; unidadeId?: string; unidade?: { id: string; nome: string } | null };
type Solicitacao = { id: string; numero: string; cliente: string; pendente: boolean; equipamentoCliente: string | null; equipamentoRotulo: string | null };

const rotuloEquip = (e: EquipItem) => {
  const base = `${e.marca} ${e.modelo}`.trim();
  return e.nome ? `${e.nome} — ${base}` : base;
};
const opcaoEquip = (e: EquipItem): OpcaoCadastro => ({ value: e.id, label: rotuloEquip(e), descricao: e.unidade?.nome });

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
  // Modo "aceitar solicitação" (vindo da gaveta de Solicitações do calendário):
  // a MESMA OS do chamado é agendada — nada de OS nova.
  const [solicitacao, setSolicitacao] = useState<Solicitacao | null>(null);
  const [carregandoSolicitacao, setCarregandoSolicitacao] = useState(false);
  const [dataHora, setDataHora] = useState("");
  const [tecnicoId, setTecnicoId] = useState("");
  const [tecnicos, setTecnicos] = useState<Item[]>([]);
  const [equipamentoId, setEquipamentoId] = useState("");
  const [equipamentos, setEquipamentos] = useState<EquipItem[]>([]);

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then((d) => setClientes(Array.isArray(d) ? d : [])).catch(() => {})
      .finally(() => setCarregandoClientes(false));
  }, []);

  // Pré-preenchimento opcional via URL (ex.: "Abrir OS" na ficha do equipamento)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const solId = sp.get("solicitacao");
    if (solId) {
      setCarregandoSolicitacao(true);
      fetch(`/api/ordens/${solId}`).then(async (r) => {
        const os = await r.json().catch(() => null);
        if (!r.ok || !os) { setErro(os?.erro ?? "Solicitação não encontrada."); return; }
        const pendente = os.origem === "PORTAL_CLIENTE" && os.status === "AGUARDANDO_ATENDIMENTO";
        setSolicitacao({ id: os.id, numero: os.chamadoNumero ?? os.numero, cliente: os.cliente?.nomeFantasia ?? os.cliente?.nome ?? "", pendente, equipamentoCliente: os.equipamentoId ?? null, equipamentoRotulo: os.equipamento ? rotuloEquip(os.equipamento) : null });
        if (!pendente) setErro("Esta solicitação já foi tratada (aceita ou recusada).");
        setClienteId(os.clienteId);
        setEquipamentoId(os.equipamentoId ?? "");
        setForm((f) => ({
          ...f, descricao: os.descricao ?? "", unidadeId: os.unidadeId ?? "", prioridade: os.prioridade ?? "NORMAL",
          contratoId: os.contratoId ?? "", observacoes: os.observacoes ?? "",
        }));
      }).catch(() => setErro("Erro de conexão.")).finally(() => setCarregandoSolicitacao(false));
      fetch("/api/tecnicos").then((r) => r.json()).then((d) => setTecnicos(Array.isArray(d) ? d : [])).catch(() => {});
      return;
    }
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

  useEffect(() => {
    if (!solicitacao || !clienteId) return;
    fetch(`/api/equipamentos?clienteId=${clienteId}`).then((r) => r.json()).then((d) => setEquipamentos(Array.isArray(d) ? d : [])).catch(() => {});
  }, [solicitacao, clienteId]);

  async function aceitarSolicitacao() {
    if (!solicitacao) return;
    if (!dataHora) { setErro("Escolha a data e a hora do atendimento."); return; }
    if (form.descricao.trim().length < 5) { setErro("Descrição muito curta."); return; }
    setErro(""); setSalvando(true);
    try {
      const res = await fetch(`/api/solicitacoes/${solicitacao.id}/aceitar`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataHora, descricao: form.descricao, prioridade: form.prioridade, unidadeId: form.unidadeId || null,
          contratoId: form.contratoId || null, observacoes: form.observacoes || null,
          equipamentoId: equipamentoId || null, tecnicoId: tecnicoId || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErro(d.erro ?? "Não foi possível aceitar a solicitação."); return; }
      const [y, m, dia] = String(d.data).split("-").map(Number);
      router.push(`/calendario?mes=${m}&ano=${y}&dia=${dia}&view=semanal`);
      router.refresh();
    } catch { setErro("Erro de conexão."); } finally { setSalvando(false); }
  }

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
      <PageHeader
        title={solicitacao ? `Aceitar solicitação ${solicitacao.numero}` : "Nova ordem de serviço"}
        backHref={solicitacao ? "/calendario" : "/ordens"}
      />
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>}
        {solicitacao && (
          <div className="flex items-start gap-3 bg-cyan-50 border border-cyan-200 text-cyan-900 text-sm rounded-lg px-4 py-3">
            <Inbox className="w-4 h-4 shrink-0 mt-0.5" />
            <p>
              Solicitação enviada pelo cliente, já preenchida com o que ele mandou. Escolha a <strong>data e a hora</strong> do
              atendimento: ao salvar, esta mesma OS (chamado <strong>{solicitacao.numero}</strong>) passa para <strong>Agendada</strong> e
              entra no calendário.
            </p>
          </div>
        )}

        <FormSection title="Informações gerais">
          <FormField label="Cliente" required>
            {solicitacao ? (
              <p data-cliente-solicitacao className="text-sm text-ink bg-surface-alt rounded-lg px-3 py-2.5 border border-surface-border">{solicitacao.cliente}</p>
            ) : (
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
            )}
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
            {solicitacao ? (
              <FormField label="Data e hora do atendimento" required>
                <Input type="datetime-local" aria-label="Data e hora do atendimento" value={dataHora} onChange={(e) => setDataHora(e.target.value)} />
              </FormField>
            ) : (
              <FormField label="Previsão de conclusão">
                <Input type="date" value={form.previsaoConclusao} onChange={(e) => setForm((f) => ({ ...f, previsaoConclusao: e.target.value }))} />
              </FormField>
            )}
          </FormGrid>
          {solicitacao && (
            <FormGrid>
              <FormField label="Equipamento">
                {solicitacao.equipamentoCliente ? (
                  <p className="text-sm text-ink bg-surface-alt rounded-lg px-3 py-2.5 border border-surface-border">
                    {solicitacao.equipamentoRotulo}
                    <span className="block text-xs text-ink-muted">Vinculado pelo cliente na solicitação</span>
                  </p>
                ) : (
                  <SelectCadastroRapido
                    value={equipamentoId}
                    onChange={setEquipamentoId}
                    opcoes={equipamentos.filter((e) => !form.unidadeId || (e.unidade?.id ?? e.unidadeId) === form.unidadeId).map(opcaoEquip)}
                    entidade={EQUIPAMENTO.entidade}
                    contexto={form.unidadeId ? "neste endereço" : "para este cliente"}
                    placeholder="Opcional — o cliente não vinculou"
                    campos={EQUIPAMENTO.campos(form.unidadeId ? undefined : unidades.map(UNIDADE.opcao))}
                    permissao={EQUIPAMENTO.permissao}
                    linkCadastroCompleto={EQUIPAMENTO.link}
                    criar={async (v) => {
                      const e = await EQUIPAMENTO.criar(form.unidadeId, v);
                      setEquipamentos((l) => [...l, e]);
                      return opcaoEquip(e);
                    }}
                  />
                )}
              </FormField>
              <FormField label="Técnico">
                <Select value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)} placeholder="Definir depois">
                  {tecnicos.map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
                </Select>
              </FormField>
            </FormGrid>
          )}
        </FormSection>

        <FormSection title="Descrição">
          <FormField label={solicitacao ? "O que o cliente pediu (pode ajustar)" : "Descreva o serviço ou problema"} required>
            <Textarea value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} rows={4} placeholder="Descreva o que precisa ser feito…" />
          </FormField>
          <FormField label="Observações">
            <Textarea value={form.observacoes} onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))} rows={2} placeholder="Informações adicionais…" />
          </FormField>
        </FormSection>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <Button variant="secondary" onClick={() => router.back()}>Cancelar</Button>
          {solicitacao ? (
            <Button loading={salvando} onClick={aceitarSolicitacao} disabled={!solicitacao.pendente || carregandoSolicitacao}>Aceitar e agendar</Button>
          ) : (
            <Button loading={salvando} onClick={salvar}>Abrir ordem de serviço</Button>
          )}
        </div>
      </div>
    </div>
  );
}
