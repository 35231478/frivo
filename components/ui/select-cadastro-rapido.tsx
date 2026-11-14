"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { corDado } from "@/lib/ui/tokens";
import { Check, ChevronDown, ExternalLink, Layers, Loader2, Lock, MapPin, Pencil, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { Dica } from "@/components/ui/dica";
import { toast } from "@/components/ui/avisos";
import { alcanceDaEdicao, camposAlterados, rotuloDaEdicao, type EscopoEdicao } from "@/lib/edicao-contexto";
import { aplicarSugestao, notaDaSugestao } from "@/lib/cadastros/autofill-cnpj";
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
  /** Botão "Consultar" ao lado do campo: sugere os outros campos a partir deste (ex.: CNPJ). */
  consulta?: ConsultaDoCampo;
}

/**
 * Consulta a partir de um campo (o CNPJ puxa razão social, fantasia e telefone). Ela SUGERE: só entra
 * nos campos ainda vazios, a tela diz de onde veio e tudo continua editável.
 */
export interface ConsultaDoCampo {
  /** De onde vêm os dados — abre a frase mostrada depois ("Dados da Receita Federal") */
  origem: string;
  /** A consulta vale para estes valores? (ex.: só pessoa jurídica). Sem ela, vale sempre. */
  disponivel?: (valores: Record<string, string>) => boolean;
  /** O valor do campo já dá para consultar? (ex.: 14 dígitos) */
  pronto: (valor: string) => boolean;
  /** Busca e devolve { campo: valor sugerido } (lance Error(msg) em falha) */
  buscar: (valor: string) => Promise<Record<string, string>>;
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
  /**
   * Os valores atuais do item: o que já está carregado na tela ou, quando a tela só tem o nome, uma
   * promessa que busca o cadastro (o painel mostra "Carregando…" até chegar).
   */
  valores: (id: string) => Record<string, string> | Promise<Record<string, string>>;
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
  /** Mais uma parte do mesmo cadastro, abaixo dos campos (ex.: os contatos do cliente) */
  extra?: (id: string) => React.ReactNode;
  /** Uma edição mais a fundo que continua nesta tela (ex.: os materiais do item) */
  acaoSecundaria?: (id: string) => { rotulo: string; onClick: () => void } | null;
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
        <PainelDaEdicao id={value} edicao={edicao} camposPadrao={campos} aberto={editando} onFechar={() => setEditando(false)} link={link} />
      )}
    </div>
  );
}

/** O painel de edição de um item, a partir da definição (`EdicaoDoSelecionado`): resolve valores, extra e ação. */
function PainelDaEdicao({ id, edicao, camposPadrao, aberto, onFechar, link }: {
  id: string; edicao: EdicaoDoSelecionado; camposPadrao?: CampoRapido[]; aberto: boolean; onFechar: () => void; link?: string;
}) {
  // Os valores são lidos uma vez por abertura (a função da tela pode devolver uma promessa)
  const lidos = useMemo(() => (aberto ? edicao.valores(id) : {}), [aberto, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const promessa = typeof (lidos as Promise<unknown>).then === "function";
  const acao = aberto ? edicao.acaoSecundaria?.(id) ?? null : null;
  return (
    <EdicaoNoContextoModal
      aberto={aberto} onFechar={onFechar} escopo={edicao.escopo} alvo={edicao.alvo} campos={edicao.campos ?? camposPadrao ?? []}
      valores={promessa ? {} : (lidos as Record<string, string>)} carregar={promessa ? () => lidos as Promise<Record<string, string>> : undefined}
      salvar={(v, alterados) => edicao.salvar(id, v, alterados)} onSalvo={onFechar}
      linkCadastroCompleto={link} mensagemSucesso={edicao.mensagemSucesso}
      extra={aberto ? edicao.extra?.(id) : undefined}
      acaoSecundaria={acao ? { rotulo: acao.rotulo, onClick: () => { onFechar(); acao.onClick(); } } : undefined}
    />
  );
}

/**
 * Lápis + painel para editar um item que NÃO está num seletor: o cliente da OS aberta, o equipamento de uma
 * lista, a linha de um documento. Mesma regra do seletor: sem a permissão, nada aparece; registro fechado,
 * cadeado com o motivo no ⓘ.
 */
export function EditarNoContexto({ id, edicao, rotulo, className, comMoldura }: {
  id: string; edicao: EdicaoDoSelecionado; rotulo: string; className?: string;
  /** Ao lado de um campo de formulário: o lápis com a moldura e a altura do campo */
  comMoldura?: boolean;
}) {
  const pode = usePodeCriar(edicao.permissao);
  const [aberto, setAberto] = useState(false);
  if (!pode || !id) return null;
  const link = typeof edicao.linkCadastroCompleto === "function" ? edicao.linkCadastroCompleto(id) : edicao.linkCadastroCompleto;
  return (
    <>
      <BotaoEditarNoContexto rotulo={rotulo} travado={edicao.travado} onClick={() => setAberto(true)} className={className} compacto={!comMoldura} />
      {!edicao.travado && <PainelDaEdicao id={id} edicao={edicao} aberto={aberto} onFechar={() => setAberto(false)} link={link} />}
    </>
  );
}

/* ───────── Editar no contexto ───────── */
/**
 * O lápis de "editar aqui mesmo". Registro fechado: vira cadeado (desabilitado) com o motivo no ⓘ.
 * Quem decide se ele aparece é quem chama (permissão e item selecionado).
 */
export function BotaoEditarNoContexto({ rotulo, travado, onClick, className, compacto }: {
  rotulo: string; travado?: string | null; onClick: () => void; className?: string;
  /** Dentro de uma lista ou de uma linha: sem a moldura do campo (o do seletor acompanha a altura dele) */
  compacto?: boolean;
}) {
  const classe = compacto
    ? "shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg"
    : "shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-lg border border-surface-campo bg-white";
  if (travado) {
    return (
      <span className={cn("inline-flex items-center gap-0.5 shrink-0", className)} data-edicao-travada>
        <button type="button" disabled aria-label={`${rotulo}: edição travada`} className={cn(classe, "text-ink-subtle cursor-not-allowed", !compacto && "bg-surface-alt")} data-editar-no-contexto>
          <Lock className="w-4 h-4" aria-hidden />
        </button>
        <Dica texto={travado} rotulo="Edição travada" lado="esquerda" />
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={rotulo} title={rotulo} data-editar-no-contexto
      className={cn(classe, "text-ink-muted hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-acento/40", compacto ? "hover:bg-primary-50" : "hover:border-primary-300", className)}>
      <Pencil className="w-4 h-4" aria-hidden />
    </button>
  );
}

/**
 * A faixa que diz até onde a mudança chega (referência: em todo lugar; uso: só aqui). Com `rotulo`, diz
 * também o que está sendo editado — para o editor que não é o painel (ex.: os materiais de um item).
 */
export function FaixaDaEdicao({ escopo, rotulo, className }: { escopo: EscopoEdicao; rotulo?: string; className?: string }) {
  return (
    <div data-faixa-edicao={escopo}
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2",
        escopo === "referencia" ? "border-atencao/30 bg-atencao-claro text-atencao-texto" : "border-surface-border bg-surface-alt text-ink", className)}>
      {escopo === "referencia" ? <Layers className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> : <MapPin className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />}
      <p className="text-sm font-medium">
        {rotulo && <span data-rotulo-edicao>{rotulo}. </span>}
        <span data-alcance-edicao>{alcanceDaEdicao(escopo)}</span>
      </p>
    </div>
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
  /** Busca os valores atuais ao abrir (quando a tela não os tem): "Carregando…" até chegar */
  carregar?: () => Promise<Record<string, string>>;
  /** Mais uma parte do mesmo cadastro, abaixo dos campos */
  extra?: React.ReactNode;
  /** Uma edição mais a fundo que continua nesta tela */
  acaoSecundaria?: { rotulo: string; onClick: () => void };
}) {
  const { aberto, onFechar, escopo, alvo, campos, salvar, onSalvo, linkCadastroCompleto, mensagemSucesso, travado, carregar, extra, acaoSecundaria } = props;
  const titulo = rotuloDaEdicao(escopo, alvo);
  // Valores buscados ao abrir (o cadastro que a tela não tinha carregado)
  const [buscados, setBuscados] = useState<Record<string, string> | null>(null);
  const [erroBusca, setErroBusca] = useState("");
  useEffect(() => {
    if (!aberto || !carregar || travado) return;
    let vivo = true;
    setBuscados(null); setErroBusca("");
    carregar().then((v) => { if (vivo) setBuscados(v); }).catch((e) => { if (vivo) setErroBusca(e instanceof Error && e.message ? e.message : "Não foi possível carregar o cadastro."); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);
  const valores = carregar ? buscados ?? {} : props.valores;
  // O título do painel já diz O QUE está sendo editado; a faixa diz até onde a mudança chega
  const faixa = <FaixaDaEdicao escopo={escopo} className="-mt-1" />;
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
  if (carregar && !buscados) {
    return (
      <Modal aberto={aberto} onFechar={onFechar} titulo={titulo} tamanho="sm">
        <div className="space-y-4" data-edicao-carregando>
          {faixa}
          {erroBusca
            ? <p role="alert" className="text-sm text-atrasado bg-atrasado-claro border border-atrasado/20 rounded-lg px-3 py-2">{erroBusca}</p>
            : <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Carregando…</p>}
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
      modo="editar" faixa={faixa} rotuloSalvar="Salvar" extra={extra} acaoSecundaria={acaoSecundaria}
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
  aberto, onFechar, titulo, contexto, campos, criar, linkCadastroCompleto, valoresIniciais, onCriado, rotuloSalvar, modo = "criar", faixa, extra, acaoSecundaria,
}: {
  aberto: boolean; onFechar: () => void; titulo: string; contexto?: string;
  campos: CampoRapido[]; criar: Props["criar"]; linkCadastroCompleto?: string;
  valoresIniciais: Record<string, string>; onCriado: (o: OpcaoCadastro) => void; rotuloSalvar?: string;
  /** "editar": manda também os campos esvaziados (limpar um campo é uma mudança) */
  modo?: "criar" | "editar";
  /** O que vem antes dos campos (na edição: a faixa que diz o que está sendo editado) */
  faixa?: React.ReactNode;
  /** O que vem depois dos botões (outra parte do mesmo cadastro, que grava por conta própria) */
  extra?: React.ReactNode;
  acaoSecundaria?: { rotulo: string; onClick: () => void };
}) {
  const [valores, setValores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [faltando, setFaltando] = useState<Set<string>>(new Set());
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [consultando, setConsultando] = useState<string | null>(null);
  const valoresRef = useRef(valores);
  valoresRef.current = valores;
  const [notaConsulta, setNotaConsulta] = useState<{ campo: string; texto: string; erro?: boolean } | null>(null);

  // Reinicia a cada abertura (com o texto da busca, se houver)
  useEffect(() => {
    if (aberto) { setValores(valoresIniciais); setErro(""); setFaltando(new Set()); setNotaConsulta(null); setConsultando(null); }
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

  /** A consulta do campo sugere os outros: só entra no que está vazio, e a tela diz o que entrou */
  async function consultar(c: CampoRapido) {
    if (!c.consulta || consultando) return;
    setConsultando(c.nome); setNotaConsulta(null);
    try {
      const sugestao = await c.consulta.buscar(valores[c.nome] ?? "");
      const outros = campos.filter((x) => x.nome !== c.nome);
      // Os valores do momento em que a resposta chega: o que foi digitado durante a consulta fica
      const r = aplicarSugestao(valoresRef.current, sugestao, outros.map((x) => x.nome));
      setValores(r.valores);
      setNotaConsulta({ campo: c.nome, texto: notaDaSugestao(r.preenchidos, Object.fromEntries(outros.map((x) => [x.nome, x.label])), c.consulta.origem) });
      setFaltando((f) => { const n = new Set(f); for (const k of r.preenchidos) n.delete(k); return n; });
    } catch (e) {
      setNotaConsulta({ campo: c.nome, texto: e instanceof Error && e.message ? e.message : "Não foi possível consultar. Preencha à mão.", erro: true });
    } finally { setConsultando(null); }
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
                <span className={c.consulta && c.consulta.disponivel?.(valores) !== false ? "flex gap-2" : undefined}>
                <input
                  autoFocus={i === 0}
                  value={valores[c.nome] ?? ""}
                  onChange={(e) => { set(c.nome, e.target.value); if (c.tipo === "cep") buscarCep(e.target.value); }}
                  placeholder={c.placeholder} maxLength={c.maxLength ?? (c.tipo === "cep" ? 9 : undefined)}
                  inputMode={c.tipo === "cep" ? "numeric" : c.inputMode}
                  className={cn(inputCls, faltando.has(c.nome) && "border-atrasado/40 focus:border-atrasado focus:ring-atrasado/10")}
                />
                {c.consulta && c.consulta.disponivel?.(valores) !== false && (
                  <button type="button" onClick={() => void consultar(c)} disabled={!!consultando || !c.consulta.pronto(valores[c.nome] ?? "")} data-consultar={c.nome}
                    title={c.consulta.pronto(valores[c.nome] ?? "") ? `Consultar: ${c.consulta.origem.toLowerCase()}` : "Preencha o campo para consultar"}
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 text-sm font-medium rounded-lg border border-surface-border text-ink hover:bg-surface-alt disabled:opacity-50 disabled:hover:bg-transparent">
                    {consultando === c.nome ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Search className="w-4 h-4" aria-hidden />} Consultar
                  </button>
                )}
                </span>
              )}
              {notaConsulta?.campo === c.nome && (
                <span role="status" data-nota-consulta={notaConsulta.erro ? "erro" : "ok"} className={cn("block text-xs mt-1", notaConsulta.erro ? "text-atrasado" : "text-ink-muted")}>{notaConsulta.texto}</span>
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
          ) : acaoSecundaria ? (
            <button type="button" onClick={acaoSecundaria.onClick} data-acao-secundaria className="self-start inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
              {acaoSecundaria.rotulo}
            </button>
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
        {extra && <div className="border-t border-surface-border pt-4" data-extra-edicao>{extra}</div>}
      </div>
    </Modal>
  );
}
