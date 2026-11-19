/**
 * ANOTAÇÕES INTERNAS — a ANCORAGEM do ponto exato. É o coração da ferramenta: prender a nota a um
 * elemento e reencontrá-lo depois, sobrevivendo a mudança de layout e degradando bem.
 *
 * O QUE FOI DESCARTADO, E POR QUÊ:
 *   • seletor CSS gerado (`div.flex.items-center > button`): as classes são Tailwind e mudam a cada
 *     ajuste visual — quebraria na primeira refatoração;
 *   • XPath / nth-child desde o <body>: qualquer <div> nova no meio invalida tudo;
 *   • só o texto do elemento: "Editar" aparece dezenas de vezes na mesma tela;
 *   • pixel absoluto: morre com qualquer mudança de layout, e o sistema é responsivo.
 *
 * O QUE SE USA: a malha de `data-*` que o sistema JÁ TEM espalhada (mais de 2.200 atributos
 * estáticos, postos pelos testes). Eles descrevem O QUE a coisa é, não ONDE está — por isso
 * sobrevivem a redesenho. A âncora é composta por quatro camadas que degradam uma na outra
 * (ver `Ancora` em regras.ts), e o reencontro devolve três precisões possíveis:
 *
 *   exata       achou a âncora e o índice             → pin no lugar
 *   aproximada  achou a âncora (índice mudou) OU      → pin com selo "o lugar mudou"
 *               achou pelo texto+papel do elemento
 *   perdida     não achou nada                        → SEM pin; a anotação fica na lista,
 *                                                       marcada, abrindo o print
 *
 * A anotação nunca se perde: ela muda de estado.
 *
 * Este arquivo mexe em DOM, então só roda no navegador (e no happy-dom dos testes). Nada de banco.
 */
import { ANCORA_VAZIA, ROTULO_MAX, type Ancora, type Precisao } from "@/lib/anotacoes/regras";

/** Quantos níveis subir procurando um marco semântico antes de desistir. */
const MAX_SUBIDA = 10;
/** Quantos níveis do caminho relativo guardar (mais que isso é frágil e não ajuda). */
const MAX_CAMINHO = 4;

/** Atributos que NÃO são marco semântico: estado de UI, framework, estilo. */
const IGNORADOS = new Set([
  "data-state", "data-side", "data-align", "data-orientation", "data-disabled",
  "data-highlighted", "data-radix-scroll-area-viewport", "data-slot", "data-testid-ignore",
  "data-reactroot", "data-nextjs-scroll-focus-boundary",
]);

/** O valor do atributo parece id de registro? Então ele não serve como parte da chave. */
function valorInstavel(v: string): boolean {
  if (!v) return true;
  if (v.length > 40) return true;
  if (/^\d+$/.test(v)) return true;
  if (/^c[a-z0-9]{20,}$/i.test(v)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true;
  return false;
}

/**
 * A chave semântica de UM elemento, ou null se ele não tem marco.
 *
 * `data-secao="materiais"` → `data-secao=materiais` (atributo + valor: o mais preciso)
 * `data-equipamento-vinculado="cmwb…"` → `data-equipamento-vinculado` (só o nome: o valor é um id
 *      de registro e amanhã é outro — mas o atributo em si continua dizendo o que aquilo é)
 * `data-os-separacao` (sem valor) → `data-os-separacao`
 * `id="conteudo-scroll"` → `#conteudo-scroll`
 */
export function chaveDoElemento(el: Element): string | null {
  for (const attr of Array.from(el.attributes)) {
    const nome = attr.name;
    if (!nome.startsWith("data-") || IGNORADOS.has(nome)) continue;
    const valor = (attr.value ?? "").trim();
    if (!valor || valor === "true" || valorInstavel(valor)) return nome;
    return `${nome}=${valor}`;
  }
  const id = el.getAttribute("id");
  if (id && !valorInstavel(id)) return `#${id}`;
  return null;
}

/** A chave virada em seletor CSS, com o valor escapado. */
export function seletorDaChave(chave: string): string {
  if (chave.startsWith("#")) return `[id="${chave.slice(1).replace(/"/g, '\\"')}"]`;
  const i = chave.indexOf("=");
  if (i < 0) return `[${chave}]`;
  return `[${chave.slice(0, i)}="${chave.slice(i + 1).replace(/"/g, '\\"')}"]`;
}

const textoCurto = (el: Element): string | null => {
  const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > ROTULO_MAX ? `${t.slice(0, ROTULO_MAX - 1)}…` : t;
};

/** tag + o papel acessível, quando houver: o "que tipo de coisa" é o elemento. */
function papelDoElemento(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  const aria = el.getAttribute("aria-label");
  const tipo = el.getAttribute("type");
  const extra = [role && `role=${role}`, tipo && `type=${tipo}`, aria && `aria=${aria.slice(0, 40)}`].filter(Boolean);
  return extra.length ? `${tag} ${extra.join(" ")}` : tag;
}

const indiceEntreIrmaos = (el: Element): number => {
  const pai = el.parentElement;
  if (!pai) return 1;
  let n = 0;
  for (const filho of Array.from(pai.children)) {
    if (filho.tagName === el.tagName) {
      n += 1;
      if (filho === el) return n;
    }
  }
  return 1;
};

/** O caminho de `de` até `para` (descendente), curto e sem classes: "div>ul>li:nth-of-type(3)". */
function caminhoRelativo(de: Element, para: Element): string | null {
  const passos: string[] = [];
  let atual: Element | null = para;
  while (atual && atual !== de && passos.length < MAX_CAMINHO) {
    const n = indiceEntreIrmaos(atual);
    passos.unshift(n > 1 ? `${atual.tagName.toLowerCase()}:nth-of-type(${n})` : atual.tagName.toLowerCase());
    atual = atual.parentElement;
  }
  if (atual !== de) return null; // ficou longe demais: o caminho não ajudaria
  return passos.length ? passos.join(">") : null;
}

/** O retângulo do elemento, tolerante a ambiente sem layout (happy-dom devolve zeros). */
function retangulo(el: Element): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect?.();
  return { left: r?.left ?? 0, top: r?.top ?? 0, width: r?.width ?? 0, height: r?.height ?? 0 };
}

/**
 * Constrói a âncora a partir do elemento clicado e do ponto do clique (coordenadas de viewport).
 * Sobe até MAX_SUBIDA níveis procurando o marco semântico mais próximo.
 */
export function ancorarElemento(alvo: Element, clientX: number, clientY: number): Ancora {
  const doc = alvo.ownerDocument;
  const win = doc?.defaultView;

  let ancoraEl: Element | null = null;
  let chave: string | null = null;
  let atual: Element | null = alvo;
  for (let i = 0; atual && i < MAX_SUBIDA; i += 1) {
    const c = chaveDoElemento(atual);
    if (c) { ancoraEl = atual; chave = c; break; }
    atual = atual.parentElement;
  }

  const base = ancoraEl ?? alvo;
  const r = retangulo(base);
  const fx = r.width > 0 ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : null;
  const fy = r.height > 0 ? Math.min(1, Math.max(0, (clientY - r.top) / r.height)) : null;

  let ancoraIndice = 0;
  if (chave && doc) {
    const iguais = Array.from(doc.querySelectorAll(seletorDaChave(chave)));
    ancoraIndice = Math.max(0, iguais.indexOf(base));
  }

  return {
    ancora: chave,
    ancoraIndice,
    caminho: ancoraEl && ancoraEl !== alvo ? caminhoRelativo(ancoraEl, alvo) : null,
    rotulo: textoCurto(alvo),
    papel: papelDoElemento(alvo),
    fx, fy,
    x: Math.round(clientX + (win?.scrollX ?? 0)),
    y: Math.round(clientY + (win?.scrollY ?? 0)),
    viewportW: win?.innerWidth ?? null,
  };
}

export interface Reencontro {
  /** O elemento em que o pin vai pousar (null quando a âncora se perdeu) */
  elemento: Element | null;
  precisao: Precisao;
}

/** Acha o primeiro elemento cujo texto e papel batem com a identidade guardada. */
function porIdentidade(doc: Document, a: Ancora): Element | null {
  if (!a.rotulo) return null;
  const tag = (a.papel ?? "").split(" ")[0] || "*";
  const candidatos = Array.from(doc.querySelectorAll(tag || "*"));
  return candidatos.find((el) => textoCurto(el) === a.rotulo) ?? null;
}

/**
 * Reencontra o ponto na tela de hoje. Esta é a função que faz a anotação não virar órfã:
 * tenta a âncora exata, depois a âncora sem o índice, depois a identidade do elemento — e, se
 * nada bate, devolve "perdida" (a tela não mostra pin; a lista mostra a anotação com o print).
 */
export function reencontrar(doc: Document, a: Ancora): Reencontro {
  if (a.ancora) {
    const iguais = Array.from(doc.querySelectorAll(seletorDaChave(a.ancora)));
    if (iguais.length) {
      const exato = iguais[a.ancoraIndice] ?? null;
      const base = exato ?? iguais[0];
      // o caminho relativo refina para o elemento de dentro, quando ele ainda existe
      const fino = a.caminho ? base.querySelector(a.caminho) : null;
      return { elemento: fino ?? base, precisao: exato ? "exata" : "aproximada" };
    }
  }
  const porTexto = porIdentidade(doc, a);
  if (porTexto) return { elemento: porTexto, precisao: "aproximada" };
  return { elemento: null, precisao: "perdida" };
}

/**
 * Onde desenhar o pin, em coordenadas de viewport: a fração guardada aplicada ao retângulo de
 * HOJE do elemento. É isto que faz o pin acompanhar o elemento quando ele muda de tamanho.
 */
export function pontoDoPin(el: Element, a: Ancora): { left: number; top: number } {
  const r = retangulo(el);
  return {
    left: r.left + r.width * (a.fx ?? 0.5),
    top: r.top + r.height * (a.fy ?? 0.5),
  };
}
