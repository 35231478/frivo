"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { cn, formatarDataHora } from "@/lib/utils";
import { AtividadeEquipamentos } from "@/components/os/atividade-equipamentos";
import { SeletorTecnicos, VALOR_TECNICOS_VAZIO, corpoTecnicos, valorDaAtividade, type EquipeOpcao, type ValorTecnicos } from "@/components/os/seletor-tecnicos";
import { Plus, X, Check, ChevronDown, ChevronRight, Wrench, User, Users, Smartphone, Pencil, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { usePermissoes } from "@/components/providers/permissoes-provider";

/** ISO → valor de <input type="datetime-local"> no fuso do navegador. */
function paraInputLocal(iso?: string | Date | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_LABELS: Record<string, string> = { AGENDADA: "Agendada", EM_ANDAMENTO: "Em Andamento", CONCLUIDA: "Concluída", CANCELADA: "Cancelada" };
const STATUS_COR: Record<string, string> = { AGENDADA: "bg-purple-100 text-purple-700", EM_ANDAMENTO: "bg-yellow-100 text-yellow-700", CONCLUIDA: "bg-green-100 text-green-700", CANCELADA: "bg-red-100 text-red-700" };

export function OsAtividades({ osId, atividades: iniciais, clienteId, unidadeId }: { osId: string; atividades: any[]; clienteId?: string; unidadeId?: string | null }) {
  const [atividades, setAtividades] = useState(iniciais);
  const [expandido, setExpandido] = useState<Set<string>>(new Set());
  const [mostraForm, setMostraForm] = useState(false);
  const [tiposOs, setTiposOs] = useState<any[]>([]);
  const [tecnicos, setTecnicos] = useState<any[]>([]);
  const [carregandoTecnicos, setCarregandoTecnicos] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erroStatus, setErroStatus] = useState("");
  const [form, setForm] = useState({ titulo: "", tipoOsId: "", dataAgendada: "", duracaoMin: "", observacao: "" });
  // Técnicos da atividade: equipe e/ou técnicos individuais (responsável = tecnicoId)
  const [equipes, setEquipes] = useState<EquipeOpcao[]>([]);
  const [tecnicosNova, setTecnicosNova] = useState<ValorTecnicos>(VALOR_TECNICOS_VAZIO);
  const [tecnicosEdicao, setTecnicosEdicao] = useState<ValorTecnicos>(VALOR_TECNICOS_VAZIO);
  const [erroForm, setErroForm] = useState("");
  const { pode } = usePermissoes();
  const podeEditar = pode("ordens", "editar");
  const podeExcluir = pode("ordens", "excluir");
  const podeStatus = podeEditar || pode("ordens", "concluir");
  // Editar / excluir atividade
  const [editando, setEditando] = useState<any | null>(null);
  const [formEdicao, setFormEdicao] = useState({ titulo: "", tipoOsId: "", dataAgendada: "", duracaoMin: "", observacao: "" });
  const [excluindo, setExcluindo] = useState<any | null>(null);
  const [processando, setProcessando] = useState(false);
  const [erroModal, setErroModal] = useState("");

  function abrirEdicao(a: any) {
    setErroModal("");
    setFormEdicao({
      titulo: a.titulo ?? "", tipoOsId: a.tipoOs?.id ?? a.tipoOsId ?? "",
      dataAgendada: paraInputLocal(a.dataAgendada), duracaoMin: a.duracaoMin ? String(a.duracaoMin) : "", observacao: a.observacao ?? "",
    });
    setTecnicosEdicao(valorDaAtividade(a));
    setEditando(a);
  }

  async function salvarEdicao() {
    if (!editando) return;
    if (!formEdicao.titulo.trim()) { setErroModal("O título é obrigatório."); return; }
    setProcessando(true); setErroModal("");
    try {
      const res = await fetch(`/api/ordens/${osId}/atividades/${editando.id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo: formEdicao.titulo.trim(),
          tipoOsId: formEdicao.tipoOsId,
          ...corpoTecnicos(tecnicosEdicao),
          dataAgendada: formEdicao.dataAgendada ? new Date(formEdicao.dataAgendada).toISOString() : "",
          duracaoMin: formEdicao.duracaoMin ? Number(formEdicao.duracaoMin) : null,
          observacao: formEdicao.observacao,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErroModal(data.erro ?? "Não foi possível salvar."); return; }
      setAtividades((p) => p.map((x) => (x.id === editando.id ? { ...x, ...data } : x)));
      setEditando(null);
    } catch { setErroModal("Erro de conexão."); } finally { setProcessando(false); }
  }

  async function confirmarExclusao() {
    if (!excluindo) return;
    setProcessando(true); setErroModal("");
    try {
      const res = await fetch(`/api/ordens/${osId}/atividades/${excluindo.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setErroModal(data.erro ?? "Não foi possível excluir."); return; }
      setAtividades((p) => p.filter((x) => x.id !== excluindo.id));
      setExcluindo(null);
    } catch { setErroModal("Erro de conexão."); } finally { setProcessando(false); }
  }

  useEffect(() => {
    fetch("/api/tipos-os").then((r) => r.json()).then(setTiposOs).catch(() => {});
    fetch("/api/tecnicos").then((r) => r.json()).then((d) => setTecnicos(Array.isArray(d) ? d : [])).catch(() => {})
      .finally(() => setCarregandoTecnicos(false));
    fetch("/api/equipes?resumo=1").then((r) => (r.ok ? r.json() : [])).then((d) => setEquipes(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  function toggleExpand(id: string) {
    setExpandido((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function criarAtividade() {
    setErroForm("");
    if (!form.titulo.trim()) { setErroForm("O título é obrigatório."); return; }
    setSalvando(true);
    try {
      const res = await fetch(`/api/ordens/${osId}/atividades`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, ...corpoTecnicos(tecnicosNova), duracaoMin: form.duracaoMin ? Number(form.duracaoMin) : undefined }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErroForm(d.erro ?? "Não foi possível adicionar a atividade."); return; }
      setAtividades((p) => [...p, d]);
      setForm({ titulo: "", tipoOsId: "", dataAgendada: "", duracaoMin: "", observacao: "" });
      setTecnicosNova(VALOR_TECNICOS_VAZIO);
      setMostraForm(false);
    } catch { setErroForm("Erro de conexão."); } finally { setSalvando(false); }
  }

  async function alterarStatusAtividade(atividadeId: string, novoStatus: string) {
    setErroStatus("");
    const res = await fetch(`/api/ordens/${osId}/atividades/${atividadeId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: novoStatus }),
    });
    if (res.ok) {
      const atualizada = await res.json();
      setAtividades((p) => p.map((a) => (a.id === atividadeId ? atualizada : a)));
    } else {
      const e = await res.json().catch(() => ({}));
      setErroStatus(e?.erro ?? "Não foi possível alterar o status da atividade.");
    }
  }

  return (
    <div className="space-y-3">
      {erroStatus && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 flex items-start gap-2">
          <X className="w-4 h-4 shrink-0 mt-0.5" /> {erroStatus}
        </div>
      )}
      {atividades.length === 0 && !mostraForm && (
        <p className="text-sm text-gray-400 text-center py-6">Nenhuma atividade cadastrada.</p>
      )}

      {atividades.map((a) => {
        const aberto = expandido.has(a.id);
        return (
          <div key={a.id} className="border border-gray-200 rounded-lg overflow-hidden">
            <button type="button" onClick={() => toggleExpand(a.id)} className="flex items-center justify-between w-full p-3 text-left hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3 min-w-0">
                <Wrench className="w-4 h-4 text-gray-400 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900">{a.titulo}</span>
                    {a.tipoOs && <span className="text-[10px] font-medium text-white px-1.5 py-0.5 rounded-full" style={{ backgroundColor: a.tipoOs.cor }}>{a.tipoOs.nome}</span>}
                    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", STATUS_COR[a.status])}>{STATUS_LABELS[a.status]}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-gray-400 mt-0.5">
                    <TecnicosAtividade a={a} />
                    {a.dataAgendada && <span>{formatarDataHora(a.dataAgendada)}</span>}
                    {a.duracaoMin && <span>{a.duracaoMin} min</span>}
                  </div>
                </div>
              </div>
              {aberto ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
            </button>

            {aberto && (
              <div className="border-t border-gray-100 p-3 space-y-3 bg-gray-50/50">
                {a.observacao && <p className="text-sm text-gray-600">{a.observacao}</p>}
                {a.resumo && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 mb-1">Resumo do formulário:</p>
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap bg-white rounded-lg p-3 border border-gray-100 font-sans">{a.resumo}</pre>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    {podeStatus && (
                      <Select value={a.status} onChange={(e) => alterarStatusAtividade(a.id, e.target.value)} className="text-xs w-auto py-1.5">
                        {Object.entries(STATUS_LABELS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                      </Select>
                    )}
                    {podeEditar && (
                      <button type="button" onClick={() => abrirEdicao(a)} title="Editar atividade"
                        className="p-2 rounded-md text-gray-500 hover:text-frivo-600 hover:bg-white">
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                    {podeExcluir && (
                      <button type="button" onClick={() => { setErroModal(""); setExcluindo(a); }} title="Excluir atividade"
                        className="p-2 rounded-md text-gray-500 hover:text-red-600 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <Link href={`/ordens/${osId}/atividades/${a.id}/executar`}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-frivo-600 hover:text-frivo-700 bg-frivo-50 hover:bg-frivo-100 px-2.5 py-1.5 rounded-lg">
                    <Smartphone className="w-3.5 h-3.5" /> Executar
                  </Link>
                </div>

                <div className="border-t border-gray-100 pt-3">
                  <AtividadeEquipamentos
                    osId={osId}
                    atividadeId={a.id}
                    clienteId={clienteId}
                    unidadeId={unidadeId}
                    temTipoOs={Boolean(a.tipoOs?.id ?? a.tipoOsId)}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {mostraForm && (
        <div className="border border-frivo-200 bg-frivo-50/30 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-frivo-800">Nova atividade</h4>
            <button type="button" onClick={() => setMostraForm(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <FormField label="Título" required>
            <Input value={form.titulo} onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))} placeholder="Descrição breve da atividade" />
          </FormField>
          <FormField label="Tipo de OS">
            <Select value={form.tipoOsId} onChange={(e) => setForm((f) => ({ ...f, tipoOsId: e.target.value }))} placeholder="Selecione">
              {tiposOs.filter((t) => t.ativo).map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
            </Select>
          </FormField>
          <FormField label="Técnicos / equipe">
            <SeletorTecnicos
              tecnicos={tecnicos} equipes={equipes} tipoOsId={form.tipoOsId} valor={tecnicosNova} onChange={setTecnicosNova}
              carregando={carregandoTecnicos} onTecnicoCriado={(t) => setTecnicos((l) => [...l, t])}
            />
          </FormField>
          <FormGrid>
            <FormField label="Data/hora agendada">
              <Input type="datetime-local" value={form.dataAgendada} onChange={(e) => setForm((f) => ({ ...f, dataAgendada: e.target.value }))} />
            </FormField>
            <FormField label="Duração estimada (min)">
              <Input type="number" value={form.duracaoMin} onChange={(e) => setForm((f) => ({ ...f, duracaoMin: e.target.value }))} placeholder="120" />
            </FormField>
          </FormGrid>
          <FormField label="Observação">
            <Textarea value={form.observacao} onChange={(e) => setForm((f) => ({ ...f, observacao: e.target.value }))} rows={2} />
          </FormField>
          {erroForm && <ErroModal texto={erroForm} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMostraForm(false)}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={criarAtividade}><Check className="w-4 h-4" /> Adicionar</Button>
          </div>
        </div>
      )}

      {!mostraForm && podeEditar && atividades.length < 20 && (
        <Button type="button" variant="secondary" onClick={() => setMostraForm(true)} className="w-full justify-center border-dashed">
          <Plus className="w-4 h-4" /> Nova atividade
        </Button>
      )}

      {/* ── Editar atividade ── */}
      <Modal aberto={!!editando} onFechar={() => setEditando(null)} titulo="Editar atividade">
        <div className="space-y-4">
          <FormField label="Título" required>
            <Input value={formEdicao.titulo} onChange={(e) => setFormEdicao((f) => ({ ...f, titulo: e.target.value }))} />
          </FormField>
          <FormGrid>
            <FormField label="Tipo de OS">
              <Select value={formEdicao.tipoOsId} onChange={(e) => setFormEdicao((f) => ({ ...f, tipoOsId: e.target.value }))} placeholder="Sem tipo">
                {tiposOs.filter((t) => t.ativo || t.id === formEdicao.tipoOsId).map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
              </Select>
            </FormField>
          </FormGrid>
          <FormField label="Técnicos / equipe">
            <SeletorTecnicos
              tecnicos={tecnicos} equipes={equipes} tipoOsId={formEdicao.tipoOsId} valor={tecnicosEdicao} onChange={setTecnicosEdicao}
              carregando={carregandoTecnicos} onTecnicoCriado={(t) => setTecnicos((l) => [...l, t])}
            />
          </FormField>
          <FormGrid>
            <FormField label="Data/hora agendada">
              <Input type="datetime-local" value={formEdicao.dataAgendada} onChange={(e) => setFormEdicao((f) => ({ ...f, dataAgendada: e.target.value }))} />
            </FormField>
            <FormField label="Duração estimada (min)">
              <Input type="number" value={formEdicao.duracaoMin} onChange={(e) => setFormEdicao((f) => ({ ...f, duracaoMin: e.target.value }))} />
            </FormField>
          </FormGrid>
          <FormField label="Observação">
            <Textarea value={formEdicao.observacao} onChange={(e) => setFormEdicao((f) => ({ ...f, observacao: e.target.value }))} rows={2} />
          </FormField>
          {erroModal && <ErroModal texto={erroModal} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button type="button" loading={processando} onClick={salvarEdicao}><Check className="w-4 h-4" /> Salvar</Button>
          </div>
        </div>
      </Modal>

      {/* ── Excluir atividade ── */}
      <Modal aberto={!!excluindo} onFechar={() => setExcluindo(null)} titulo="Excluir atividade?" tamanho="sm">
        <div className="space-y-4">
          <p className="text-sm text-ink">
            Tem certeza? A atividade <strong>{excluindo?.titulo}</strong> será removida da OS (fica registrado no histórico).
            Atividades que já têm execução registrada não podem ser excluídas — nesse caso, cancele a atividade.
          </p>
          {erroModal && <ErroModal texto={erroModal} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setExcluindo(null)}>Voltar</Button>
            <button type="button" onClick={confirmarExclusao} disabled={processando}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-60">
              {processando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} Sim, excluir
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/** "Equipe Alfa · João (resp.), Maria, Pedro" — responsável primeiro. */
function TecnicosAtividade({ a }: { a: any }) {
  const nomes: string[] = [a.tecnico?.nome, ...(a.tecnicosEquipe ?? []).map((t: any) => t.tecnico?.nome)].filter(Boolean);
  if (!nomes.length && !a.equipe) return null;
  return (
    <span className="flex items-center gap-1 min-w-0" data-tecnicos-atividade>
      {a.equipe
        ? <><Users className="w-3 h-3 shrink-0" /><span className="inline-flex items-center gap-1 font-medium text-gray-600"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: a.equipe.cor }} />{a.equipe.nome}</span><span>·</span></>
        : nomes.length > 1 ? <Users className="w-3 h-3 shrink-0" /> : <User className="w-3 h-3 shrink-0" />}
      <span className="truncate">{nomes.map((n, i) => (i === 0 && nomes.length > 1 ? `${n} (resp.)` : n)).join(", ") || "Sem técnico"}</span>
    </span>
  );
}

function ErroModal({ texto }: { texto: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{texto}</span>
    </div>
  );
}
