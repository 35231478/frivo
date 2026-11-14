"use client";

import { confirmar, toast } from "@/components/ui/avisos";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Dica } from "@/components/ui/dica";
import { Drawer } from "@/components/ui/drawer";
import { SelectCadastroRapido } from "@/components/ui/select-cadastro-rapido";
import { TIPO_OS } from "@/components/cadastro-rapido/definicoes";
import { TelaCadastroApoio } from "@/components/config/tela-cadastro-apoio";
import { SomenteLeitura, erroDaResposta, usePodeGerenciarConfig } from "@/components/config/permissao-config";
import { CampoBusca, ListaVazia, SkeletonLista } from "@/components/listagem/listagem-ui";
import { TabelaPro, type ColunaPro } from "@/components/listagem/tabela-pro";
import { PLANILHA } from "@/lib/planilha";
import { formatarData } from "@/lib/utils";
import {
  Plus, Pencil, Ban, Check, Trash2, ArrowUp,
  ListChecks, Link2, History, Loader2, ExternalLink, Boxes, Wrench, AlertTriangle,
} from "lucide-react";

const TIPOS_CAMPO = [
  { value: "TEXTO_CURTO", label: "Texto curto" },
  { value: "TEXTO_LONGO", label: "Texto longo" },
  { value: "NUMERO", label: "Número" },
  { value: "SIM_NAO", label: "Sim / Não" },
  { value: "MULTIPLA_ESCOLHA", label: "Múltipla escolha" },
  { value: "DATA", label: "Data" },
  { value: "FOTO", label: "Foto obrigatória" },
  { value: "ASSINATURA", label: "Assinatura" },
];

const AJUDA = "Formulários (checklists) respondidos pelo técnico na atividade da OS. O vínculo com o equipamento fica em Tipos de equipamento. Inativar tira o formulário das próximas OS; as respostas já dadas continuam no histórico.";

const COLUNAS: ColunaPro[] = [
  { id: "nome", titulo: "Nome", obrigatoria: true, minimo: 160 },
  { id: "tipoOs", titulo: "Tipo de OS", largura: 220 },
  { id: "campos", titulo: "Campos", largura: 90, alinhar: "direita" },
  { id: "acoes", titulo: "Ações", semTitulo: true, fixa: true, largura: 84, alinhar: "direita" },
];

interface Campo { id?: string; label: string; tipo: string; obrigatorio: boolean; ordem: number; opcoes?: any }
interface Formulario { id: string; nome: string; descricao?: string; tipoOsId?: string | null; campos: Campo[]; tipoOs?: { id: string; nome: string; cor: string } | null }
interface TipoOs { id: string; nome: string; cor: string; descricao?: string | null; ativo?: boolean }

const CAMPO_VAZIO = (ordem: number): Campo => ({ label: "", tipo: "TEXTO_CURTO", obrigatorio: false, ordem });

/**
 * Configurações › Formulários: os modelos de formulário (checklist) das atividades da OS, no padrão de
 * lista — busca, tabela no desktop e cartões no celular. Novo, Editar e Inativar só para quem tem
 * Configurações › Gerenciar (o servidor recusa de qualquer jeito); sem ela, a tela é só leitura.
 * Toda gravação avisa (toast) e nenhuma falha fica em silêncio.
 */
export function TelaFormularios() {
  const podeGerenciar = usePodeGerenciarConfig();
  const [formularios, setFormularios] = useState<Formulario[] | null>(null);
  const [tiposOs, setTiposOs] = useState<TipoOs[]>([]);
  const [editando, setEditando] = useState<string | "novo" | null>(null);
  const [abaForm, setAbaForm] = useState<"campos" | "vinculos" | "historico">("campos");
  const [form, setForm] = useState({ nome: "", descricao: "", tipoOsId: "" });
  const [campos, setCampos] = useState<Campo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    fetch("/api/formularios").then((r) => (r.ok ? r.json() : [])).then((d) => setFormularios(Array.isArray(d) ? d : [])).catch(() => setFormularios([]));
    fetch("/api/tipos-os").then((r) => (r.ok ? r.json() : [])).then((d) => setTiposOs(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  function abrirNovo() {
    setForm({ nome: "", descricao: "", tipoOsId: "" });
    setCampos([CAMPO_VAZIO(1)]);
    setEditando("novo");
    setAbaForm("campos");
    setErro("");
  }

  function abrir(f: Formulario) {
    setForm({ nome: f.nome, descricao: f.descricao ?? "", tipoOsId: f.tipoOsId ?? "" });
    setCampos(f.campos.length > 0 ? f.campos : [CAMPO_VAZIO(1)]);
    setEditando(f.id);
    setAbaForm("campos");
    setErro("");
  }

  const addCampo = () => setCampos((p) => [...p, CAMPO_VAZIO(p.length + 1)]);
  const removeCampo = (idx: number) => setCampos((p) => p.filter((_, i) => i !== idx).map((c, i) => ({ ...c, ordem: i + 1 })));
  const updateCampo = (idx: number, field: string, value: any) => setCampos((p) => p.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
  const subirCampo = (idx: number) => setCampos((p) => {
    if (idx === 0) return p;
    const n = [...p]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
    return n.map((c, i) => ({ ...c, ordem: i + 1 }));
  });

  async function salvar() {
    if (!form.nome.trim()) { setErro("Informe o nome do formulário."); return; }
    const camposValidos = campos.filter((c) => c.label.trim());
    if (camposValidos.length === 0) { setErro("Adicione pelo menos um campo."); return; }

    setSalvando(true); setErro("");
    const payload = {
      ...form,
      tipoOsId: form.tipoOsId || null,
      // id dos campos existentes: o servidor atualiza no lugar (removido vira inativo, não é apagado)
      campos: camposValidos.map((c, i) => ({ id: c.id, label: c.label, tipo: c.tipo, obrigatorio: c.obrigatorio, ordem: i + 1, opcoes: c.opcoes })),
    };

    try {
      const novo = editando === "novo";
      const res = await fetch(novo ? "/api/formularios" : `/api/formularios/${editando}`, {
        method: novo ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (!res.ok) { setErro(await erroDaResposta(res, novo ? "Não foi possível criar o formulário." : "Não foi possível salvar o formulário.")); return; }
      const salvo: Formulario = await res.json();
      setFormularios((p) => (novo ? [...(p ?? []), salvo] : (p ?? []).map((f) => (f.id === salvo.id ? salvo : f))).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
      setEditando(null);
      toast(novo ? "Formulário criado." : "Formulário salvo.");
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  async function inativar(f: Formulario) {
    // O impacto antes de decidir: em quantas combinações de equipamento e tipo de OS ele é usado
    const vinculos = await fetch(`/api/formularios/${f.id}/vinculos`).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    const n = Array.isArray(vinculos) ? vinculos.length : 0;
    const uso = n === 0 ? "Não está vinculado a nenhum equipamento." : `Em uso em ${n} ${n === 1 ? "combinação" : "combinações"} de equipamento e tipo de OS.`;
    if (!(await confirmar({
      titulo: `Inativar o formulário "${f.nome}"?`,
      mensagem: `${uso} Ele deixa de aparecer nas próximas OS; as respostas já dadas continuam no histórico.`,
      perigo: true, confirmarTexto: "Inativar",
    }))) return;
    try {
      const res = await fetch(`/api/formularios/${f.id}`, { method: "DELETE" });
      if (!res.ok) { toast(await erroDaResposta(res, "Não foi possível inativar o formulário."), "erro"); return; }
      setFormularios((p) => (p ?? []).filter((x) => x.id !== f.id));
      toast("Formulário inativado.");
    } catch { toast("Sem conexão. Tente de novo.", "erro"); }
  }

  const q = busca.trim().toLowerCase();
  const filtrados = useMemo(() => (q ? (formularios ?? []).filter((f) => f.nome.toLowerCase().includes(q)) : formularios ?? []), [formularios, q]);

  const chipTipo = (f: Formulario) => f.tipoOs
    ? <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted bg-surface-page border border-surface-border px-2 py-0.5 rounded-full max-w-full"><span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: f.tipoOs.cor }} aria-hidden /><span className="truncate">{f.tipoOs.nome}</span></span>
    : <span className="text-ink-subtle">Genérico</span>;

  const acoes = (f: Formulario) => (
    <span className="inline-flex items-center justify-end gap-0.5" data-acoes-formulario>
      <button type="button" onClick={() => abrir(f)} aria-label={`${podeGerenciar ? "Editar" : "Ver"} ${f.nome}`} title={podeGerenciar ? "Editar" : "Ver"} data-abrir-formulario={f.id}
        className="p-1.5 text-ink-muted hover:text-primary-600 hover:bg-primary-50 rounded transition-colors">
        {podeGerenciar ? <Pencil className="w-4 h-4" aria-hidden /> : <ListChecks className="w-4 h-4" aria-hidden />}
      </button>
      {podeGerenciar && (
        <button type="button" onClick={() => void inativar(f)} aria-label={`Inativar ${f.nome}`} title="Inativar" data-inativar-formulario={f.id}
          className="p-1.5 text-ink-muted hover:text-atrasado hover:bg-atrasado-claro rounded transition-colors">
          <Ban className="w-4 h-4" aria-hidden />
        </button>
      )}
    </span>
  );

  const somenteLeitura = !podeGerenciar;
  const tituloGaveta = editando === "novo" ? "Novo formulário" : (form.nome || (podeGerenciar ? "Editar formulário" : "Formulário"));

  return (
    <TelaCadastroApoio titulo="Formulários" descricao="Modelos de formulário das atividades da OS">
      <div className="space-y-4" data-formularios>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-[12rem] max-w-sm">
            <CampoBusca valor={busca} onChange={setBusca} placeholder="Pesquisar formulário" rotulo="Pesquisar formulário" atalho={false} />
          </div>
          <Dica texto={AJUDA} rotulo="Formulários" />
          {podeGerenciar && (
            <Button type="button" onClick={abrirNovo} className="ml-auto shrink-0" data-novo-formulario>
              <Plus className="w-4 h-4" aria-hidden /> Novo formulário
            </Button>
          )}
        </div>

        {formularios === null ? (
          <div className="border border-surface-border rounded-lg"><SkeletonLista linhas={4} /></div>
        ) : filtrados.length === 0 ? (
          <div className="border border-surface-border rounded-lg">
            <ListaVazia mensagem={q ? "Nenhum formulário encontrado" : "Nenhum formulário cadastrado"} busca={q ? busca.trim() : undefined} onLimpar={() => setBusca("")} />
          </div>
        ) : (
          <>
            {/* Celular: cada registro vira um cartão */}
            <ul className="sm:hidden space-y-2" data-cartoes>
                {filtrados.map((f) => (
                  <li key={f.id} data-cartao={f.id} className="border border-surface-border rounded-lg bg-white p-3 flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink break-words">{f.nome}</p>
                      <dl className="mt-1.5 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs">
                        <dt className="text-ink-subtle">Tipo de OS</dt><dd className="min-w-0">{chipTipo(f)}</dd>
                        <dt className="text-ink-subtle">Campos</dt><dd className="text-ink tabular-nums">{f.campos.length}</dd>
                      </dl>
                    </div>
                    <div className="shrink-0">{acoes(f)}</div>
                  </li>
                ))}
              </ul>
            <TabelaPro
            tela="config-formularios" quebra="sm" className="hidden sm:block border border-surface-border rounded-lg overflow-hidden" colunas={COLUNAS} atributos={{ "data-tabela-formularios": true }}
            barra={<span className="text-xs text-ink-muted" data-total-formularios>{filtrados.length} {filtrados.length === 1 ? "formulário" : "formulários"}</span>}
            linhas={filtrados.map((f) => ({
              id: f.id, atributos: { "data-formulario": f.id }, titulos: { nome: f.nome },
              celulas: { nome: <span className={PLANILHA.nome}>{f.nome}</span>, tipoOs: chipTipo(f), campos: <span className="tabular-nums">{f.campos.length}</span>, acoes: acoes(f) },
            }))}
            />
          </>
        )}

        {somenteLeitura && <SomenteLeitura />}
      </div>

      {/* Gaveta de cadastro/edição (sem a permissão: só leitura, sem Salvar) */}
      <Drawer
        aberto={!!editando}
        onFechar={() => setEditando(null)}
        titulo={tituloGaveta}
        abas={editando && editando !== "novo" ? [
          { id: "campos", label: "Campos", icone: ListChecks },
          { id: "vinculos", label: "Vínculos", icone: Link2 },
          { id: "historico", label: "Histórico", icone: History },
        ] : undefined}
        abaAtiva={abaForm}
        onAbaChange={(id) => setAbaForm(id as "campos" | "vinculos" | "historico")}
        rodape={abaForm === "campos" && podeGerenciar ? (
          <>
            <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={salvar} data-salvar-formulario><Check className="w-4 h-4" aria-hidden /> Salvar</Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setEditando(null)}>Fechar</Button>
        )}
      >
        {abaForm === "vinculos" && editando && editando !== "novo" ? (
          <FormularioVinculos formId={editando} />
        ) : abaForm === "historico" && editando && editando !== "novo" ? (
          <FormularioHistorico formId={editando} />
        ) : (
          <div className="space-y-4" data-form-formulario>
            {erro && <div role="alert" className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-3 py-2" data-erro-formulario>{erro}</div>}
            {somenteLeitura && <SomenteLeitura />}
            <fieldset disabled={somenteLeitura} className="space-y-4 min-w-0">
              <FormGrid>
                <FormField label="Nome" required>
                  <Input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} placeholder="Ex.: Checklist de manutenção preventiva" data-nome-formulario />
                </FormField>
                <FormField label="Tipo de OS vinculado" dica="Em branco, o formulário é genérico: vale para qualquer tipo de OS.">
                  {/* Tipo novo nasce aqui mesmo, e o escolhido é corrigido sem sair do formulário (referência) */}
                  <SelectCadastroRapido
                    value={form.tipoOsId} onChange={(v) => setForm((f) => ({ ...f, tipoOsId: v }))} disabled={somenteLeitura}
                    opcoes={tiposOs.filter((t) => t.ativo !== false || t.id === form.tipoOsId).map((t) => ({ value: t.id, label: t.nome }))}
                    entidade={TIPO_OS.entidade} placeholder="Nenhum (genérico)"
                    campos={TIPO_OS.campos} campoBusca="nome" permissao={TIPO_OS.permissao} linkCadastroCompleto={TIPO_OS.link}
                    criar={async (v) => {
                      const t = await TIPO_OS.criar(v);
                      setTiposOs((l) => [...l, { id: t.id, nome: t.nome, cor: t.cor ?? "", ativo: true }]);
                      return { value: t.id, label: t.nome };
                    }}
                    edicao={TIPO_OS.edicao(tiposOs, (t) => setTiposOs((l) => l.map((x) => (x.id === t.id ? { ...x, ...t } : x))))}
                  />
                </FormField>
              </FormGrid>
              <FormField label="Descrição">
                <Textarea value={form.descricao} onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} rows={2} />
              </FormField>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-ink-muted uppercase flex items-center gap-1">Campos do formulário
                  <Dica texto="A ordem daqui é a ordem em que o técnico responde. Campo removido sai das próximas OS e continua nas respostas antigas." rotulo="Campos do formulário" />
                </p>
                {campos.map((c, i) => (
                  <div key={i} className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-white border border-surface-border rounded-lg p-2" data-campo-formulario>
                    <span className="text-xs text-ink-muted w-4 shrink-0 tabular-nums">{i + 1}</span>
                    <Input value={c.label} onChange={(e) => updateCampo(i, "label", e.target.value)} placeholder="Nome do campo" aria-label={`Nome do campo ${i + 1}`} className="flex-1 min-w-[9rem] text-sm h-8" />
                    <select value={c.tipo} onChange={(e) => updateCampo(i, "tipo", e.target.value)} aria-label={`Tipo do campo ${i + 1}`}
                      className="border border-surface-border rounded px-2 py-1 text-xs bg-white w-36 disabled:bg-surface-alt">
                      {TIPOS_CAMPO.map((t) => (<option key={t.value} value={t.value}>{t.label}</option>))}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-ink-muted whitespace-nowrap">
                      <input type="checkbox" checked={c.obrigatorio} onChange={(e) => updateCampo(i, "obrigatorio", e.target.checked)} className="accent-frivo-600" />
                      Obrigatório
                    </label>
                    {podeGerenciar && (
                      <span className="inline-flex items-center ml-auto sm:ml-0">
                        <button type="button" onClick={() => subirCampo(i)} disabled={i === 0} aria-label={`Subir o campo ${i + 1}`} title="Subir" className="p-1 text-ink-muted hover:text-ink disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" aria-hidden /></button>
                        <button type="button" onClick={() => removeCampo(i)} aria-label={`Excluir o campo ${i + 1}`} title="Excluir" className="p-1 text-ink-muted hover:text-atrasado"><Trash2 className="w-3.5 h-3.5" aria-hidden /></button>
                      </span>
                    )}
                  </div>
                ))}
                {podeGerenciar && (
                  <Button type="button" variant="ghost" onClick={addCampo} className="text-xs h-7 px-2.5" data-adicionar-campo>
                    <Plus className="w-3 h-3" aria-hidden /> Adicionar campo
                  </Button>
                )}
              </div>
            </fieldset>
          </div>
        )}
      </Drawer>
    </TelaCadastroApoio>
  );
}

// ─────────────────────────────────────────────
// Aba Vínculos — onde este formulário é usado (somente leitura)
// ─────────────────────────────────────────────
interface Vinculo {
  id: string;
  tipoEquipamento: { id: string; nome: string };
  tipoOs: { id: string; nome: string; cor: string };
  obrigatorioConcluir: boolean;
  obrigatorioImpedimento: boolean;
}

function FormularioVinculos({ formId }: { formId: string }) {
  const [vinculos, setVinculos] = useState<Vinculo[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    setVinculos(null);
    fetch(`/api/formularios/${formId}/vinculos`)
      .then((r) => r.json())
      .then((d) => { if (!cancelado) setVinculos(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelado) setVinculos([]); });
    return () => { cancelado = true; };
  }, [formId]);

  if (vinculos === null) return <div className="flex items-center gap-2 text-sm text-ink-muted py-3"><Loader2 className="w-4 h-4 animate-spin" /> Carregando vínculos…</div>;
  if (vinculos.length === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-surface-border rounded-card">
        <Boxes className="w-6 h-6 text-ink-subtle mx-auto mb-2" />
        <p className="text-sm text-ink-muted">Este formulário ainda não está vinculado a nenhum equipamento.</p>
      </div>
    );
  }
  return (
    <div className="space-y-2" data-vinculos-formulario>
      <p className="text-xs font-semibold text-ink-muted uppercase flex items-center gap-1">Onde é usado
        <Dica texto="Combinações de tipo de equipamento e tipo de OS que pedem este formulário. O vínculo é feito em Tipos de equipamento." rotulo="Onde é usado" />
      </p>
      {vinculos.map((v) => (
        <div key={v.id} className="flex items-center justify-between gap-3 border border-surface-border rounded-lg p-2.5 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-wrap text-sm">
            <span className="inline-flex items-center gap-1.5 text-ink"><Boxes className="w-3.5 h-3.5 text-ink-subtle" /> {v.tipoEquipamento.nome}</span>
            <span className="text-ink-subtle">·</span>
            <span className="inline-flex items-center gap-1"><Wrench className="w-3.5 h-3.5 text-ink-subtle" /></span>
            <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted bg-surface-page border border-surface-border px-1.5 py-0.5 rounded-full"><span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: v.tipoOs.cor }} aria-hidden />{v.tipoOs.nome}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {v.obrigatorioConcluir && <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-success-50 text-success-700 px-2 py-0.5 rounded-full"><Check className="w-3 h-3" /> Concluir</span>}
            {v.obrigatorioImpedimento && <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-atencao-claro text-atencao-texto px-2 py-0.5 rounded-full"><AlertTriangle className="w-3 h-3" /> Impedimento</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Aba Histórico — respostas registradas deste formulário
// ─────────────────────────────────────────────
interface RespostaSessao {
  ordemId: string; ordemNumero: string; equipamentoNome: string;
  tecnicoNome: string | null; respondidoEm: string;
}

function FormularioHistorico({ formId }: { formId: string }) {
  const [sessoes, setSessoes] = useState<RespostaSessao[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    setSessoes(null);
    fetch(`/api/formularios/${formId}/historico`)
      .then((r) => r.json())
      .then((d) => { if (!cancelado) setSessoes(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelado) setSessoes([]); });
    return () => { cancelado = true; };
  }, [formId]);

  if (sessoes === null) return <div className="flex items-center gap-2 text-sm text-ink-muted py-3"><Loader2 className="w-4 h-4 animate-spin" /> Carregando histórico…</div>;
  if (sessoes.length === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-surface-border rounded-card">
        <History className="w-6 h-6 text-ink-subtle mx-auto mb-2" />
        <p className="text-sm text-ink-muted">Nenhuma resposta registrada ainda.</p>
      </div>
    );
  }
  // Lista (não tabela): cabe na gaveta e no celular sem rolar para o lado
  return (
    <ul className="border border-surface-border rounded-lg divide-y divide-surface-border" data-historico-formulario>
      {sessoes.map((s, i) => (
        <li key={i} className="px-3 py-2 flex items-start justify-between gap-3 text-sm">
          <div className="min-w-0">
            <Link href={`/ordens/${s.ordemId}`} className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 font-medium">
              {s.ordemNumero} <ExternalLink className="w-3 h-3" aria-hidden />
            </Link>
            <p className="text-ink truncate">{s.equipamentoNome}</p>
            <p className="text-xs text-ink-muted">{s.tecnicoNome ?? "Sem técnico"}</p>
          </div>
          <span className="text-xs text-ink-muted shrink-0 tabular-nums">{formatarData(s.respondidoEm)}</span>
        </li>
      ))}
    </ul>
  );
}
