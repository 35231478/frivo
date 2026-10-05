"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileBadge, ClipboardList, Thermometer, CalendarRange, ListChecks, AlertOctagon, Lightbulb, Paperclip,
  ChevronLeft, Save, Loader2, AlertTriangle, CheckCircle2, Upload, FileText, Trash2, Send, Undo2, Plus, X, Info,
} from "lucide-react";
import { cn, LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid, FormSection } from "@/components/ui/form-field";
import { SelectCadastroRapido, type OpcaoCadastro } from "@/components/ui/select-cadastro-rapido";
import { CLIENTE, UNIDADE } from "@/components/cadastro-rapido/definicoes";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { PmocStatusSelo } from "@/components/pmoc/pmoc-status-selo";
import { PmocCopiarBotao } from "@/components/pmoc/pmoc-copiar-botao";
import { DESCRICAO_PADRAO_PMOC, TAMANHO_MAX_ART, TIPOS_ART, hojeISO, pendenciasPublicacao, serializarPmoc } from "@/lib/pmoc";

const serializar = (d: any) => serializarPmoc<PmocDados>(d);

/* ───────── Tipos (dados serializados pela página) ───────── */
export interface EquipamentoPmoc {
  id: string; nome: string | null; marca: string; modelo: string; patrimonio: string | null; tipo: string;
  capacidade: string | null; setor: string | null; localizacao: string | null; ativo: boolean; unidadeId: string;
  tipoEquipamento?: { nome: string } | null; unidade?: { nome: string } | null;
}
export interface PmocDados {
  id: string; nome: string; descricao: string | null; clienteId: string; unidadeId: string; dataInicio: string; dataExpiracao: string;
  status: "RASCUNHO" | "PUBLICADO"; responsavelTecnicoId: string | null; rtNome: string | null; rtCrea: string | null;
  artNumero: string | null; artArquivoNome: string | null; artArquivoTipo: string | null; artArquivoTamanho: number | null; ativo: boolean;
  cliente: { id: string; nome: string; nomeFantasia: string | null };
  unidade: { id: string; nome: string; cidade: string | null; estado: string | null };
  equipamentos: { id: string; equipamento: EquipamentoPmoc }[];
}

type Aba = "identificacao" | "equipamentos";
const ABAS_FUTURAS = [
  { rotulo: "Cronograma", icone: CalendarRange },
  { rotulo: "Planejamento", icone: ListChecks },
  { rotulo: "Ocorrências", icone: AlertOctagon },
  { rotulo: "Recomendações", icone: Lightbulb },
  { rotulo: "Anexos", icone: Paperclip },
];

function umAnoDepois(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const rotuloEquip = (e: EquipamentoPmoc) => e.nome || `${e.marca} ${e.modelo}`.trim();
const tipoEquip = (e: EquipamentoPmoc) => e.tipoEquipamento?.nome ?? LABELS_TIPO_EQUIPAMENTO[e.tipo] ?? e.tipo;
const localEquip = (e: EquipamentoPmoc) => [e.setor, e.localizacao].filter(Boolean).join(" › ") || "—";
function lerArquivo(file: File): Promise<string> {
  return new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = erro; r.readAsDataURL(file); });
}

export function PmocEditor({ inicial, abaInicial, copiaRecente, criadoRecente }: { inicial?: PmocDados; abaInicial?: string; copiaRecente?: boolean; criadoRecente?: boolean }) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const novo = !inicial;
  const [pmoc, setPmoc] = useState<PmocDados | undefined>(inicial);
  const somenteLeitura = novo ? !pode("pmoc", "criar") : !pode("pmoc", "editar") || !pmoc!.ativo;
  const [aba, setAba] = useState<Aba>(abaInicial === "equipamentos" && !novo ? "equipamentos" : "identificacao");

  const hoje = hojeISO();
  const [form, setForm] = useState(() => ({
    nome: inicial?.nome ?? "",
    descricao: inicial ? (inicial.descricao ?? "") : DESCRICAO_PADRAO_PMOC,
    clienteId: inicial?.clienteId ?? "",
    unidadeId: inicial?.unidadeId ?? "",
    dataInicio: inicial?.dataInicio ?? hoje,
    dataExpiracao: inicial?.dataExpiracao ?? umAnoDepois(hoje),
    responsavelTecnicoId: inicial?.responsavelTecnicoId ?? "",
    rtNome: inicial?.rtNome ?? "",
    rtCrea: inicial?.rtCrea ?? "",
    artNumero: inicial?.artNumero ?? "",
  }));
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const [artNova, setArtNova] = useState<{ dataUrl: string; nome: string } | null>(null);
  const [removerArt, setRemoverArt] = useState(false);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(
    copiaRecente ? { tipo: "ok", texto: "Cópia criada como Rascunho. A ART não é copiada: informe a ART deste novo plano." }
    : criadoRecente ? { tipo: "ok", texto: "PMOC criado como Rascunho. Agora adicione os equipamentos cobertos e publique." } : null);

  // Clientes / unidades / RTs
  const [clientes, setClientes] = useState<OpcaoCadastro[]>(inicial ? [CLIENTE.opcao(inicial.cliente)] : []);
  const [carregandoClientes, setCarregandoClientes] = useState(true);
  const [unidades, setUnidades] = useState<any[]>(inicial ? [{ ...inicial.unidade, clienteId: inicial.clienteId }] : []);
  const [carregandoUnidades, setCarregandoUnidades] = useState(false);
  const [rts, setRts] = useState<{ id: string; nome: string; crea: string | null }[]>([]);
  const inputArt = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/clientes").then((r) => (r.ok ? r.json() : [])).then((l) => {
      if (Array.isArray(l) && l.length) setClientes(l.map(CLIENTE.opcao));
    }).catch(() => {}).finally(() => setCarregandoClientes(false));
    fetch("/api/tecnicos?tipo=RESPONSAVEL_TECNICO").then((r) => (r.ok ? r.json() : [])).then((l) => setRts(Array.isArray(l) ? l : [])).catch(() => {});
  }, []);
  useEffect(() => {
    if (!form.clienteId) { setUnidades([]); return; }
    setCarregandoUnidades(true);
    fetch(`/api/unidades?clienteId=${form.clienteId}`).then((r) => (r.ok ? r.json() : [])).then((l) => {
      const lista = Array.isArray(l) ? l : [];
      if (lista.length) setUnidades(lista);
      if (lista.length === 1 && !form.unidadeId) set("unidadeId", lista[0].id);
    }).catch(() => {}).finally(() => setCarregandoUnidades(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.clienteId]);

  async function escolherArt(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!(TIPOS_ART as readonly string[]).includes(f.type)) { setMsg({ tipo: "erro", texto: "A ART deve ser PDF, JPG ou PNG." }); return; }
    if (f.size > TAMANHO_MAX_ART) { setMsg({ tipo: "erro", texto: "Arquivo da ART acima de 5 MB." }); return; }
    setArtNova({ dataUrl: await lerArquivo(f), nome: f.name }); setRemoverArt(false); setMsg(null);
  }

  async function salvar(statusDesejado?: "RASCUNHO" | "PUBLICADO") {
    setMsg(null);
    const status = statusDesejado ?? pmoc?.status ?? "RASCUNHO";
    if (status === "PUBLICADO") {
      const faltam = pendenciasPublicacao(form, pmoc?.equipamentos.length ?? 0);
      if (faltam.length) { setMsg({ tipo: "erro", texto: `Para publicar, falta: ${faltam.join(", ")}.` }); return; }
    }
    setSalvando(statusDesejado ?? "salvar");
    try {
      const body = {
        ...form, status, responsavelTecnicoId: form.responsavelTecnicoId || null,
        ...(artNova ? { artArquivo: artNova.dataUrl, artArquivoNome: artNova.nome } : {}),
        ...(removerArt ? { removerArt: true } : {}),
      };
      const res = await fetch(novo ? "/api/pmocs" : `/api/pmocs/${pmoc!.id}`, {
        method: novo ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tipo: "erro", texto: d.erro ?? "Não foi possível salvar." }); return; }
      if (novo) { router.push(`/pmoc/${d.id}?aba=equipamentos&criado=1`); return; }
      setPmoc(serializar(d)); setArtNova(null); setRemoverArt(false);
      setMsg({ tipo: "ok", texto: statusDesejado === "PUBLICADO" ? "PMOC publicado." : statusDesejado === "RASCUNHO" ? "PMOC voltou para Rascunho." : "Alterações salvas." });
      router.refresh();
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão." }); } finally { setSalvando(null); }
  }

  const titulo = novo ? "Novo PMOC" : pmoc!.nome;
  const temArt = !removerArt && (artNova || pmoc?.artArquivoNome);

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-2 min-w-0">
          <Link href="/pmoc" className="mt-1 p-2 rounded-lg text-ink-muted hover:bg-surface-alt" aria-label="Voltar"><ChevronLeft className="w-5 h-5" /></Link>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2 flex-wrap">
              <FileBadge className="w-5 h-5 text-primary-500 shrink-0" /> <span className="truncate">{titulo}</span>
              {pmoc && <PmocStatusSelo pmoc={pmoc} detalhe />}
            </h1>
            {pmoc && <p className="text-sm text-ink-muted">{pmoc.cliente.nomeFantasia ?? pmoc.cliente.nome} · {pmoc.unidade.nome}</p>}
          </div>
        </div>
        {pmoc && (
          <div className="flex items-center gap-2 flex-wrap">
            {!somenteLeitura && pmoc.status === "RASCUNHO" && (
              <button type="button" onClick={() => salvar("PUBLICADO")} disabled={!!salvando}
                className="inline-flex items-center gap-1.5 text-sm rounded-lg px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-60">
                {salvando === "PUBLICADO" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Publicar
              </button>
            )}
            {!somenteLeitura && pmoc.status === "PUBLICADO" && (
              <button type="button" onClick={() => salvar("RASCUNHO")} disabled={!!salvando}
                className="inline-flex items-center gap-1.5 text-sm border border-surface-border rounded-lg px-3 py-2 bg-white text-ink hover:bg-surface-alt disabled:opacity-60">
                <Undo2 className="w-4 h-4" /> Voltar para rascunho
              </button>
            )}
            <PmocCopiarBotao id={pmoc.id} variante="botao" />
            <InativarRegistro url={`/api/pmocs/${pmoc.id}`} modulo="pmoc" acaoReativar="editar" variante="botao" ativo={pmoc.ativo} nome={pmoc.nome} entidade="PMOC" comMotivo={false}
              aoConcluir={(ativo) => { setPmoc((p) => (p ? { ...p, ativo } : p)); router.refresh(); }} />
          </div>
        )}
      </div>

      {pmoc && !pmoc.ativo && (
        <div data-aviso-inativo className="bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-4 py-3 text-sm">
          Este PMOC está <strong>inativo</strong> e não aparece na lista padrão. Use “Reativar” para voltar a editá-lo.
        </div>
      )}
      {msg && (
        <div data-msg={msg.tipo} className={cn("flex items-start gap-2 text-sm rounded-lg px-3 py-2 border", msg.tipo === "ok" ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-red-700 bg-red-50 border-red-200")}>
          {msg.tipo === "ok" ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />} <span>{msg.texto}</span>
        </div>
      )}

      {/* Abas */}
      <div className="flex gap-1 overflow-x-auto border-b border-surface-border -mx-1 px-1" role="tablist">
        {([["identificacao", "Identificação", ClipboardList], ["equipamentos", "Equipamentos AVAC", Thermometer]] as const).map(([id, rotulo, Icone]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} disabled={novo && id === "equipamentos"} onClick={() => setAba(id)}
            title={novo && id === "equipamentos" ? "Salve a identificação primeiro" : undefined}
            className={cn("flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors disabled:opacity-40",
              aba === id ? "border-primary-500 text-primary-600" : "border-transparent text-ink-muted hover:text-ink")}>
            <Icone className="w-4 h-4" /> {rotulo}
            {id === "equipamentos" && pmoc && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-alt">{pmoc.equipamentos.length}</span>}
          </button>
        ))}
        {ABAS_FUTURAS.map(({ rotulo, icone: Icone }) => (
          <button key={rotulo} type="button" disabled data-aba-futura title="Próxima etapa do módulo PMOC"
            className="flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 border-transparent -mb-px text-ink-subtle cursor-not-allowed">
            <Icone className="w-4 h-4" /> {rotulo} <span className="text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">em breve</span>
          </button>
        ))}
      </div>

      {/* ── Identificação ── */}
      {aba === "identificacao" && (
        <fieldset disabled={somenteLeitura} className="bg-white border border-surface-border rounded-xl p-4 sm:p-6 space-y-6">
          <FormSection title="Dados gerais">
            <FormField label="Nome do PMOC" required>
              <Input aria-label="Nome do PMOC" value={form.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Ex: PMOC 2026 — Hospital Santa Clara (Matriz)" />
            </FormField>
            <FormGrid>
              <FormField label="Cliente" required>
                <SelectCadastroRapido
                  value={form.clienteId}
                  onChange={(v) => { if (v !== form.clienteId) setForm((f) => ({ ...f, clienteId: v, unidadeId: "" })); }}
                  opcoes={clientes} entidade={CLIENTE.entidade} placeholder="Selecione o cliente" carregando={carregandoClientes}
                  campos={CLIENTE.campos} valoresIniciais={CLIENTE.valoresIniciais} campoBusca="nome" permissao={CLIENTE.permissao}
                  linkCadastroCompleto={CLIENTE.link} disabled={somenteLeitura}
                  criar={async (v) => { const c = await CLIENTE.criar(v); setClientes((l) => [...l, CLIENTE.opcao(c)]); return CLIENTE.opcao(c); }}
                />
              </FormField>
              <FormField label="Unidade / local" required>
                <SelectCadastroRapido
                  value={form.unidadeId} onChange={(v) => set("unidadeId", v)} opcoes={unidades.map(UNIDADE.opcao)} entidade={UNIDADE.entidade}
                  contexto="para este cliente" placeholder="Selecione o endereço" disabled={!form.clienteId || somenteLeitura}
                  textoDesabilitado={form.clienteId ? undefined : "Selecione um cliente primeiro"} carregando={carregandoUnidades}
                  campos={UNIDADE.campos} campoBusca="nome" permissao={UNIDADE.permissao}
                  linkCadastroCompleto={form.clienteId ? UNIDADE.link(form.clienteId) : undefined}
                  criar={async (v) => { const u = await UNIDADE.criar(form.clienteId, v, unidades.length === 0); setUnidades((l) => [...l, u]); return UNIDADE.opcao(u); }}
                />
              </FormField>
            </FormGrid>
            <FormGrid>
              <FormField label="Data de início" required>
                <Input type="date" aria-label="Data de início" value={form.dataInicio} onChange={(e) => set("dataInicio", e.target.value)} />
              </FormField>
              <FormField label="Data de expiração" required hint="Vigente até este dia; depois vira Expirado automaticamente">
                <Input type="date" aria-label="Data de expiração" value={form.dataExpiracao} onChange={(e) => set("dataExpiracao", e.target.value)} />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Responsável Técnico e ART">
            {rts.length > 0 && !somenteLeitura && (
              <FormField label="Preencher com um responsável técnico cadastrado" hint="Opcional — copia nome e CREA do cadastro de colaboradores">
                <select aria-label="Responsável técnico cadastrado" value={form.responsavelTecnicoId}
                  onChange={(e) => {
                    const rt = rts.find((r) => r.id === e.target.value);
                    setForm((f) => ({ ...f, responsavelTecnicoId: e.target.value, ...(rt ? { rtNome: rt.nome, rtCrea: rt.crea ?? f.rtCrea } : {}) }));
                  }}
                  className="w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500">
                  <option value="">— Digitar manualmente —</option>
                  {rts.map((r) => <option key={r.id} value={r.id}>{r.nome}{r.crea ? ` (CREA ${r.crea})` : ""}</option>)}
                </select>
              </FormField>
            )}
            <FormGrid>
              <FormField label="Nome do Responsável Técnico">
                <Input aria-label="Nome do Responsável Técnico" value={form.rtNome} onChange={(e) => set("rtNome", e.target.value)} placeholder="Engenheiro(a) responsável" />
              </FormField>
              <FormField label="Registro CREA">
                <Input aria-label="Registro CREA" value={form.rtCrea} onChange={(e) => set("rtCrea", e.target.value)} placeholder="Ex: SP-5061234567" />
              </FormField>
            </FormGrid>
            <FormGrid>
              <FormField label="Número da ART">
                <Input aria-label="Número da ART" value={form.artNumero} onChange={(e) => set("artNumero", e.target.value)} placeholder="Ex: 28027230241234567" />
              </FormField>
              <FormField label="Arquivo da ART" hint="PDF, JPG ou PNG até 5 MB">
                <input ref={inputArt} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={escolherArt} aria-label="Arquivo da ART" />
                {temArt ? (
                  <div className="flex items-center gap-2 border border-surface-border rounded-lg px-3 py-2 text-sm" data-art-arquivo>
                    <FileText className="w-4 h-4 text-primary-600 shrink-0" />
                    {artNova || !pmoc ? <span className="truncate flex-1">{artNova?.nome}</span> : (
                      <a href={`/api/pmocs/${pmoc.id}/art?inline=1`} target="_blank" rel="noreferrer" className="truncate flex-1 text-primary-600 hover:underline">{pmoc.artArquivoNome}</a>
                    )}
                    {artNova && <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">a salvar</span>}
                    {!somenteLeitura && (
                      <button type="button" title="Remover arquivo da ART" onClick={() => { setArtNova(null); setRemoverArt(!!pmoc?.artArquivoNome); }} className="p-1 text-ink-muted hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ) : (
                  <button type="button" onClick={() => inputArt.current?.click()}
                    className="w-full inline-flex items-center justify-center gap-2 border border-dashed border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink-muted hover:bg-surface-alt">
                    <Upload className="w-4 h-4" /> Enviar ART
                  </button>
                )}
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Descrição técnica / legal">
            <FormField label="Texto do plano" hint="Texto padrão com a base legal (Lei 13.589/2018, Portaria 3.523/GM/1998, RE ANVISA 09/2003, NBR 13971 e NBR 16401). Edite à vontade.">
              <Textarea aria-label="Descrição" value={form.descricao} onChange={(e) => set("descricao", e.target.value)} rows={12} className="text-[13px] leading-relaxed" />
            </FormField>
            {!somenteLeitura && form.descricao !== DESCRICAO_PADRAO_PMOC && (
              <button type="button" onClick={() => set("descricao", DESCRICAO_PADRAO_PMOC)} className="text-xs text-primary-600 hover:underline">Restaurar texto padrão</button>
            )}
          </FormSection>

          {!somenteLeitura && (
            <div className="flex justify-end gap-2 pt-2 border-t border-surface-border">
              <button type="button" onClick={() => salvar()} disabled={!!salvando}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
                {salvando === "salvar" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {novo ? "Criar PMOC" : "Salvar"}
              </button>
            </div>
          )}
        </fieldset>
      )}

      {/* ── Equipamentos AVAC ── */}
      {aba === "equipamentos" && pmoc && (
        <EquipamentosPmoc pmoc={pmoc} somenteLeitura={somenteLeitura} onAtualizar={(d) => setPmoc(serializar(d))} onErro={(t) => setMsg({ tipo: "erro", texto: t })} />
      )}
    </div>
  );
}


function EquipamentosPmoc({ pmoc, somenteLeitura, onAtualizar, onErro }: {
  pmoc: PmocDados; somenteLeitura: boolean; onAtualizar: (d: any) => void; onErro: (t: string) => void;
}) {
  const [disponiveis, setDisponiveis] = useState<EquipamentoPmoc[] | null>(null);
  const [outrasUnidades, setOutrasUnidades] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (somenteLeitura) return;
    fetch(`/api/equipamentos?clienteId=${pmoc.clienteId}`).then((r) => (r.ok ? r.json() : [])).then((l) => setDisponiveis(Array.isArray(l) ? l : [])).catch(() => setDisponiveis([]));
  }, [pmoc.clienteId, somenteLeitura]);

  const noPmoc = useMemo(() => new Set(pmoc.equipamentos.map((v) => v.equipamento.id)), [pmoc.equipamentos]);
  const candidatos = (disponiveis ?? []).filter((e) => !noPmoc.has(e.id) && (outrasUnidades || e.unidadeId === pmoc.unidadeId));
  const daUnidade = (disponiveis ?? []).filter((e) => !noPmoc.has(e.id) && e.unidadeId === pmoc.unidadeId);

  async function adicionar(ids: string[]) {
    if (!ids.length) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/pmocs/${pmoc.id}/equipamentos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ equipamentoIds: ids }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { onErro(d.erro ?? "Não foi possível adicionar."); return; }
      onAtualizar(d); setSelecionados(new Set());
    } catch { onErro("Erro de conexão."); } finally { setOcupado(false); }
  }
  async function remover(equipamentoId: string) {
    setOcupado(true);
    try {
      const res = await fetch(`/api/pmocs/${pmoc.id}/equipamentos?equipamentoId=${equipamentoId}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { onErro(d.erro ?? "Não foi possível remover."); return; }
      onAtualizar(d);
    } catch { onErro("Erro de conexão."); } finally { setOcupado(false); }
  }
  const alternar = (id: string) => setSelecionados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const linhaEquip = (e: EquipamentoPmoc, extra?: React.ReactNode, prefixo?: React.ReactNode) => (
    <>
      {prefixo}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink truncate">{rotuloEquip(e)}{!e.ativo && <span className="ml-1 text-[10px] text-slate-500 bg-slate-100 px-1 rounded">inativo</span>}</p>
        <p className="text-xs text-ink-muted flex flex-wrap gap-x-3">
          <span>TAG: <strong className="text-ink">{e.patrimonio || "—"}</strong></span>
          <span>{tipoEquip(e)}</span>
          <span>{e.capacidade || "capacidade —"}</span>
          <span>{localEquip(e)}{e.unidade && e.unidadeId !== pmoc.unidadeId ? ` (${e.unidade.nome})` : ""}</span>
        </p>
      </div>
      {extra}
    </>
  );

  return (
    <div className="space-y-5">
      {/* Cobertos pelo PMOC */}
      <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
          <h2 className="font-semibold text-ink">Equipamentos cobertos ({pmoc.equipamentos.length})</h2>
        </div>
        {pmoc.equipamentos.length === 0 ? (
          <p className="text-sm text-ink-muted text-center py-8 px-4">Nenhum equipamento neste PMOC ainda.{!somenteLeitura && " Adicione abaixo os equipamentos do local."}</p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm" data-tabela-cobertos>
                <thead className="bg-surface-alt text-xs uppercase tracking-wider text-ink-muted text-left">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">TAG</th><th className="px-4 py-2.5 font-semibold">Equipamento</th>
                    <th className="px-4 py-2.5 font-semibold">Tipo</th><th className="px-4 py-2.5 font-semibold">Capacidade</th>
                    <th className="px-4 py-2.5 font-semibold">Ambiente / local</th><th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {pmoc.equipamentos.map(({ equipamento: e }) => (
                    <tr key={e.id} data-coberto={e.id} className="border-t border-surface-border">
                      <td className="px-4 py-2.5 font-mono text-xs">{e.patrimonio || "—"}</td>
                      <td className="px-4 py-2.5"><Link href={`/equipamentos/${e.id}`} className="text-ink hover:text-primary-600 font-medium">{rotuloEquip(e)}</Link>
                        {!e.ativo && <span className="ml-1 text-[10px] text-slate-500 bg-slate-100 px-1 rounded">inativo</span>}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{tipoEquip(e)}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{e.capacidade || "—"}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{localEquip(e)}{e.unidade && e.unidadeId !== pmoc.unidadeId ? ` (${e.unidade.nome})` : ""}</td>
                      <td className="px-2">
                        {!somenteLeitura && (
                          <button type="button" title="Remover do PMOC" disabled={ocupado} onClick={() => remover(e.id)} className="p-1.5 rounded-md text-ink-muted hover:text-red-600 hover:bg-red-50 disabled:opacity-50"><X className="w-4 h-4" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="md:hidden divide-y divide-surface-border">
              {pmoc.equipamentos.map(({ equipamento: e }) => (
                <li key={e.id} data-coberto-card={e.id} className="flex items-center gap-3 px-4 py-3">
                  {linhaEquip(e, !somenteLeitura && (
                    <button type="button" title="Remover do PMOC" disabled={ocupado} onClick={() => remover(e.id)} className="p-1.5 rounded-md text-ink-muted hover:text-red-600 shrink-0"><X className="w-4 h-4" /></button>
                  ))}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Sugestões / adicionar */}
      {!somenteLeitura && (
        <div className="bg-white border border-surface-border rounded-xl overflow-hidden" data-sugestoes>
          <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between gap-2 flex-wrap">
            <div>
              <h2 className="font-semibold text-ink">Adicionar equipamentos</h2>
              <p className="text-xs text-ink-muted">Sugestão: os equipamentos de <strong>{pmoc.unidade.nome}</strong> (do cadastro real).</p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-ink-muted select-none">
              <input type="checkbox" checked={outrasUnidades} onChange={(e) => setOutrasUnidades(e.target.checked)} className="accent-primary-600" />
              Mostrar outras unidades do cliente
            </label>
          </div>
          {disponiveis === null ? (
            <p className="flex items-center justify-center gap-2 text-sm text-ink-muted py-6"><Loader2 className="w-4 h-4 animate-spin" /> Carregando equipamentos…</p>
          ) : candidatos.length === 0 ? (
            <p className="text-sm text-ink-muted text-center py-6 px-4 flex items-center justify-center gap-2">
              <Info className="w-4 h-4" /> {daUnidade.length === 0 && (disponiveis.length === 0 || !outrasUnidades)
                ? <>Todos os equipamentos deste local já estão no PMOC — ou não há equipamentos cadastrados. <Link href={`/equipamentos/novo?unidadeId=${pmoc.unidadeId}`} className="text-primary-600 hover:underline">Cadastrar equipamento</Link></>
                : "Nenhum outro equipamento disponível."}
            </p>
          ) : (
            <>
              <ul className="divide-y divide-surface-border max-h-[420px] overflow-y-auto">
                {candidatos.map((e) => (
                  <li key={e.id}>
                    <label data-candidato={e.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface-alt/60">
                      {linhaEquip(e, undefined, <input type="checkbox" checked={selecionados.has(e.id)} onChange={() => alternar(e.id)} className="accent-primary-600 w-4 h-4 shrink-0" />)}
                    </label>
                  </li>
                ))}
              </ul>
              <div className="px-4 py-3 border-t border-surface-border flex items-center justify-between gap-2 flex-wrap bg-surface-alt/40">
                {daUnidade.length > 0 ? (
                  <button type="button" disabled={ocupado} onClick={() => adicionar(daUnidade.map((e) => e.id))} className="text-sm font-medium text-primary-600 hover:underline disabled:opacity-50">
                    Adicionar todos desta unidade ({daUnidade.length})
                  </button>
                ) : <span />}
                <button type="button" disabled={ocupado || selecionados.size === 0} onClick={() => adicionar([...selecionados])}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold disabled:opacity-50">
                  {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar selecionados{selecionados.size ? ` (${selecionados.size})` : ""}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
