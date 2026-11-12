"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  FileBadge, ClipboardList, Thermometer, CalendarRange, ListChecks, AlertOctagon, Lightbulb, Paperclip,
  ChevronLeft, Save, Loader2, AlertTriangle, CheckCircle2, Upload, FileText, Trash2, Send, Undo2, Plus, X, Info, History, ShieldAlert, ShieldX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatarCapacidade, rotuloTipoEquipamento } from "@/lib/equipamento-descricao";
import { Input } from "@/components/ui/input";
import { InputData } from "@/components/ui/input-data";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid, FormSection } from "@/components/ui/form-field";
import { SelectCadastroRapido, type OpcaoCadastro } from "@/components/ui/select-cadastro-rapido";
import { CLIENTE, UNIDADE } from "@/components/cadastro-rapido/definicoes";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { PmocStatusSelo } from "@/components/pmoc/pmoc-status-selo";
import { PmocCopiarBotao } from "@/components/pmoc/pmoc-copiar-botao";
import { PmocRenovar } from "@/components/pmoc/pmoc-renovar";
import { umAnoDepois } from "@/lib/pmoc-renovacao";
import { PmocCronograma } from "@/components/pmoc/pmoc-cronograma";
import { PmocBaixarDocumento, PmocEnviar, type DestinoEnvio } from "@/components/pmoc/pmoc-envio";
import { PmocHistorico } from "@/components/pmoc/pmoc-historico";
import { PmocOcorrencias } from "@/components/pmoc/pmoc-ocorrencias";
import { DESCRICAO_PADRAO_PMOC, TAMANHO_MAX_ART, TIPOS_ART, hojeISO, pendenciasPublicacao, serializarPmoc } from "@/lib/pmoc";
import { avisoDoPlano, bloqueioEnvio, textoAviso, type ConfigPmoc, type TipoAviso } from "@/lib/pmoc-avisos";
import { reduzirImagem } from "@/lib/imagem-cliente";

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

type Aba = "identificacao" | "equipamentos" | "cronograma" | "ocorrencias" | "historico";
const ABAS = [
  ["identificacao", "Identificação", ClipboardList], ["equipamentos", "Equipamentos AVAC", Thermometer], ["cronograma", "Cronograma", CalendarRange],
  ["ocorrencias", "Ocorrências", AlertOctagon], ["historico", "Histórico", History],
] as const;
// As abas que só existem com o plano salvo
const SO_SALVO: Aba[] = ["equipamentos", "cronograma", "ocorrencias", "historico"];
const MSG_ART_GRANDE = "Arquivo da ART acima de 3 MB.";
const ABAS_FUTURAS = [
  { rotulo: "Planejamento", icone: ListChecks },
  { rotulo: "Recomendações", icone: Lightbulb },
  { rotulo: "Anexos", icone: Paperclip },
];

const rotuloEquip = (e: EquipamentoPmoc) => e.nome || `${e.marca} ${e.modelo}`.trim();
// Tipo e capacidade no formato único do sistema (lib/equipamento-descricao): "48.000 BTU/h", "5 TR"
const tipoEquip = (e: EquipamentoPmoc) => rotuloTipoEquipamento(e);
const capacidadeEquip = (e: EquipamentoPmoc) => formatarCapacidade(e.capacidade);
const localEquip = (e: EquipamentoPmoc) => [e.setor, e.localizacao].filter(Boolean).join(" › ") || "—";
function lerArquivo(file: File): Promise<string> {
  return new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(r.result as string); r.onerror = erro; r.readAsDataURL(file); });
}

export function PmocEditor({ inicial, abaInicial, copiaRecente, criadoRecente, renovadoRecente, config, avisoCiente, destino, ocorrenciasPendentes }: {
  inicial?: PmocDados; abaInicial?: string; copiaRecente?: boolean; criadoRecente?: boolean; renovadoRecente?: boolean;
  /** Quantas ocorrências do plano ainda não foram resolvidas (o número na aba) */
  ocorrenciasPendentes?: number;
  /** O padrão da empresa: antecedência do aviso de vencimento e texto técnico dos planos novos */
  config?: ConfigPmoc;
  /** O aviso de vencimento de hoje que já teve ciência (some do cabeçalho) */
  avisoCiente?: TipoAviso | null;
  /** Para quem o documento vai: o contato principal do cliente */
  destino?: DestinoEnvio;
}) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const novo = !inicial;
  const textoPadrao = config?.textoPadrao || DESCRICAO_PADRAO_PMOC;
  const [pmoc, setPmoc] = useState<PmocDados | undefined>(inicial);
  const somenteLeitura = novo ? !pode("pmoc", "criar") : !pode("pmoc", "editar") || !pmoc!.ativo;
  const [aba, setAba] = useState<Aba>(!novo && SO_SALVO.includes(abaInicial as Aba) ? (abaInicial as Aba) : "identificacao");

  // No celular a faixa de abas rola para os lados: a aba ativa fica sempre à vista
  const abasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const faixa = abasRef.current;
    const ativa = faixa?.querySelector<HTMLElement>("[aria-selected='true']");
    if (!faixa || !ativa) return;
    // Rola só o necessário para a aba ativa caber inteira (no desktop, onde ela já aparece, não mexe)
    const inicio = ativa.offsetLeft - faixa.offsetLeft, fim = inicio + ativa.offsetWidth;
    if (inicio < faixa.scrollLeft) faixa.scrollLeft = Math.max(0, inicio - 16);
    else if (fim > faixa.scrollLeft + faixa.clientWidth) faixa.scrollLeft = fim - faixa.clientWidth + 16;
  }, [aba]);

  const hoje = hojeISO();
  const [form, setForm] = useState(() => ({
    nome: inicial?.nome ?? "",
    descricao: inicial ? (inicial.descricao ?? "") : textoPadrao,
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
    renovadoRecente ? { tipo: "ok", texto: "Renovação criada como Rascunho, com o cronograma. Anexe a nova ART, confira e publique." }
    : copiaRecente ? { tipo: "ok", texto: "Cópia criada como Rascunho. A ART não é copiada: informe a ART deste novo plano." }
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
    // Foto da ART (celular: 3 a 8 MB) é reduzida antes de enviar: continua legível e cabe no documento
    if (f.type !== "application/pdf") {
      try {
        const { imagem } = await reduzirImagem(f, 2200, 0.85);
        if (imagem.bytes > TAMANHO_MAX_ART) { setMsg({ tipo: "erro", texto: MSG_ART_GRANDE }); return; }
        setArtNova({ dataUrl: imagem.dataUrl, nome: f.name.replace(/\.[^.]+$/, "") + ".jpg" }); setRemoverArt(false); setMsg(null);
        return;
      } catch { /* não deu para reduzir: segue com o arquivo como veio */ }
    }
    if (f.size > TAMANHO_MAX_ART) { setMsg({ tipo: "erro", texto: MSG_ART_GRANDE }); return; }
    setArtNova({ dataUrl: await lerArquivo(f), nome: f.name }); setRemoverArt(false); setMsg(null);
  }

  // Aviso de vencimento: calculado pela data; some quando alguém dá ciência (até a próxima fase)
  const [ciente, setCiente] = useState<TipoAviso | null>(avisoCiente ?? null);
  const [dandoCiencia, setDandoCiencia] = useState(false);
  const aviso = pmoc ? avisoDoPlano(pmoc, config?.diasAviso) : null;
  const [historicoVersao, setHistoricoVersao] = useState(0);
  // Ocorrências: o número da aba acompanha o que a aba faz, e cada mudança dela entra no histórico
  const [pendentes, setPendentes] = useState(ocorrenciasPendentes ?? 0);
  const equipamentosDoPlano = useMemo(
    () => (pmoc?.equipamentos ?? []).map(({ equipamento: e }) => ({ id: e.id, rotulo: [e.patrimonio, rotuloEquip(e)].filter(Boolean).join(" · ") })),
    [pmoc?.equipamentos],
  );
  async function darCiencia() {
    if (!pmoc) return;
    setDandoCiencia(true);
    try {
      const res = await fetch(`/api/pmocs/${pmoc.id}/aviso`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ tipo: "erro", texto: d.erro ?? "Não foi possível registrar a ciência." }); return; }
      setCiente(d.tipo); setHistoricoVersao((v) => v + 1);
      router.refresh();
    } catch { setMsg({ tipo: "erro", texto: "Erro de conexão." }); } finally { setDandoCiencia(false); }
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
      setPmoc(serializar(d)); setArtNova(null); setRemoverArt(false); setHistoricoVersao((v) => v + 1);
      const geradas = Number(d.osGeradas) || 0;
      const sufixo = geradas ? ` ${geradas === 1 ? "1 OS gerada" : `${geradas} OS geradas`} pelo cronograma.` : "";
      setMsg({ tipo: "ok", texto: (statusDesejado === "PUBLICADO" ? "PMOC publicado." : statusDesejado === "RASCUNHO" ? "PMOC voltou para Rascunho." : "Alterações salvas.") + sufixo });
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
              {pmoc && <PmocStatusSelo pmoc={pmoc} detalhe diasAviso={config?.diasAviso} />}
            </h1>
            {pmoc && <p className="text-sm text-ink-muted">{pmoc.cliente.nomeFantasia ?? pmoc.cliente.nome} · {pmoc.unidade.nome}</p>}
          </div>
        </div>
        {pmoc && (
          <div className="flex items-center gap-2 flex-wrap">
            <PmocBaixarDocumento pmocId={pmoc.id} />
            <PmocEnviar pmocId={pmoc.id} bloqueio={bloqueioEnvio(pmoc)} destino={destino} aoEnviar={() => setHistoricoVersao((v) => v + 1)} />
            {!somenteLeitura && pmoc.status === "RASCUNHO" && (
              <button type="button" onClick={() => salvar("PUBLICADO")} disabled={!!salvando}
                className="inline-flex items-center gap-1.5 text-sm rounded-lg px-3 py-2 bg-ok hover:bg-success-600 text-white font-semibold disabled:opacity-60">
                {salvando === "PUBLICADO" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Publicar
              </button>
            )}
            {!somenteLeitura && pmoc.status === "PUBLICADO" && (
              <button type="button" onClick={() => salvar("RASCUNHO")} disabled={!!salvando}
                className="inline-flex items-center gap-1.5 text-sm border border-surface-border rounded-lg px-3 py-2 bg-white text-ink hover:bg-surface-alt disabled:opacity-60">
                <Undo2 className="w-4 h-4" /> Voltar para rascunho
              </button>
            )}
            <PmocRenovar pmocId={pmoc.id} />
            <PmocCopiarBotao id={pmoc.id} variante="botao" />
            <InativarRegistro url={`/api/pmocs/${pmoc.id}`} modulo="pmoc" acaoReativar="editar" variante="botao" ativo={pmoc.ativo} nome={pmoc.nome} entidade="PMOC" comMotivo={false}
              aoConcluir={(ativo) => { setPmoc((p) => (p ? { ...p, ativo } : p)); router.refresh(); }} />
          </div>
        )}
      </div>

      {pmoc && !pmoc.ativo && (
        <div data-aviso-inativo className="bg-surface-alt border border-surface-border text-ink-muted rounded-xl px-4 py-3 text-sm">
          Este PMOC está <strong>inativo</strong> e não aparece na lista padrão. Use “Reativar” para voltar a editá-lo.
        </div>
      )}
      {pmoc && aviso && aviso.tipo !== ciente && (
        <div data-aviso-vencimento={aviso.tipo} role="status"
          className={cn("flex items-center gap-3 flex-wrap rounded-xl px-4 py-3 text-sm border", aviso.tipo === "EXPIRADO" ? "bg-atrasado-claro border-atrasado/20 text-atrasado-texto" : "bg-atencao-claro border-atencao/20 text-atencao-texto")}>
          {aviso.tipo === "EXPIRADO" ? <ShieldX className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
          <span className="flex-1 min-w-[12rem]">
            <strong>{textoAviso(aviso, pmoc.dataExpiracao)}.</strong> Use “Renovar” para criar o plano da próxima vigência, já com o cronograma.
          </span>
          {pode("pmoc", "editar") && (
            <button type="button" onClick={darCiencia} disabled={dandoCiencia} data-ciente
              className="inline-flex items-center gap-1.5 text-sm font-semibold border border-current/30 rounded-lg px-3 py-1.5 bg-white/70 hover:bg-white disabled:opacity-60">
              {dandoCiencia ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Ciente
            </button>
          )}
        </div>
      )}
      {msg && (
        <div data-msg={msg.tipo} className={cn("flex items-start gap-2 text-sm rounded-lg px-3 py-2 border", msg.tipo === "ok" ? "text-ok-texto bg-ok-claro border-ok/20" : "text-atrasado-texto bg-atrasado-claro border-atrasado/20")}>
          {msg.tipo === "ok" ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />} <span>{msg.texto}</span>
        </div>
      )}

      {/* Abas */}
      <div ref={abasRef} className="flex gap-1 overflow-x-auto border-b border-surface-border -mx-1 px-1" role="tablist">
        {ABAS.map(([id, rotulo, Icone]) => (
          <button key={id} type="button" role="tab" data-aba={id} aria-selected={aba === id} disabled={novo && SO_SALVO.includes(id)} onClick={() => setAba(id)}
            title={novo && SO_SALVO.includes(id) ? "Salve a identificação primeiro" : undefined}
            className={cn("flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors disabled:opacity-40",
              aba === id ? "border-primary-500 text-primary-600" : "border-transparent text-ink-muted hover:text-ink")}>
            <Icone className="w-4 h-4" /> {rotulo}
            {id === "equipamentos" && pmoc && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-alt">{pmoc.equipamentos.length}</span>}
            {id === "ocorrencias" && pendentes > 0 && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-atencao-claro text-atencao-texto" data-ocorrencias-pendentes title="Ocorrências não resolvidas">{pendentes}</span>
            )}
          </button>
        ))}
        {ABAS_FUTURAS.map(({ rotulo, icone: Icone }) => (
          <button key={rotulo} type="button" disabled data-aba-futura title="Próxima etapa do módulo PMOC"
            className="flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 border-transparent -mb-px text-ink-subtle cursor-not-allowed">
            <Icone className="w-4 h-4" /> {rotulo} <span className="text-[9px] font-bold uppercase tracking-wide bg-atencao-claro text-atencao-texto px-1.5 py-0.5 rounded">em breve</span>
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
                <InputData aria-label="Data de início" value={form.dataInicio} onChange={(iso) => set("dataInicio", iso)} disabled={somenteLeitura} />
              </FormField>
              <FormField label="Data de expiração" required hint="Vigente até este dia; depois vira Expirado automaticamente">
                <InputData aria-label="Data de expiração" value={form.dataExpiracao} onChange={(iso) => set("dataExpiracao", iso)} disabled={somenteLeitura} />
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="Responsável técnico e ART">
            {rts.length > 0 && !somenteLeitura && (
              <FormField label="Preencher com um responsável técnico cadastrado" hint="Opcional: copia nome e CREA do cadastro de colaboradores">
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
              <FormField label="Nome do responsável técnico">
                <Input aria-label="Nome do responsável técnico" value={form.rtNome} onChange={(e) => set("rtNome", e.target.value)} placeholder="Engenheiro(a) responsável" />
              </FormField>
              <FormField label="Registro CREA">
                <Input aria-label="Registro CREA" value={form.rtCrea} onChange={(e) => set("rtCrea", e.target.value)} placeholder="Ex: SP-5061234567" />
              </FormField>
            </FormGrid>
            <FormGrid>
              <FormField label="Número da ART">
                <Input aria-label="Número da ART" value={form.artNumero} onChange={(e) => set("artNumero", e.target.value)} placeholder="Ex: 28027230241234567" />
              </FormField>
              <FormField label="Arquivo da ART" hint="PDF, JPG ou PNG até 3 MB. Entra no fim do documento do plano.">
                <input ref={inputArt} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={escolherArt} aria-label="Arquivo da ART" />
                {temArt ? (
                  <div className="flex items-center gap-2 border border-surface-border rounded-lg px-3 py-2 text-sm" data-art-arquivo>
                    <FileText className="w-4 h-4 text-primary-600 shrink-0" />
                    {artNova || !pmoc ? <span className="truncate flex-1">{artNova?.nome}</span> : (
                      <a href={`/api/pmocs/${pmoc.id}/art?inline=1`} target="_blank" rel="noreferrer" className="truncate flex-1 text-primary-600 hover:underline">{pmoc.artArquivoNome}</a>
                    )}
                    {artNova && <span className="text-[10px] text-atencao-texto bg-atencao-claro px-1.5 py-0.5 rounded">a salvar</span>}
                    {!somenteLeitura && (
                      <button type="button" title="Excluir arquivo da ART" aria-label="Excluir arquivo da ART" onClick={() => { setArtNova(null); setRemoverArt(!!pmoc?.artArquivoNome); }} className="p-1 text-ink-muted hover:text-atrasado">
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
            <FormField label="Texto do plano" hint="Texto padrão com a base legal; pode ser editado." dica="Cita a Lei 13.589/2018, a Portaria 3.523/GM/1998, a RE ANVISA 09/2003 e as normas NBR 13971 e NBR 16401.">
              <Textarea aria-label="Descrição" value={form.descricao} onChange={(e) => set("descricao", e.target.value)} rows={12} className="text-[13px] leading-relaxed" />
            </FormField>
            {!somenteLeitura && form.descricao !== textoPadrao && (
              <button type="button" onClick={() => set("descricao", textoPadrao)} className="text-xs text-primary-600 hover:underline" data-restaurar-descricao>Restaurar texto padrão</button>
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

      {/* ── Cronograma (Etapa 2): relê ao mudar o status, a validade ou os equipamentos do plano ── */}
      {aba === "cronograma" && pmoc && (
        <PmocCronograma key={`${pmoc.status}-${pmoc.dataExpiracao}-${pmoc.equipamentos.length}`} pmocId={pmoc.id} dataExpiracao={pmoc.dataExpiracao} somenteLeitura={somenteLeitura} />
      )}

      {/* ── Ocorrências: as não conformidades achadas na manutenção (entram no documento) ── */}
      {aba === "ocorrencias" && pmoc && (
        <PmocOcorrencias pmocId={pmoc.id} equipamentos={equipamentosDoPlano} somenteLeitura={!pode("pmoc", "editar") || !pmoc.ativo}
          aoMudar={(n) => { setPendentes(n); setHistoricoVersao((v) => v + 1); }} />
      )}

      {/* ── Histórico (Etapa 3): relê depois de cada envio, ciência, salvamento ou ocorrência ── */}
      {aba === "historico" && pmoc && <PmocHistorico key={historicoVersao} pmocId={pmoc.id} />}
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
        <p className="text-sm font-medium text-ink truncate">{rotuloEquip(e)}{!e.ativo && <span className="ml-1 text-[10px] text-ink-muted bg-surface-linha px-1 rounded">inativo</span>}</p>
        <p className="text-xs text-ink-muted flex flex-wrap gap-x-3">
          <span>TAG: <strong className="text-ink">{e.patrimonio || "—"}</strong></span>
          <span>{tipoEquip(e)}</span>
          <span>{capacidadeEquip(e) || "capacidade —"}</span>
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
                        {!e.ativo && <span className="ml-1 text-[10px] text-ink-muted bg-surface-linha px-1 rounded">inativo</span>}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{tipoEquip(e)}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{capacidadeEquip(e) || "—"}</td>
                      <td className="px-4 py-2.5 text-ink-muted">{localEquip(e)}{e.unidade && e.unidadeId !== pmoc.unidadeId ? ` (${e.unidade.nome})` : ""}</td>
                      <td className="px-2">
                        {!somenteLeitura && (
                          <button type="button" title="Excluir do PMOC" aria-label="Excluir do PMOC" disabled={ocupado} onClick={() => remover(e.id)} className="p-1.5 rounded-md text-ink-muted hover:text-atrasado hover:bg-atrasado-claro disabled:opacity-50"><X className="w-4 h-4" /></button>
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
                    <button type="button" title="Excluir do PMOC" aria-label="Excluir do PMOC" disabled={ocupado} onClick={() => remover(e.id)} className="p-1.5 rounded-md text-ink-muted hover:text-atrasado shrink-0"><X className="w-4 h-4" /></button>
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
