"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { corDado } from "@/lib/ui/tokens";
import { Check, ChevronDown, ExternalLink, Layers, Loader2, Lock, MapPin, Pencil, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { alcanceDaEdicao, camposAlterados, rotuloDaEdicao, type EscopoEdicao } from "@/lib/edicao-contexto";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import type { Acao } from "@/lib/permissoes";
import { AvisoSerieDuplicada } from "@/components/equipamentos/aviso-serie-duplicada";

/**
 * Select com CADASTRO RÁPIDO ("criar sem sair da tela").
 *
 * - Lista normal para selecionar, com busca.
 * - "+ Novo …" abre um mini-formulário (modal) só com os campos essenciais do
 *   cadastro relacionado, com link opcional para o cadastro completo (nova aba).
 * - Ao salvar, chama `criar` (API do cadastro) e JÁ SELECIONA o item criado.
 * - Estado vazio: "Nenhum X cadastrado — + Cadastrar agora".
 * - RBAC: a criação só aparece com `pode(permissao.modulo, permissao.acao)`.
 * - Não usa <form> (evita aninhar/submeter o formulário principal) e não toca no
 *   estado do formulário principal — os dados já preenchidos ficam intactos.
 *
 * EDITAR NO CONTEXTO (prop `edicao`): o mesmo padrão para EDITAR o item já selecionado, sem sair da
 * tela. O lápis ao lado do seletor abre o mini-formulário com os dados atuais. Regra de ouro
 * (lib/edicao-contexto): a faixa do topo diz sempre o que está sendo editado —
 *   - referência: "Editando o cadastro do cliente" (vale em todo lugar);
 *   - uso: "Editando este item da OS" (vale só ali; o cadastro não muda).
 * Registro fechado (`travado`): o lápis vira um cadeado, com o motivo no ⓘ. Sem a permissão, o lápis
 * nem aparece. Salvou: toast, e o formulário principal continua como estava.
 */

export interface OpcaoCadastro {
  value: string;
  label: string;
  /** Texto secundário na lista (ex.: cidade). */
  descricao?: string;
}

export interface CampoRapido {
  nome: string;
  label: string;
  obrigatorio?: boolean;
  placeholder?: string;
  /** "cep" preenche logradouro/bairro/cidade/estado (se existirem) via ViaCEP. */
  tipo?: "texto" | "cep" | "uf" | "textarea" | "select" | "cor";
  /** Opções quando `tipo: "select"`. */
  opcoes?: { value: string; label: string }[];
  /** Colunas no grid de 6 (celular sempre ocupa a linha toda). */
  colunas?: 2 | 3 | 4 | 6;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email";
  /** Nº de série de equipamento: avisa (sem bloquear) se já existe outro com a mesma etiqueta. */
  avisoSerie?: boolean;
}

/**
 * Editar o item selecionado sem sair da tela. `escopo` + `alvo` formam o rótulo obrigatório do que
 * está sendo editado (lib/edicao-contexto › rotuloDaEdicao).
 */
export interface EdicaoDoSelecionado {
  escopo: EscopoEdicao;
  /** referência: "do cliente" → "Editando o cadastro do cliente"; uso: "este item da OS" → "Editando este item da OS" */
  alvo: string;
  /** Campos do mini-formulário de edição (padrão: os mesmos de criar) */
  campos?: CampoRapido[];
  /** Os valores atuais do item selecionado (o que já está carregado na tela) */
  valores: (id: string) => Record<string, string>;
  /** Grava (lance Error(msg) em falha). Recebe todos os valores e a lista do que mudou. */
  salvar: (id: string, valores: Record<string, string>, alterados: string[]) => Promise<OpcaoCadastro | void>;
  /** Permissão exigida para editar (ou lista: qualquer uma libera). Sem ela, o lápis não aparece. */
  permissao?: PermissaoCriar;
  /** Registro fechado: o motivo (lib/edicao-contexto › motivoDaTrava). Com ele, não edita. */
  travado?: string | null;
  /** Para a edição complexa: abre o cadastro completo em nova aba */
  linkCadastroCompleto?: string | ((id: string) => string);
  /** Texto do toast ao salvar (padrão: "Alterações salvas.") */
  mensagemSucesso?: string;
}

/** Uma permissão, ou uma lista em que QUALQUER uma libera a criação. */
export type PermissaoCriar = { modulo: string; acao: Acao } | { modulo: string; acao: Acao }[];

/** Hook: o usuário pode criar segundo `permissao`? (sem permissão informada = pode). */
export function usePodeCriar(permissao?: PermissaoCriar): boolean {
  const { pode } = usePermissoes();
  if (!permissao) return true;
  const lista = Array.isArray(permissao) ? permissao : [permissao];
  return lista.some((p) => pode(p.modulo, p.acao));
}

export interface EntidadeCadastro {
  singular: string; // "unidade"
  plural: string;   // "unidades"
  /** Gênero gramatical para "Nova/Novo", "Nenhuma/Nenhum", "cadastrada/cadastrado". */
  feminino?: boolean;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  opcoes: OpcaoCadastro[];
  entidade: EntidadeCadastro;
  /** Mini-formulário (só campos essenciais). */
  campos: CampoRapido[];
  /** Cria o item na API e devolve a opção já pronta para seleção. Lance Error(msg) em falha. */
  criar: (valores: Record<string, string>) => Promise<OpcaoCadastro>;
  /** Permissão exigida para criar (ou lista: qualquer uma libera). Sem ela, a opção de criar não aparece. */
  permissao?: PermissaoCriar;
  /** Valores pré-preenchidos no mini-cadastro (ex.: tipo de pessoa padrão). */
  valoresIniciais?: Record<string, string>;
  /** Link para o cadastro completo (abre em nova aba para não perder este formulário). */
  linkCadastroCompleto?: string;
  /** Texto contextual no mini-cadastro (ex.: "para o cliente X"). */
  contexto?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Mensagem quando desabilitado (ex.: "Selecione um cliente primeiro"). */
  textoDesabilitado?: string;
  carregando?: boolean;
  erro?: boolean;
  /** Nome do campo que recebe o texto digitado na busca ao clicar em "+ Criar 'x'". */
  campoBusca?: string;
  className?: string;
  /** Ícone à esquerda do texto no botão (alinha com outros seletores que também têm ícone). */
  icone?: React.ReactNode;
  /** Editar o item selecionado sem sair da tela (o lápis ao lado do seletor). */
  edicao?: EdicaoDoSelecionado;
}

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const COLS: Record<number, string> = { 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 6: "sm:col-span-6" };
const inputCls =
  "w-full bg-white border border-surface-campo rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10";

export function SelectCadastroRapido({
  value, onChange, opcoes, entidade, campos, criar, permissao, linkCadastroCompleto, contexto,
  placeholder, disabled, textoDesabilitado, carregando, erro, campoBusca, className, valoresIniciais, icone, edicao,
}: Props) {
  const podeCriar = usePodeCriar(permissao);
  const podeEditar = usePodeCriar(edicao?.permissao) && !!edicao;
  const [editando, setEditando] = useState(false);

  const novo = entidade.feminino ? "Nova" : "Novo";
  const nenhum = entidade.feminino ? "Nenhuma" : "Nenhum";
  const cadastrado = entidade.feminino ? "cadastrada" : "cadastrado";

  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [modal, setModal] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const selecionada = opcoes.find((o) => o.value === value);
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? opcoes.filter((o) => `${o.label} ${o.descricao ?? ""}`.toLowerCase().includes(q)) : opcoes;
  }, [opcoes, busca]);

  function abrirCadastro() {
    setAberto(false);
    setModal(true);
  }

  // ── Estado vazio inteligente ──
  if (!disabled && !carregando && opcoes.length === 0) {
    return (
      <div className={cn("rounded-lg border border-dashed px-3 py-2.5 text-sm flex items-center justify-between gap-3 flex-wrap",
        erro ? "border-atrasado/40 bg-atrasado-claro/60" : "border-surface-border bg-surface-page", className)}>
        <span className="text-ink-muted">{nenhum} {entidade.singular} {cadastrado}{contexto ? ` ${contexto}` : ""}</span>
        {podeCriar && (
          <button type="button" onClick={abrirCadastro} className="inline-flex items-center gap-1 font-semibold text-primary-600 hover:text-primary-700">
            <Plus className="w-4 h-4" /> Cadastrar agora
          </button>
        )}
        <MiniCadastro
          aberto={modal} onFechar={() => setModal(false)} titulo={`${novo} ${entidade.singular}`} contexto={contexto}
          campos={campos} criar={criar} linkCadastroCompleto={linkCadastroCompleto} valoresIniciais={valoresIniciais ?? {}}
          onCriado={(o) => { setModal(false); onChange(o.value); }}
        />
      </div>
    );
  }

  // Com edição no contexto, o seletor divide a linha com o lápis; sem ela, o DOM é o de sempre
  const comLapis = podeEditar && !!selecionada && !disabled;
  const seletor = (
    <div ref={ref} className={cn("relative", edicao ? "flex-1 min-w-0" : className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between gap-2 bg-white border rounded-lg px-3 py-2.5 text-sm text-left transition-all",
          "focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10",
          erro ? "border-atrasado/40" : "border-surface-campo",
          disabled && "bg-surface-alt cursor-not-allowed",
        )}
      >
        <span className="flex items-center gap-2 min-w-0">
          {icone && <span className="shrink-0 text-ink-subtle" aria-hidden="true">{icone}</span>}
          <span className={cn("truncate", selecionada ? "text-ink" : "text-ink-subtle")}>
            {disabled ? (textoDesabilitado ?? placeholder) : selecionada ? selecionada.label : (placeholder ?? `Selecione ${entidade.feminino ? "a" : "o"} ${entidade.singular}`)}
            {selecionada?.descricao && <span className="text-ink-subtle"> — {selecionada.descricao}</span>}
          </span>
        </span>
        {carregando ? <Loader2 className="w-4 h-4 text-ink-subtle animate-spin shrink-0" /> : <ChevronDown className="w-4 h-4 text-ink-subtle shrink-0" />}
      </button>

      {aberto && !disabled && (
        <div className="absolute z-40 left-0 right-0 top-full mt-1 bg-white border border-surface-border rounded-lg shadow-card-hover overflow-hidden">
          {opcoes.length > 6 && (
            <div className="p-2 border-b border-surface-border relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-subtle pointer-events-none" />
              <input
                autoFocus value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder={`Pesquisar ${entidade.singular}…`}
                className="w-full bg-surface-alt rounded-md pl-8 pr-2 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-60 overflow-y-auto">
            {filtradas.length === 0 && (
              <p className="px-3 py-3 text-xs text-ink-subtle italic">Nenhum resultado{busca ? ` para “${busca}”` : ""}.</p>
            )}
            {filtradas.map((o) => (
              <button
                key={o.value} type="button"
                onClick={() => { onChange(o.value); setAberto(false); setBusca(""); }}
                className={cn("w-full flex items-center gap-2 text-left px-3 py-2.5 text-sm hover:bg-primary-50 border-b border-surface-border/60 last:border-0",
                  o.value === value ? "bg-primary-50 text-primary-700 font-medium" : "text-ink")}
              >
                <span className="flex-1 min-w-0 truncate">
                  {o.label}{o.descricao && <span className="text-ink-subtle font-normal"> — {o.descricao}</span>}
                </span>
                {o.value === value && <Check className="w-4 h-4 shrink-0" />}
              </button>
            ))}
          </div>
          {podeCriar && (
            <button
              type="button" onClick={abrirCadastro}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-primary-600 hover:bg-primary-50 border-t border-surface-border bg-surface-page"
            >
              <Plus className="w-4 h-4" />
              {busca.trim() && filtradas.length === 0 ? `Criar “${busca.trim()}”` : `${novo} ${entidade.singular}`}
            </button>
          )}
        </div>
      )}

      <MiniCadastro
        aberto={modal} onFechar={() => setModal(false)} titulo={`${novo} ${entidade.singular}`} contexto={contexto}
        campos={campos} criar={criar} linkCadastroCompleto={linkCadastroCompleto}
        valoresIniciais={{ ...valoresIniciais, ...(campoBusca && busca.trim() ? { [campoBusca]: busca.trim() } : {}) }}
        onCriado={(o) => { setModal(false); setBusca(""); onChange(o.value); }}
      />
    </div>
  );
  if (!edicao) return seletor;
  const link = typeof edicao.linkCadastroCompleto === "function" ? (value ? edicao.linkCadastroCompleto(value) : undefined) : edicao.linkCadastroCompleto;
  return (
    <div className={cn("flex items-center gap-1.5", className)} data-select-com-edicao>
      {seletor}
      {comLapis && (
        <BotaoEditarNoContexto
          rotulo={`Editar ${entidade.feminino ? "a" : "o"} ${entidade.singular} selecionad${entidade.feminino ? "a" : "o"}`}
          travado={edicao.travado} onClick={() => setEditando(true)}
        />
      )}
      {comLapis && !edicao.travado && (
        <EdicaoNoContextoModal
          aberto={editando} onFechar={() => setEditando(false)} escopo={edicao.escopo} alvo={edicao.alvo}
          campos={edicao.campos ?? campos} valores={editando ? edicao.valores(value) : {}}
          salvar={(v, alterados) => edicao.salvar(value, v, alterados)} onSalvo={() => setEditando(false)}
          linkCadastroCompleto={link} mensagemSucesso={edicao.mensagemSucesso}
        />
      )}
    </div>
  );
}

/* ───────── Editar no contexto ───────── */
/**
 * O lápis de "editar aqui mesmo". Registro fechado: vira cadeado (desabilitado) com o motivo no ⓘ.
 * Quem decide se ele aparece é quem chama (permissão e item selecionado).
 */
export function BotaoEditarNoContexto({ rotulo, travado, onClick, className }: { rotulo: string; travado?: string | null; onClick: () => void; className?: string }) {
  const classe = "shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-lg border border-surface-campo bg-white";
  if (travado) {
    return (
      <span className={cn("inline-flex items-center gap-0.5 shrink-0", className)} data-edicao-travada>
        <button type="button" disabled aria-label={`${rotulo}: edição travada`} className={cn(classe, "text-ink-subtle cursor-not-allowed bg-surface-alt")} data-editar-no-contexto>
          <Lock className="w-4 h-4" aria-hidden />
        </button>
        <Dica texto={travado} rotulo="Edição travada" lado="esquerda" />
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} data-editar-no-contexto
      className={cn(classe, "text-ink-muted hover:text-primary-600 hover:border-primary-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-acento/40", className)}>
      <Pencil className="w-4 h-4" aria-hidden />
    </button>
  );
}

/**
 * O mini-formulário de EDIÇÃO sozinho (para telas com seletor próprio ou para a linha de uma
 * transação). A faixa do topo diz o que está sendo editado e até onde a mudança chega; com `travado`
 * só mostra o motivo. Nada muda → fecha sem chamar o servidor. Salvou → toast.
 */
export function EdicaoNoContextoModal(props: {
  aberto: boolean; onFechar: () => void;
  escopo: EscopoEdicao; alvo: string;
  campos: CampoRapido[];
  /** Valores atuais (o formulário abre com eles) */
  valores: Record<string, string>;
  salvar: (valores: Record<string, string>, alterados: string[]) => Promise<OpcaoCadastro | void>;
  onSalvo: (o: OpcaoCadastro | void) => void;
  linkCadastroCompleto?: string;
  mensagemSucesso?: string;
  /** Registro fechado: o motivo. Com ele, o formulário não abre para edição. */
  travado?: string | null;
}) {
  const { aberto, onFechar, escopo, alvo, campos, valores, salvar, onSalvo, linkCadastroCompleto, mensagemSucesso, travado } = props;
  const titulo = rotuloDaEdicao(escopo, alvo);
  const faixa = (
    <div data-faixa-edicao={escopo}
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 -mt-1",
        escopo === "referencia" ? "border-atencao/30 bg-atencao-claro text-atencao-texto" : "border-surface-border bg-surface-alt text-ink")}>
      {escopo === "referencia" ? <Layers className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> : <MapPin className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />}
      {/* O título do painel já diz O QUE está sendo editado; a faixa diz até onde a mudança chega */}
      <p className="text-sm font-medium" data-alcance-edicao>{alcanceDaEdicao(escopo)}</p>
    </div>
  );
  if (travado) {
    return (
      <Modal aberto={aberto} onFechar={onFechar} titulo={titulo} tamanho="sm">
        <div className="space-y-4" data-edicao-travada-modal>
          <p className="flex items-start gap-2 text-sm text-ink"><Lock className="w-4 h-4 mt-0.5 shrink-0 text-ink-muted" aria-hidden /> {travado}</p>
          <div className="flex justify-end">
            <button type="button" onClick={onFechar} className="px-4 py-2.5 text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface-alt">Fechar</button>
          </div>
        </div>
      </Modal>
    );
  }
  return (
    <MiniCadastro
      aberto={aberto} onFechar={onFechar} titulo={titulo} campos={campos} valoresIniciais={valores} linkCadastroCompleto={linkCadastroCompleto}
      modo="editar" faixa={faixa} rotuloSalvar="Salvar"
      criar={async (v) => {
        const alterados = camposAlterados(valores, v, campos.map((c) => c.nome));
        // Nada mudou: fecha sem chamar o servidor (e sem dizer que salvou)
        if (!alterados.length) return { value: "", label: "" };
        const o = await salvar(v, alterados);
        toast(mensagemSucesso ?? "Alterações salvas.");
        return o ?? { value: "", label: "" };
      }}
      onCriado={(o) => onSalvo(o.value ? o : undefined)}
    />
  );
}

/* ───────── Mini-formulário ───────── */
/**
 * O mini-cadastro sozinho, para telas com seletor próprio (busca de catálogo,
 * lista de múltipla escolha). Mesmo comportamento do SelectCadastroRapido.
 */
export function CadastroRapidoModal(props: {
  aberto: boolean; onFechar: () => void; titulo: string; contexto?: string;
  campos: CampoRapido[]; criar: Props["criar"]; linkCadastroCompleto?: string;
  valoresIniciais?: Record<string, string>; onCriado: (o: OpcaoCadastro) => void;
  /** Texto do botão de salvar (padrão: "Salvar e selecionar"). */
  rotuloSalvar?: string;
}) {
  return <MiniCadastro {...props} valoresIniciais={props.valoresIniciais ?? {}} />;
}

function MiniCadastro({
  aberto, onFechar, titulo, contexto, campos, criar, linkCadastroCompleto, valoresIniciais, onCriado, rotuloSalvar, modo = "criar", faixa,
}: {
  aberto: boolean; onFechar: () => void; titulo: string; contexto?: string;
  campos: CampoRapido[]; criar: Props["criar"]; linkCadastroCompleto?: string;
  valoresIniciais: Record<string, string>; onCriado: (o: OpcaoCadastro) => void; rotuloSalvar?: string;
  /** "editar": manda também os campos esvaziados (limpar um campo é uma mudança) */
  modo?: "criar" | "editar";
  /** O que vem antes dos campos (na edição: a faixa que diz o que está sendo editado) */
  faixa?: React.ReactNode;
}) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [faltando, setFaltando] = useState<Set<string>>(new Set());
  const [buscandoCep, setBuscandoCep] = useState(false);

  // Reinicia a cada abertura (com o texto da busca, se houver)
  useEffect(() => {
    if (aberto) { setValores(valoresIniciais); setErro(""); setFaltando(new Set()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  const set = (k: string, v: string) => setValores((s) => ({ ...s, [k]: v }));

  async function buscarCep(cepBruto: string) {
    const cep = cepBruto.replace(/\D/g, "");
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const d = await (await fetch(`https://viacep.com.br/ws/${cep}/json/`)).json();
      if (!d.erro) {
        const mapa: Record<string, string | undefined> = { logradouro: d.logradouro, bairro: d.bairro, cidade: d.localidade, estado: d.uf };
        setValores((s) => {
          const novo = { ...s };
          for (const c of campos) if (mapa[c.nome] && !s[c.nome]) novo[c.nome] = mapa[c.nome]!;
          return novo;
        });
      }
    } catch { /* sem rede: o usuário digita */ } finally { setBuscandoCep(false); }
  }

  async function salvar() {
    const falta = new Set(campos.filter((c) => c.obrigatorio && !(valores[c.nome] ?? "").trim()).map((c) => c.nome));
    setFaltando(falta);
    if (falta.size) { setErro("Preencha os campos obrigatórios."); return; }
    setSalvando(true); setErro("");
    try {
      const aparados = Object.entries(valores).map(([k, v]) => [k, v.trim()] as const);
      // Criar: campo vazio não vai. Editar: vai (apagar o que estava escrito é uma mudança)
      const limpos = Object.fromEntries(modo === "editar" ? campos.map((c) => [c.nome, (valores[c.nome] ?? "").trim()]) : aparados.filter(([, v]) => v));
      onCriado(await criar(limpos));
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : "Não foi possível salvar. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} onFechar={onFechar} titulo={titulo} tamanho="sm">
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          // Enter salva o mini-cadastro sem submeter o formulário principal
          if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); e.stopPropagation(); salvar(); }
        }}
      >
        {faixa}
        {contexto && <p className="text-xs text-ink-muted -mt-1">Cadastro rápido {contexto}. Os dados já preenchidos no formulário são mantidos.</p>}

        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          {campos.map((c, i) => (
            <label key={c.nome} className={cn("block", COLS[c.colunas ?? 6])}>
              <span className="block text-xs font-medium text-ink mb-1">
                {c.label}{c.obrigatorio && <span className="text-atrasado"> *</span>}
                {c.tipo === "cep" && buscandoCep && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-ink-subtle" />}
              </span>
              {c.tipo === "select" ? (
                <select value={valores[c.nome] ?? ""} onChange={(e) => set(c.nome, e.target.value)} className={cn(inputCls, faltando.has(c.nome) && "border-atrasado/40")}>
                  {!c.obrigatorio || !(valores[c.nome]) ? <option value="">{c.placeholder ?? "Selecione"}</option> : null}
                  {(c.opcoes ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : c.tipo === "uf" ? (
                <select value={valores[c.nome] ?? ""} onChange={(e) => set(c.nome, e.target.value)} className={cn(inputCls, faltando.has(c.nome) && "border-atrasado/40")}>
                  <option value="">UF</option>
                  {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              ) : c.tipo === "cor" ? (
                <input
                  type="color"
                  value={valores[c.nome] || corDado.cinza}
                  onChange={(e) => set(c.nome, e.target.value)}
                  className="h-10 w-16 rounded-lg border border-surface-border bg-white p-1 cursor-pointer"
                />
              ) : c.tipo === "textarea" ? (
                <textarea
                  value={valores[c.nome] ?? ""} onChange={(e) => set(c.nome, e.target.value)} rows={2}
                  placeholder={c.placeholder} maxLength={c.maxLength}
                  className={cn(inputCls, "resize-none", faltando.has(c.nome) && "border-atrasado/40")}
                />
              ) : (
                <input
                  autoFocus={i === 0}
                  value={valores[c.nome] ?? ""}
                  onChange={(e) => { set(c.nome, e.target.value); if (c.tipo === "cep") buscarCep(e.target.value); }}
                  placeholder={c.placeholder} maxLength={c.maxLength ?? (c.tipo === "cep" ? 9 : undefined)}
                  inputMode={c.tipo === "cep" ? "numeric" : c.inputMode}
                  className={cn(inputCls, faltando.has(c.nome) && "border-atrasado/40 focus:border-atrasado focus:ring-atrasado/10")}
                />
              )}
            </label>
          ))}
        </div>
        {campos.filter((c) => c.avisoSerie).map((c) => <AvisoSerieDuplicada key={c.nome} numero={valores[c.nome] ?? ""} />)}

        {erro && <p className="text-sm text-atrasado bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">{erro}</p>}

        <div className="flex flex-col-reverse gap-3 pt-1">
          {linkCadastroCompleto ? (
            <a href={linkCadastroCompleto} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700">
              Abrir cadastro completo <ExternalLink className="w-3 h-3" />
            </a>
          ) : <span />}
          <div className="flex gap-2 sm:justify-end">
            <button type="button" onClick={onFechar} className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface-alt">
              <X className="w-4 h-4 sm:hidden" /> Cancelar
            </button>
            <button type="button" onClick={salvar} disabled={salvando} className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-60">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              <span className="sm:hidden">Salvar</span><span className="hidden sm:inline whitespace-nowrap">{rotuloSalvar ?? "Salvar e selecionar"}</span>
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
