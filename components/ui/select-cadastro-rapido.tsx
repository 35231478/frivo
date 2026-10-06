"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ExternalLink, Loader2, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import type { Acao } from "@/lib/permissoes";

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
  tipo?: "texto" | "cep" | "uf" | "textarea" | "select";
  /** Opções quando `tipo: "select"`. */
  opcoes?: { value: string; label: string }[];
  /** Colunas no grid de 6 (celular sempre ocupa a linha toda). */
  colunas?: 2 | 3 | 4 | 6;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email";
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
}

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const COLS: Record<number, string> = { 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4", 6: "sm:col-span-6" };
const inputCls =
  "w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10";

export function SelectCadastroRapido({
  value, onChange, opcoes, entidade, campos, criar, permissao, linkCadastroCompleto, contexto,
  placeholder, disabled, textoDesabilitado, carregando, erro, campoBusca, className, valoresIniciais,
}: Props) {
  const podeCriar = usePodeCriar(permissao);

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
        erro ? "border-red-300 bg-red-50/40" : "border-surface-border bg-surface-alt/50", className)}>
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

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAberto((v) => !v)}
        className={cn(
          "w-full flex items-center justify-between gap-2 bg-white border rounded-lg px-3 py-2.5 text-sm text-left transition-all",
          "focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10",
          erro ? "border-red-300" : "border-surface-border",
          disabled && "bg-surface-alt cursor-not-allowed",
        )}
      >
        <span className={cn("truncate", selecionada ? "text-ink" : "text-ink-subtle")}>
          {disabled ? (textoDesabilitado ?? placeholder) : selecionada ? selecionada.label : (placeholder ?? `Selecione ${entidade.feminino ? "a" : "o"} ${entidade.singular}`)}
          {selecionada?.descricao && <span className="text-ink-subtle"> — {selecionada.descricao}</span>}
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
                placeholder={`Buscar ${entidade.singular}…`}
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
              className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-semibold text-primary-600 hover:bg-primary-50 border-t border-surface-border bg-surface-alt/40"
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
  aberto, onFechar, titulo, contexto, campos, criar, linkCadastroCompleto, valoresIniciais, onCriado, rotuloSalvar,
}: {
  aberto: boolean; onFechar: () => void; titulo: string; contexto?: string;
  campos: CampoRapido[]; criar: Props["criar"]; linkCadastroCompleto?: string;
  valoresIniciais: Record<string, string>; onCriado: (o: OpcaoCadastro) => void; rotuloSalvar?: string;
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
      const limpos = Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));
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
        {contexto && <p className="text-xs text-ink-muted -mt-1">Cadastro rápido {contexto}. Os dados já preenchidos no formulário continuam lá.</p>}

        <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
          {campos.map((c, i) => (
            <label key={c.nome} className={cn("block", COLS[c.colunas ?? 6])}>
              <span className="block text-xs font-medium text-ink mb-1">
                {c.label}{c.obrigatorio && <span className="text-red-500"> *</span>}
                {c.tipo === "cep" && buscandoCep && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-ink-subtle" />}
              </span>
              {c.tipo === "select" ? (
                <select value={valores[c.nome] ?? ""} onChange={(e) => set(c.nome, e.target.value)} className={cn(inputCls, faltando.has(c.nome) && "border-red-300")}>
                  {!c.obrigatorio || !(valores[c.nome]) ? <option value="">{c.placeholder ?? "Selecione"}</option> : null}
                  {(c.opcoes ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : c.tipo === "uf" ? (
                <select value={valores[c.nome] ?? ""} onChange={(e) => set(c.nome, e.target.value)} className={cn(inputCls, faltando.has(c.nome) && "border-red-300")}>
                  <option value="">UF</option>
                  {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              ) : c.tipo === "textarea" ? (
                <textarea
                  value={valores[c.nome] ?? ""} onChange={(e) => set(c.nome, e.target.value)} rows={2}
                  placeholder={c.placeholder} maxLength={c.maxLength}
                  className={cn(inputCls, "resize-none", faltando.has(c.nome) && "border-red-300")}
                />
              ) : (
                <input
                  autoFocus={i === 0}
                  value={valores[c.nome] ?? ""}
                  onChange={(e) => { set(c.nome, e.target.value); if (c.tipo === "cep") buscarCep(e.target.value); }}
                  placeholder={c.placeholder} maxLength={c.maxLength ?? (c.tipo === "cep" ? 9 : undefined)}
                  inputMode={c.tipo === "cep" ? "numeric" : c.inputMode}
                  className={cn(inputCls, faltando.has(c.nome) && "border-red-300 focus:border-red-400 focus:ring-red-500/10")}
                />
              )}
            </label>
          ))}
        </div>

        {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{erro}</p>}

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
