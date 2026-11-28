"use client";

/**
 * ERRO NO CAMPO — o padrão único de validação de TODO formulário (escritório, portal e app do técnico).
 *
 *   const f = useErrosDoFormulario({ abaDoCampo: { cep: "enderecos" }, abrirAba: setAba });
 *   <ErrosDoFormulario valor={f}>
 *     <form ref={f.ref} …>
 *       <ResumoDeErros />                         ← a faixa do topo: só o resumo
 *       <FormField name="cpfCnpj" formato="cnpj" label="CNPJ"><Input … /></FormField>
 *
 *  - O erro mora no campo: FormField com `name` lê o erro daqui, marca o controle (borda vermelha, aria-invalid,
 *    aria-describedby) e mostra a mensagem curta logo abaixo; o rótulo não muda de cor.
 *  - Ao tentar salvar com erro: `f.validar({...})` / `f.erroDaApi(corpo)` marcam os campos e `focar()` rola a tela
 *    e dá foco no primeiro campo com erro — abrindo a aba (`data-aba-painel` + `abrirAba`), a seção recolhida
 *    (`data-secao-recolhida` + `abrirSecao`) ou o <details> em que ele está.
 *  - O erro some assim que a pessoa corrige (FormField limpa ao digitar; o de formato, quando o formato fica certo).
 *  - Com react-hook-form: passe `rhf: formState.errors` — os erros do zod entram no mesmo lugar.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { camposDoRhf, errosPorAba, lerErroDaApi, limparCampos, resumoDosErros, type ErrosDeCampo, type EstadoErros } from "@/lib/forms/erros";

export interface ErrosFormulario {
  /** Todos os erros de campo (os do react-hook-form + os da tela/servidor) */
  campos: ErrosDeCampo;
  /** O erro que não é de campo nenhum */
  geral: string | null;
  temErros: boolean;
  erroDe: (nome: string) => string | undefined;
  /** Troca todos os erros (campos + geral) */
  definir: (campos: ErrosDeCampo, geral?: string | null) => void;
  /** Marca (ou, com null, limpa) um campo */
  definirCampo: (nome: string, mensagem: string | null) => void;
  limpar: (nome: string) => void;
  limparTudo: () => void;
  /** Só o erro geral (ex.: "Erro de conexão.") — mantém os de campo */
  definirGeral: (mensagem: string | null) => void;
  /** Marca os erros e, havendo algum, rola e foca o primeiro. Devolve true quando NÃO há erro (pode seguir). */
  validar: (campos: ErrosDeCampo, geral?: string | null) => boolean;
  /** A resposta de erro da API ({ erro, campos } ou o `detalhes` do zod) vai para os campos e foca o primeiro */
  erroDaApi: (corpo: unknown, padrao?: string) => EstadoErros;
  /** Rola e foca o primeiro campo com erro (ou `nome`); sem campo, a faixa do topo */
  focar: (nome?: string) => void;
  /** Quantos erros em cada aba */
  porAba: Record<string, number>;
  /** A raiz do formulário (o <form> ou o corpo da gaveta) */
  ref: (el: HTMLElement | null) => void;
  /** Rótulo de cada campo (o FormField registra) — para o resumo */
  rotuloDe: (nome: string) => string | undefined;
  registrarRotulo: (nome: string, rotulo: string) => void;
  /** A ordem em que os campos apareceram na tela */
  ordem: () => string[];
}

export interface OpcoesErros {
  /** Erros do react-hook-form (formState.errors) */
  rhf?: unknown;
  /** Campo → aba (para o indicador da aba e para abrir a aba de um campo que nem está montado) */
  abaDoCampo?: Record<string, string> | ((nome: string) => string | undefined | null);
  /** Abre a aba (o mesmo setAba da tela) */
  abrirAba?: (aba: string) => void;
  /** Abre a seção recolhida/gaveta: recebe o `data-secao-recolhida` ou, se o campo nem está montado, o nome dele */
  abrirSecao?: (secaoOuCampo: string) => void;
}

const Ctx = createContext<ErrosFormulario | null>(null);
export const useErrosCtx = () => useContext(Ctx);

export function ErrosDoFormulario({ valor, children }: { valor: ErrosFormulario; children: ReactNode }) {
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

const seletorNome = (nome: string) => `[data-campo-nome="${nome.replace(/["\\]/g, "\\$&")}"]`;
const FOCAVEL = 'input:not([type="hidden"]):not([aria-hidden="true"]), select, textarea, button:not([aria-hidden="true"]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function escondido(el: Element) {
  const h = el as HTMLElement;
  return h.hidden || h.classList.contains("hidden") || h.getAttribute("aria-hidden") === "true" || h.style?.display === "none";
}

/** O controle focável do campo (o próprio elemento, ou o primeiro de dentro) */
function focavelDe(el: Element): HTMLElement | null {
  if (el.matches(FOCAVEL) && !(el as HTMLInputElement).disabled) return el as HTMLElement;
  const invalido = el.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (invalido && invalido.matches(FOCAVEL)) return invalido;
  return el.querySelector<HTMLElement>(FOCAVEL);
}

/** Rola até o elemento (no meio da tela) e dá foco sem pular de novo */
export function rolarEFocar(el: HTMLElement) {
  try { el.scrollIntoView?.({ block: "center", behavior: "smooth" }); } catch { el.scrollIntoView?.(); }
  try { el.focus({ preventScroll: true }); } catch { el.focus(); }
}

export function useErrosDoFormulario(opcoes: OpcoesErros = {}): ErrosFormulario {
  const [proprios, setProprios] = useState<ErrosDeCampo>({});
  const [geral, setGeral] = useState<string | null>(null);
  const [pedido, setPedido] = useState<{ n: number; alvo?: string }>({ n: 0 });
  const [abaDom, setAbaDom] = useState<Record<string, string>>({});
  const raiz = useRef<HTMLElement | null>(null);
  const rotulos = useRef<Map<string, string>>(new Map());
  const op = useRef(opcoes);
  op.current = opcoes;

  // O react-hook-form MUDA o mesmo objeto `errors` (não troca a referência): compara pelo conteúdo, a cada render
  const rhfAgora = camposDoRhf(opcoes.rhf);
  const chaveRhf = JSON.stringify(rhfAgora);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doRhf = useMemo(() => rhfAgora, [chaveRhf]);
  const campos = useMemo(() => ({ ...doRhf, ...proprios }), [doRhf, proprios]);
  const camposRef = useRef(campos);
  camposRef.current = campos;

  const abaDoMapa = useCallback((nome: string) => {
    const m = op.current.abaDoCampo;
    return (typeof m === "function" ? m(nome) : m?.[nome]) ?? undefined;
  }, []);
  const abaDe = useCallback((nome: string) => abaDoMapa(nome) ?? abaDom[nome], [abaDoMapa, abaDom]);
  const porAba = useMemo(() => errosPorAba(campos, abaDe), [campos, abaDe]);

  // A aba de cada campo com erro, pelo lugar dele na tela (o mapa explícito ganha)
  useLayoutEffect(() => {
    const r = raiz.current;
    if (!r) return;
    const novo: Record<string, string> = {};
    for (const nome of Object.keys(campos)) {
      const aba = r.querySelector(seletorNome(nome))?.closest<HTMLElement>("[data-aba-painel]")?.dataset.abaPainel;
      if (aba) novo[nome] = aba;
    }
    setAbaDom((a) => (JSON.stringify(a) === JSON.stringify(novo) ? a : novo));
  }, [campos]);

  const focar = useCallback((alvo?: string) => setPedido((p) => ({ n: p.n + 1, alvo })), []);

  // O foco acontece depois de a tela mostrar os erros; abrir aba/seção pede mais uma volta
  useEffect(() => {
    if (!pedido.n) return;
    let cancelado = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tentar = (volta: number) => {
      if (cancelado) return;
      const de = () => (volta < 6 ? (timer = setTimeout(() => tentar(volta + 1), 30), true) : false);
      const r = raiz.current ?? (typeof document !== "undefined" ? document.body : null);
      if (!r) return;
      const nomes = Object.keys(camposRef.current);
      let el: Element | null = null;
      if (pedido.alvo) el = r.querySelector(seletorNome(pedido.alvo));
      // O primeiro, na ordem da tela: o FormField que mostra erro, ou um controle marcado fora de um FormField
      if (!el) el = r.querySelector('[data-campo-com-erro], [aria-invalid="true"]');
      if (!el) {
        // O campo nem está na tela (aba ou seção que só monta quando abre): abre pelo mapa e tenta de novo
        const nome = pedido.alvo ?? nomes[0];
        if (nome) {
          const aba = abaDoMapa(nome);
          if (aba) op.current.abrirAba?.(aba);
          op.current.abrirSecao?.(nome);
          if ((aba || op.current.abrirSecao) && de()) return;
        }
        const faixa = r.querySelector<HTMLElement>("[data-resumo-erros]") ?? document.querySelector<HTMLElement>("[data-resumo-erros]");
        if (faixa) rolarEFocar(faixa);
        return;
      }
      const painel = el.closest<HTMLElement>("[data-aba-painel]");
      if (painel && escondido(painel)) { op.current.abrirAba?.(painel.dataset.abaPainel!); if (de()) return; }
      const secao = el.closest<HTMLElement>("[data-secao-recolhida]");
      if (secao && escondido(secao)) { op.current.abrirSecao?.(secao.dataset.secaoRecolhida!); if (de()) return; }
      for (let d = el.closest("details:not([open])"); d; d = d.parentElement?.closest("details:not([open])") ?? null) (d as HTMLDetailsElement).open = true;
      const alvoFoco = focavelDe(el);
      if (alvoFoco) rolarEFocar(alvoFoco);
    };
    timer = setTimeout(() => tentar(0), 0);
    return () => { cancelado = true; if (timer) clearTimeout(timer); };
  }, [pedido, abaDoMapa]);

  const definir = useCallback((c: ErrosDeCampo, g: string | null = null) => { setProprios(limparCampos(c)); setGeral(g?.trim() || null); }, []);
  const definirCampo = useCallback((nome: string, m: string | null) => {
    setProprios((p) => {
      if (m) return p[nome] === m ? p : { ...p, [nome]: m };
      if (!(nome in p)) return p;
      const { [nome]: _, ...resto } = p;
      return resto;
    });
  }, []);
  const limpar = useCallback((nome: string) => definirCampo(nome, null), [definirCampo]);
  const limparTudo = useCallback(() => { setProprios({}); setGeral(null); }, []);
  const definirGeral = useCallback((m: string | null) => setGeral(m?.trim() || null), []);
  const validar = useCallback((c: ErrosDeCampo, g: string | null = null) => {
    const limpos = limparCampos(c);
    definir(limpos, g);
    const ok = !Object.keys(limpos).length && !g && !Object.keys(camposDoRhf(op.current.rhf)).length;
    if (!ok) focar();
    return ok;
  }, [definir, focar]);
  const erroDaApi = useCallback((corpo: unknown, padrao?: string) => {
    const e = lerErroDaApi(corpo, padrao);
    definir(e.campos, e.geral);
    focar();
    return e;
  }, [definir, focar]);

  const ref = useCallback((el: HTMLElement | null) => { raiz.current = el; }, []);
  const registrarRotulo = useCallback((nome: string, rotulo: string) => { if (!rotulos.current.has(nome) || rotulos.current.get(nome) !== rotulo) rotulos.current.set(nome, rotulo); }, []);
  const rotuloDe = useCallback((nome: string) => rotulos.current.get(nome), []);
  const ordem = useCallback(() => Array.from(rotulos.current.keys()), []);
  const erroDe = useCallback((nome: string) => campos[nome], [campos]);

  return useMemo(() => ({
    campos, geral, temErros: !!geral || Object.keys(campos).length > 0, erroDe, definir, definirCampo, limpar, limparTudo, definirGeral,
    validar, erroDaApi, focar, porAba, ref, rotuloDe, registrarRotulo, ordem,
  }), [campos, geral, erroDe, definir, definirCampo, limpar, limparTudo, definirGeral, validar, erroDaApi, focar, porAba, ref, rotuloDe, registrarRotulo, ordem]);
}

/**
 * A FAIXA DO TOPO — só o resumo: o erro que não é de campo; um erro de campo sozinho repete o texto dele; mais de
 * um vira "N campos para corrigir" com o nome de cada um (toque leva ao campo). Sem erro, não aparece.
 */
export function ResumoDeErros({ erros, className }: { erros?: ErrosFormulario | null; className?: string }) {
  const ctx = useErrosCtx();
  const f = erros ?? ctx;
  if (!f) return null;
  const r = resumoDosErros({ geral: f.geral, campos: f.campos }, f.ordem());
  if (!r) return null;
  const lista = r.itens.length > 1 || (r.quantos && r.itens.length);
  return (
    <div
      role="alert" tabIndex={-1} data-resumo-erros
      className={cn("bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-atrasado/40", className)}
    >
      <p className="flex items-start gap-2 font-medium">
        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
        <span className="min-w-0 break-words">{r.texto}</span>
      </p>
      {lista ? (
        <div className="mt-1 pl-6 flex flex-wrap items-center gap-x-1 gap-y-0.5" data-resumo-campos>
          {r.quantos && <span className="mr-1">{r.quantos}:</span>}
          {r.itens.map((i, k) => (
            <span key={i.campo} className="inline-flex items-center">
              <button
                type="button" onClick={() => f.focar(i.campo)} data-ir-campo={i.campo}
                className="min-h-[44px] sm:min-h-0 sm:py-0.5 underline underline-offset-2 decoration-atrasado/40 hover:decoration-atrasado text-left"
              >
                {f.rotuloDe(i.campo) ?? i.mensagem}
              </button>
              {k < r.itens.length - 1 && <span aria-hidden className="mx-1 text-atrasado/60">·</span>}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** O indicador de erro da aba: ponto vermelho com a contagem (e o texto para leitor de tela) */
export function IndicadorErroAba({ n }: { n?: number }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-atrasado text-white text-[10px] font-semibold leading-none" data-erro-aba={n}>
      {n}<span className="sr-only">{n === 1 ? " erro" : " erros"}</span>
    </span>
  );
}
