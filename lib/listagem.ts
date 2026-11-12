/**
 * Utilitários comuns das listagens paginadas no servidor (Equipamentos, Veículos, Clientes,
 * cadastros padronizados…). Arquivo puro: usado no servidor (leitura da URL) e no cliente.
 *  - paginação: ?pagina= (1, 2, …) e ?por= (25/50/100) — sempre com limite;
 *  - ordenação: ?ordem=&dir= só por colunas da LISTA BRANCA de cada tela (nada de orderBy livre),
 *    sempre com `id` no fim (desempate estável: a paginação não repete nem pula registro);
 *  - sugestões da busca: as ~5 que mais combinam (igual > começa com > palavra começa > contém).
 * Os nomes dos parâmetros são os que a seleção em massa ignora ao montar o filtro
 * (components/acoes-massa/selecao.tsx › PARAMS_PAGINACAO): trocar de página não muda o filtro.
 */
export const TAMANHOS_PAGINA = [25, 50, 100] as const;
export const TAMANHO_PADRAO = 50;
export const MAX_SUGESTOES = 5;
/** Preferência de itens por página do usuário (vale para todas as listas, neste navegador) */
export const CHAVE_TAMANHO_PAGINA = "frivo:listas:por";

export type ParamsUrl = Record<string, string | string[] | undefined>;

/** Primeiro valor de um parâmetro da URL ("" quando ausente). */
export const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** URLSearchParams → objeto simples (rotas de API usam os mesmos leitores das páginas). */
export const paramsDe = (sp: URLSearchParams): ParamsUrl => Object.fromEntries(sp.entries());

/** Tamanho válido (25/50/100); qualquer outra coisa = padrão. */
export function lerTamanho(v: unknown): number {
  const n = Number(v);
  return (TAMANHOS_PAGINA as readonly number[]).includes(n) ? n : TAMANHO_PADRAO;
}

/** Página (≥1) e itens por página (25/50/100; padrão 50). Aceita também ?page=&pageSize= (API). */
export function lerPaginacao(sp: ParamsUrl): { pagina: number; porPagina: number } {
  const p = Math.floor(Number(um(sp.pagina) || um(sp.page)));
  return {
    pagina: Number.isFinite(p) && p >= 1 ? Math.min(p, 100000) : 1,
    porPagina: lerTamanho(um(sp.por) || um(sp.pageSize)),
  };
}

/** Pedido paginado? (sem ?pagina/?por a rota genérica mantém o formato antigo: lista inteira) */
export const pediuPaginacao = (sp: ParamsUrl) => ["pagina", "por", "page", "pageSize"].some((k) => um(sp[k]) !== "");

/** Página que existe: se a busca encolheu o total, volta para a última página com itens. */
export function paginaValida(pagina: number, porPagina: number, total: number) {
  return Math.min(Math.max(1, pagina), Math.max(1, Math.ceil(total / porPagina)));
}

/** skip/take do Prisma para a página (já ajustada ao total). */
export const janela = (pagina: number, porPagina: number) => ({ skip: (pagina - 1) * porPagina, take: porPagina });

/** "Mostrando 26–50 de 312" */
export function faixa(pagina: number, porPagina: number, total: number) {
  if (total <= 0) return { de: 0, ate: 0 };
  return { de: Math.min((pagina - 1) * porPagina + 1, total), ate: Math.min(pagina * porPagina, total) };
}

/** Números de página para a navegação: 1 … 4 5 [6] 7 8 … 20 (null = reticências). */
export function paginasVisiveis(atual: number, totalPaginas: number, vizinhos = 1): (number | null)[] {
  if (totalPaginas <= 1) return [1];
  const set = new Set<number>([1, totalPaginas]);
  for (let i = atual - vizinhos; i <= atual + vizinhos; i++) if (i >= 1 && i <= totalPaginas) set.add(i);
  const ordenadas = [...set].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  ordenadas.forEach((n, i) => {
    const salto = i > 0 ? n - ordenadas[i - 1] : 1;
    if (salto === 2) out.push(n - 1); // um número só no buraco: mostra o número, não "…"
    else if (salto > 2) out.push(null);
    out.push(n);
  });
  return out;
}

/* ───────── Ordenação ───────── */
export type Direcao = "asc" | "desc";
/** Coluna ordenável → orderBy do Prisma para a direção. */
export type MapaOrdem = Record<string, (dir: Direcao) => unknown>;
export interface Ordem { campo: string | null; dir: Direcao }

/** ?ordem=&dir=: só aceita colunas do mapa; o resto vira "sem ordem escolhida" (usa o padrão da tela). */
export function lerOrdem(sp: ParamsUrl, mapa: MapaOrdem): Ordem {
  const campo = um(sp.ordem);
  return {
    campo: campo && Object.prototype.hasOwnProperty.call(mapa, campo) ? campo : null,
    dir: um(sp.dir) === "desc" ? "desc" : "asc",
  };
}

/** orderBy final: a coluna escolhida (ou o padrão) + `id` para desempate estável. */
export function ordemPrisma(o: Ordem, mapa: MapaOrdem, padrao: unknown): unknown[] {
  const base = o.campo ? mapa[o.campo](o.dir) : padrao;
  return [...(Array.isArray(base) ? base : [base]), { id: "asc" }];
}

/** Clique no cabeçalho: mesma coluna inverte; outra coluna começa em asc. */
export function proximaOrdem(atual: Ordem, campo: string): Ordem {
  return atual.campo === campo ? { campo, dir: atual.dir === "asc" ? "desc" : "asc" } : { campo, dir: "asc" };
}

/* ───────── Busca ───────── */
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * CNPJ/CPF gravados COM máscara: quem digita só os números ("11222333") também acha
 * ("11.222.333/0001-81"). Devolve as formas mascaradas parciais (CNPJ e CPF) do que foi digitado.
 */
export function variantesDocumento(q: string): string[] {
  const d = q.replace(/\D/g, "");
  if (d.length < 3 || /[^\d.\-/\s]/.test(q.trim())) return [];
  const mascara = (m: string) => {
    let out = "", i = 0;
    for (const c of m) { if (i >= d.length) break; if (c === "#") out += d[i++]; else out += c; }
    return out.replace(/[^\d]+$/, "");
  };
  return [...new Set([mascara("##.###.###/####-##"), mascara("###.###.###-##"), d])].filter((v) => v !== q.trim());
}

/** Quanto o rótulo combina com a busca (maior = melhor; 0 = não combina). */
export function pontuar(rotulo: string, q: string): number {
  const r = semAcento(rotulo), b = semAcento(q);
  if (!b) return 0;
  if (r === b) return 4;
  if (r.startsWith(b)) return 3;
  if (r.split(/[\s\-/.,&()]+/).some((p) => p.startsWith(b))) return 2;
  return r.includes(b) ? 1 : 0;
}

export interface Sugestao { id: string; rotulo: string; detalhe?: string | null; href?: string | null }

/** As que mais combinam (empate: ordem alfabética). Achada só por outro campo (ex.: CNPJ) vem depois. */
export function ranquearSugestoes<T extends Sugestao>(itens: T[], q: string, max = MAX_SUGESTOES): T[] {
  return itens
    .map((s) => ({ s, p: Math.max(pontuar(s.rotulo, q), s.detalhe ? pontuar(s.detalhe, q) - 0.5 : 0) }))
    .sort((a, b) => b.p - a.p || a.s.rotulo.localeCompare(b.s.rotulo, "pt-BR"))
    .slice(0, max)
    .map((x) => x.s);
}
