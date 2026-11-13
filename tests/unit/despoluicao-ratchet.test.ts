/**
 * Ratchet da despoluição (manifesto, princípios 3 e 10; Princípio 7 de UX).
 *
 * Varre o código de UI (components/, app/, lib/cadastros, lib/navegacao, lib/permissoes.ts; fora
 * testes) e conta, por arquivo, as violações de cada categoria:
 *   emoji        emoji ou dingbat (✓ ✔ ✅ …) em string de UI — inclui ícones de módulo em emoji
 *   hex          cor crua: hex fora de lib/ui/tokens.ts, classe arbitrária bg-[#…], paleta solta do Tailwind
 *   informal     tom de assistente em texto de UI ("Pronto!", "Vamos", "Olá,", "Bem-vindo", "você", "pra"…)
 *   exclamacao   texto de UI terminado em "!" (toasts, títulos de sucesso)
 *   titleCase    título/rótulo em Title Case ("Contas a Receber") onde a regra é caixa de frase
 *   textoLongo   texto de instrução inline ≥ 110 caracteres (JSX, description/hint/placeholder…) que
 *                deveria estar na ⓘ (as props dica/ajuda/texto da Dica NÃO contam: é o lugar certo)
 *
 * O baseline (tests/unit/despoluicao-baseline.json) congelou as violações conhecidas no diagnóstico de
 * 2026-11-08 e foi encolhendo onda a onda. Desde a Onda 7 ele está FECHADO: `arquivos` é vazio e só
 * ficam as `excecoes` documentadas (arquivo → { n, motivo }): nomes próprios, textos gravados como valor,
 * templates cujo comprimento é o código. O teste falha quando:
 *   - um arquivo tem MAIS violações de uma categoria que o permitido (violação nova → corrigir o código);
 *   - um arquivo tem MENOS que a exceção diz (a limpeza aconteceu → encolher a exceção);
 *   - `arquivos` deixa de ser vazio (`npm run despoluicao:baseline` regrava; o que não for exceção é bug).
 * Exceção nova só com `motivo` escrito e revisão no PR.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const BASELINE = path.join(__dirname, "despoluicao-baseline.json");
const ATUALIZAR = process.env.DESPOLUICAO_BASELINE === "atualizar";

export const ESCOPO = ["components", "app", "lib/cadastros", "lib/navegacao", "lib/permissoes.ts"];
// Fora do escopo: páginas públicas institucionais (Privacidade, FAQ, Termos). Elas diagramam texto
// jurídico e de FAQ OFICIAL, de leitura longa e em registro público (2ª pessoa, "você"). Não são a
// UI do produto que o ratchet guarda — os princípios 3 e 10 miram as telas internas; aqui o
// comprimento e o tom são o próprio conteúdo, como a "cena" escura da calculadora é exceção de marca.
// Pelo mesmo motivo, a home de vendas ("/"): o texto é a copy de marketing do briefing, em 2ª pessoa
// ("você", "pra") e com frases de venda; cor e forma seguem os tokens como no resto do sistema.
export const IGNORADOS = ["app/(publico)/(institucional)", "app/(publico)/(marketing)", "components/marketing"];
export const CATEGORIAS = ["emoji", "hex", "informal", "exclamacao", "titleCase", "textoLongo"] as const;
export type Categoria = (typeof CATEGORIAS)[number];
export interface Violacao { linha: number; trecho: string }

// ── Detectores ──────────────────────────────────────────────────────────────────────────────

// Emoji (©, ® e ™ são tipográficos) e os dingbats que viram "emoji" na tela (✓ ✔ ✅ ❌ ✖ ⭐ …)
const EMOJI = /(?![©®™])\p{Extended_Pictographic}|[✓✔✅❌✖⭐⬆⬇➡⬅➕➖]/gu;
// Hex que não é branco/preto puro; classe arbitrária com hex; paleta solta do Tailwind
const HEX = /#(?!(?:fff(?:fff)?|000(?:000)?)\b)[0-9A-Fa-f]{6}(?![\w-])|#(?!(?:fff|000)\b)[0-9A-Fa-f]{3}(?![\w-])/gi;
const COR_SOLTA = /\b(?:bg|text|border|ring|divide|fill|stroke|outline|accent|placeholder|decoration|shadow|from|via|to)-(?:gray|slate|zinc|neutral|stone|red|amber|orange|yellow|green|emerald|blue|sky|cyan|indigo|violet|purple|fuchsia|pink|rose|teal|lime)-\d{2,3}\b/g;
// Marcadores de tom informal / de assistente (só em texto de UI). `\b` do JS não entende acento
// (em "você " não há borda depois do ê): a borda é feita à mão com lookarounds.
const w = (p: string, flags = "") => new RegExp(`(?<![\\wÀ-ú])(?:${p})(?![\\wÀ-ú])`, flags);
const INFORMAL = [
  w("Pronto[!:.]?"), w("Vamos"), w("Olá"), w("Oi"), w("Bem-vind[oa]s?", "i"), w("Tudo certo"), w("Tudo pronto"), w("Bom trabalho"),
  w("Parabéns"), w("Ótimo"), w("Legal"), w("Uau"), w("Eba"), w("Oba"), w("Opa"), w("incrível", "i"), w("perfeito", "i"), w("super", "i"),
  w("vocês?", "i"), w("pra"), w("tá"), w("não se preocupe", "i"), w("fique tranquil[oa]", "i"),
  w("Clique aqui", "i"), w("basta", "i"), w("simplesmente", "i"), w("facilmente", "i"),
  w("Dica:"), w("Atenção!"), w("Importante:"), w("Nota:"), w("Obs\\.?:"), w("Lembre-se"), w("Não esqueça", "i"), w("Aproveite"), w("Experimente"), w("Descubra"),
];
// Title Case: 2+ palavras capitalizadas (com conectivo opcional), sem sigla; nomes próprios ficam de fora
const PALAVRA = "[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+";
const CONECTIVO = "(?:de|da|do|das|dos|e|a|o|em|por|para|com|ao|à|no|na|ou)";
const TITLE_CASE = new RegExp(`^${PALAVRA}(?: ${CONECTIVO})? ${PALAVRA}(?: (?:${CONECTIVO} )?${PALAVRA})*(?: \\([A-Z]{2,}\\))?$`);
const NOMES_PROPRIOS = /^(?:Banco Inter|Conta Azul|Client (?:ID|Secret)|Google (?:Maps|Agenda)|Plug ?Notas|Nota Fiscal Eletr[ôo]nica|Meu Dia)$/;
// Props de texto inline (fora da ⓘ) que não deveriam passar de uma linha
const PROPS_INLINE = /\b(?:description|descricao|hint|placeholder|mensagem|subtitulo|subtitle|legenda|label|rotulo|aviso)\s*[:=]\s*\{?\s*(?:"([^"\n]{110,})"|'([^'\n]{110,})'|`([^`]{110,})`)/g;
const LIMITE_TEXTO = 110;

/** Tira comentários (blocos e linhas inteiras) e imports — neles não há texto de UI. */
function semRuido(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[ \t]*\/\/.*$/gm, (m) => " ".repeat(m.length))
    .replace(/^[ \t]*import\b[^\n]*$/gm, (m) => " ".repeat(m.length));
}
const linhaDe = (src: string, indice: number) => src.slice(0, indice).split("\n").length;
const resumo = (t: string) => t.replace(/\s+/g, " ").trim().slice(0, 90);

/** Textos de UI: nós de texto JSX e literais de string (fora className e afins). */
function textosDeUi(src: string): { texto: string; indice: number; atributo: string | null }[] {
  const out: { texto: string; indice: number; atributo: string | null }[] = [];
  const re = /(?:\b([A-Za-z_][\w-]*)\s*[:=]\s*\{?\s*)?(?:"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`)|(?<=[\w"'}\]])>([^<>{}]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const atributo = m[1] ?? null;
    const texto = m[2] ?? m[3] ?? m[4] ?? m[5] ?? "";
    if (atributo && /^(?:className|class|href|src|id|key|type|name|accept|rel|target|htmlFor|style|variant|size|lado|align|method|action|role|viewBox|d|fill|stroke|d|path|url|slug|cor|color|font|icone|icon|data-[\w-]+|aria-(?!label|description)[\w-]+)$/.test(atributo)) continue;
    if (texto.trim().length < 2) continue;
    out.push({ texto, indice: m.index + m[0].indexOf(texto), atributo });
  }
  return out;
}

/**
 * O literal é texto que o usuário lê? Fora: código capturado entre ">" e "<", classes do Tailwind,
 * CSS/SQL embutidos, caminhos e chaves de objeto. `${…}` vira um marcador antes do exame.
 */
export function ehTextoDeUi(t: string): boolean {
  const s = t.replace(/\$\{[^}]*\}/g, "X");
  if (!/[A-Za-zÀ-ú]{3,}\s+[A-Za-zÀ-ú]/.test(s)) return false; // pelo menos duas palavras
  if (/^[\w./:@?&=#%-]+$/.test(s) || /^\s*[\[{(.,;)]/.test(s)) return false;
  if (/[{}]|=>|&&|\|\||===|!==|\bconst\b|\breturn\b|\bawait\b|\bfunction\b|\bnull\b|\bundefined\b|\.\w+\(|\b(?:SELECT|FROM|WHERE|INSERT|UPDATE|DELETE)\b|@media|@page|!important/.test(s)) return false;
  // Classes do Tailwind: a maioria dos termos tem "-" ou ":" (prosa quase nunca)
  const termos = s.split(/\s+/);
  if (termos.filter((x) => /[-:\[\]/]/.test(x) && /^[a-z0-9:\-\[\]\/.%!()#,_]+$/i.test(x)).length >= Math.max(2, termos.length * 0.5)) return false;
  return true;
}

export function analisar(src: string): Record<Categoria, Violacao[]> {
  const limpo = semRuido(src);
  const v: Record<Categoria, Violacao[]> = { emoji: [], hex: [], informal: [], exclamacao: [], titleCase: [], textoLongo: [] };
  let m: RegExpExecArray | null;

  for (const re of [EMOJI, HEX, COR_SOLTA]) {
    re.lastIndex = 0;
    while ((m = re.exec(limpo))) {
      const linhaInicio = limpo.lastIndexOf("\n", m.index) + 1;
      const linhaFim = limpo.indexOf("\n", m.index);
      const trecho = resumo(limpo.slice(linhaInicio, linhaFim < 0 ? undefined : linhaFim));
      (re === EMOJI ? v.emoji : v.hex).push({ linha: linhaDe(limpo, m.index), trecho });
    }
  }

  for (const { texto, indice, atributo } of textosDeUi(limpo)) {
    const linha = linhaDe(limpo, indice);
    const t = texto.trim();
    const pareceTexto = ehTextoDeUi(t);
    if (pareceTexto) {
      for (const re of INFORMAL) if (re.test(t)) { v.informal.push({ linha, trecho: resumo(t) }); break; }
      if (/[A-Za-zÀ-ú)}]!\s*$/.test(t)) v.exclamacao.push({ linha, trecho: resumo(t) });
    }
    if ((atributo === null || /^(?:title|label|rotulo|titulo|texto|aria-label)$/.test(atributo)) && !NOMES_PROPRIOS.test(t) && TITLE_CASE.test(t)) {
      v.titleCase.push({ linha, trecho: resumo(t) });
    }
    if (atributo === null && t.length >= LIMITE_TEXTO && pareceTexto) v.textoLongo.push({ linha, trecho: resumo(t) });
  }
  PROPS_INLINE.lastIndex = 0;
  while ((m = PROPS_INLINE.exec(limpo))) {
    const t = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (t.length >= LIMITE_TEXTO && ehTextoDeUi(t)) v.textoLongo.push({ linha: linhaDe(limpo, m.index), trecho: resumo(t) });
  }
  // Uma só entrada por linha em cada categoria
  for (const c of CATEGORIAS) {
    const vistas = new Set<number>();
    v[c] = v[c].filter((x) => (vistas.has(x.linha) ? false : (vistas.add(x.linha), true)));
  }
  return v;
}

// ── Varredura ────────────────────────────────────────────────────────────────────────────────

function listar(rel: string): string[] {
  if (IGNORADOS.some((p) => rel === p || rel.startsWith(p + "/"))) return [];
  const abs = path.join(RAIZ, rel);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [rel];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "node_modules" || e.name.startsWith(".")) return [];
    const r = path.posix.join(rel, e.name);
    if (e.isDirectory()) return listar(r);
    return /\.(?:tsx?|jsx?)$/.test(e.name) && !/\.(?:test|spec)\.|\.d\.ts$/.test(e.name) ? [r] : [];
  });
}
export const arquivosDoEscopo = () => ESCOPO.flatMap(listar).sort();

type Baseline = Record<Categoria, Record<string, number>>;
type Excecoes = Record<Categoria, Record<string, { n: number; motivo: string }>>;
type Contagem = Record<string, number>;
interface Diferenca { arquivo: string; n: number; permitido: number }
/** A regra do ratchet, pura: acima do baseline é violação nova; abaixo (ou arquivo sumido) é baseline a encolher. */
export function compararComBaseline(atual: Contagem, base: Contagem): { novas: Diferenca[]; desatualizados: Diferenca[] } {
  const novas = Object.entries(atual).filter(([f, n]) => n > (base[f] ?? 0)).map(([f, n]) => ({ arquivo: f, n, permitido: base[f] ?? 0 }));
  const desatualizados = Object.entries(base).filter(([f, p]) => (atual[f] ?? 0) < p).map(([f, p]) => ({ arquivo: f, n: atual[f] ?? 0, permitido: p }));
  return { novas, desatualizados };
}
function lerBaseline(): { arquivos: Baseline; excecoes: Excecoes } {
  const vazio = () => Object.fromEntries(CATEGORIAS.map((c) => [c, {}]));
  if (!existsSync(BASELINE)) return { arquivos: vazio() as Baseline, excecoes: vazio() as Excecoes };
  const j = JSON.parse(readFileSync(BASELINE, "utf8"));
  return { arquivos: { ...vazio(), ...(j.arquivos ?? {}) } as Baseline, excecoes: { ...vazio(), ...(j.excecoes ?? {}) } as Excecoes };
}
/** Permitido por arquivo = baseline (legado) ou exceção documentada. */
const permitidos = (arquivos: Baseline, excecoes: Excecoes, c: Categoria): Record<string, number> =>
  ({ ...Object.fromEntries(Object.entries(excecoes[c]).map(([f, e]) => [f, e.n])), ...arquivos[c] });

describe("despoluição: ratchet dos padrões do manifesto", () => {
  const arquivos = arquivosDoEscopo();
  const atual = Object.fromEntries(CATEGORIAS.map((c) => [c, {} as Record<string, number>])) as Baseline;
  const detalhes = new Map<string, Record<Categoria, Violacao[]>>();
  for (const f of arquivos) {
    const v = analisar(readFileSync(path.join(RAIZ, f), "utf8"));
    detalhes.set(f, v);
    for (const c of CATEGORIAS) if (v[c].length) atual[c][f] = v[c].length;
  }
  const totais = Object.fromEntries(CATEGORIAS.map((c) => [c, Object.values(atual[c]).reduce((a, b) => a + b, 0)]));

  it("varre o código de UI de verdade", () => {
    expect(arquivos.length).toBeGreaterThan(500);
    expect(arquivos).toContain("components/ui/dica.tsx");
    expect(arquivos).toContain("lib/permissoes.ts");
    expect(arquivos.some((f) => f.includes(".test."))).toBe(false);
  });

  if (ATUALIZAR) {
    it("regrava o baseline com o estado atual (DESPOLUICAO_BASELINE=atualizar); as exceções ficam", () => {
      const { excecoes } = lerBaseline();
      // Arquivo coberto por exceção só entra em `arquivos` se passou do que a exceção permite (violação nova)
      const ordenado = Object.fromEntries(CATEGORIAS.map((c) => [c, Object.fromEntries(Object.entries(atual[c]).filter(([f, n]) => !(f in excecoes[c]) || n > excecoes[c][f].n).sort(([a], [b]) => a.localeCompare(b)))]));
      const totaisFora = Object.fromEntries(CATEGORIAS.map((c) => [c, Object.values(ordenado[c]).reduce((a, b) => a + (b as number), 0)]));
      const totaisExcecoes = Object.fromEntries(CATEGORIAS.map((c) => [c, Object.values(excecoes[c]).reduce((a, e) => a + e.n, 0)]));
      writeFileSync(BASELINE, JSON.stringify({ geradoEm: new Date().toISOString().slice(0, 10), totais: totaisFora, totaisExcecoes, arquivos: ordenado, excecoes }, null, 1) + "\n");
      expect(existsSync(BASELINE)).toBe(true);
    });
    return;
  }

  const { arquivos: base, excecoes } = lerBaseline();
  it.each(CATEGORIAS)("%s: nenhuma violação nova fora do baseline", (c) => {
    const novas = compararComBaseline(atual[c], permitidos(base, excecoes, c)).novas.map(({ arquivo: f, n, permitido }) => {
      const lista = detalhes.get(f)![c].map((x) => `    ${f}:${x.linha}  ${x.trecho}`).join("\n");
      return `  ${f}: ${n} (baseline ${permitido})\n${lista}`;
    });
    expect(novas, `Violações NOVAS de "${c}" (corrija o código; o baseline não sobe):\n${novas.join("\n")}`).toEqual([]);
  });

  it.each(CATEGORIAS)("%s: o baseline acompanha a limpeza (só anda para baixo)", (c) => {
    const desatualizados = compararComBaseline(atual[c], permitidos(base, excecoes, c)).desatualizados.map(({ arquivo: f, n, permitido }) => `  ${f}: agora ${n}, baseline ${permitido}`);
    expect(desatualizados, `Baseline de "${c}" desatualizado — a limpeza aconteceu, encolha o baseline com \`npm run despoluicao:baseline\`:\n${desatualizados.join("\n")}`).toEqual([]);
  });

  it("os totais gravados batem com a soma por arquivo (o arquivo não foi editado à mão)", () => {
    const gravado = JSON.parse(readFileSync(BASELINE, "utf8"));
    for (const c of CATEGORIAS) {
      expect(gravado.totais[c]).toBe(Object.values(base[c]).reduce((a, b) => a + b, 0));
      expect(gravado.totaisExcecoes[c]).toBe(Object.values(excecoes[c]).reduce((a, e) => a + e.n, 0));
    }
  });

  it("baseline fechado (Onda 7): fora das exceções documentadas, nenhuma violação", () => {
    const sobras = CATEGORIAS.flatMap((c) => Object.entries(base[c]).map(([f, n]) => `  ${c} ${f}: ${n}`));
    expect(sobras, `Violações fora das exceções (corrija o código ou documente uma exceção com motivo):\n${sobras.join("\n")}`).toEqual([]);
  });

  it("cada exceção tem motivo escrito, n > 0 e bate com o real (nem mais, nem menos)", () => {
    for (const c of CATEGORIAS) {
      for (const [f, e] of Object.entries(excecoes[c])) {
        expect(typeof e.motivo === "string" && e.motivo.trim().length >= 15, `${c} ${f}: motivo`).toBe(true);
        expect(e.n, `${c} ${f}: n`).toBeGreaterThan(0);
        expect(atual[c][f] ?? 0, `${c} ${f}: real × exceção`).toBe(e.n);
      }
    }
  });
});

// ── A regra do ratchet em si (para ninguém afrouxar sem perceber) ──
describe("regra do ratchet", () => {
  it("acima do baseline (ou arquivo novo) é violação nova; igual passa", () => {
    expect(compararComBaseline({ "a.tsx": 2, "b.tsx": 1, "c.tsx": 3 }, { "a.tsx": 1, "c.tsx": 3 }).novas)
      .toEqual([{ arquivo: "a.tsx", n: 2, permitido: 1 }, { arquivo: "b.tsx", n: 1, permitido: 0 }]);
  });
  it("abaixo do baseline (ou arquivo que sumiu) exige encolher o baseline", () => {
    expect(compararComBaseline({ "a.tsx": 1 }, { "a.tsx": 2, "c.tsx": 1 }).desatualizados)
      .toEqual([{ arquivo: "a.tsx", n: 1, permitido: 2 }, { arquivo: "c.tsx", n: 0, permitido: 1 }]);
    expect(compararComBaseline({ "a.tsx": 2 }, { "a.tsx": 2 })).toEqual({ novas: [], desatualizados: [] });
  });
});

// ── Os detectores em si ──
describe("detectores", () => {
  const um = (src: string) => Object.fromEntries(Object.entries(analisar(src)).map(([c, v]) => [c, v.length]));
  it("emoji e dingbat; ⓘ, ©, •, › e — passam", () => {
    expect(um(`const a = "Foto ✓";`).emoji).toBe(1);
    expect(um(`{ icone: "📋" }`).emoji).toBe(1);
    expect(um(`<p>ⓘ © • › — →</p>`).emoji).toBe(0);
  });
  it("hex cru e paleta solta; branco/preto puros passam; comentário não conta", () => {
    expect(um(`const C = ["#0EA5E9", "#10B981"];`).hex).toBe(1); // uma entrada por linha
    expect(um(`<div className="bg-[#F8FAFC] text-slate-500" />`).hex).toBe(1);
    expect(um(`style={{ color: "#FFFFFF", background: "#000" }}`).hex).toBe(0);
    expect(um(`// cor antiga #14498F\nconst x = 1;`).hex).toBe(0);
  });
  it("tom informal e exclamação em texto de UI; className e import não contam", () => {
    expect(um(`toast("Contrato cadastrado!");`).exclamacao).toBe(1);
    expect(um(`<h2>Senha criada!</h2>`).exclamacao).toBe(1);
    expect(um(`toast("Contrato salvo.");`).exclamacao).toBe(0);
    expect(um(`<p>Informe o e-mail que você usa. Vamos mandar um link pra você.</p>`).informal).toBe(1); // uma por linha
    expect(um(`import { TabelaPro } from "@/components/listagem/tabela-pro";\n<div className="!mt-0 pro" />`)).toMatchObject({ informal: 0, exclamacao: 0 });
    expect(um(`<p>Somente leitura: requer a permissão Equipes › editar.</p>`).informal).toBe(0);
  });
  it("Title Case em título/rótulo; caixa de frase, sigla e nome próprio passam", () => {
    expect(um(`<h1 className="page-title">Contas a Receber</h1>`).titleCase).toBe(1);
    expect(um(`<FormField label="Perfil de Acesso" />`).titleCase).toBe(1);
    expect(um(`<h4>Registrar Pedido de Compra (PC)</h4>`).titleCase).toBe(1);
    expect(um(`<h1>Contas a receber</h1><span>Banco Inter</span><h2>Ordens de serviço (OS)</h2>`).titleCase).toBe(0);
  });
  it("texto inline ≥ 110 c; a mesma frase em dica/ajuda (a ⓘ) passa", () => {
    const longo = "Todo dia de manhã o sistema confere os contratos com esta chave ligada: no dia de faturamento, cria a medição do contrato e segue.";
    expect(um(`<p className="text-xs text-ink-muted">${longo}</p>`).textoLongo).toBe(1);
    expect(um(`<FormField description="${longo}" />`).textoLongo).toBe(1);
    expect(um(`<FormField dica="${longo}" />\n<Dica texto="${longo}" />\n<CadastroPadrao ajuda="${longo}" />`).textoLongo).toBe(0);
    expect(um(`<p>Em branco, assume o separado.</p>`).textoLongo).toBe(0);
    // código entre ">" e "<", classes do Tailwind e CSS embutido não são texto de UI
    expect(um(`const n = itens.filter((i) => i.quantidade > 0 && i.descricao.length < 200 && !i.removido && i.tipo === "PRODUTO").length; const txt = "a" <b></b>`).textoLongo).toBe(0);
    expect(um("className={cn(`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium border border-surface-border hover:bg-surface-page focus-visible:ring-2`)}").textoLongo).toBe(0);
    expect(um("<style>{`@page { size: A4; margin: 1.5cm; } @media print { body { background: white; } .pagina { page-break-after: always; } .cabecalho { display: none; } }`}</style>").textoLongo).toBe(0);
  });
});
