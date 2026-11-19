/**
 * ANOTAÇÕES INTERNAS — as regras PURAS (sem DOM, sem banco): a chave da tela, os status, os
 * limites e o texto do exportar. Serve ao servidor e ao navegador, e é o que os testes puros
 * cobrem. O que mexe em elemento de verdade mora em `lib/anotacoes/ancora.ts` (só no cliente).
 */

/* ───────── status ───────── */

export const STATUS_ANOTACAO = ["aberta", "feita", "descartada"] as const;
export type StatusAnotacao = (typeof STATUS_ANOTACAO)[number];

export const ROTULO_STATUS: Record<StatusAnotacao, string> = {
  aberta: "Aberta",
  feita: "Feita",
  descartada: "Descartada",
};

export const ehStatusAnotacao = (v: unknown): v is StatusAnotacao =>
  typeof v === "string" && (STATUS_ANOTACAO as readonly string[]).includes(v);

/** "Feita" e "descartada" carimbam a data de resolução; voltar para "aberta" limpa o carimbo. */
export const resolveStatus = (status: StatusAnotacao, agora: Date): Date | null =>
  status === "aberta" ? null : agora;

/* ───────── limites ───────── */

export const TEXTO_MAX = 2000;
/** Teto do print já reduzido no navegador (data URL). Acima disto a anotação salva SEM print. */
export const PRINT_MAX_BYTES = 400 * 1024;
/** Quantas anotações a tela lê de uma vez (não há paginação na fase 1, de propósito). */
export const LIMITE_LISTA = 500;
/** Até onde o texto do elemento é guardado como identidade da âncora. */
export const ROTULO_MAX = 80;

/* ───────── a âncora (o dado que viaja entre o navegador e o banco) ───────── */

/**
 * O ponto exato, preso ao elemento em quatro camadas que degradam uma na outra. O detalhe de como
 * cada uma é lida do DOM está em `ancora.ts`; aqui fica só a forma do dado.
 */
export interface Ancora {
  /** Camada 2: o marco semântico mais próximo do clique — `data-secao=materiais` ou `#id` */
  ancora: string | null;
  /** …e o índice entre os irmãos de mesma chave (data-cartao aparece 17x numa tela) */
  ancoraIndice: number;
  /** Camada 3: caminho curto RELATIVO à âncora (até 4 níveis) */
  caminho: string | null;
  /** Camada 3: o texto do elemento clicado — o que mais sobrevive a refatoração */
  rotulo: string | null;
  /** Camada 3: tag + role/aria-label */
  papel: string | null;
  /** Camada 4: o clique em fração do retângulo da âncora (0..1) */
  fx: number | null;
  fy: number | null;
  /** Último recurso: posição absoluta no documento e a largura da viewport de então */
  x: number | null;
  y: number | null;
  viewportW: number | null;
}

export const ANCORA_VAZIA: Ancora = {
  ancora: null, ancoraIndice: 0, caminho: null, rotulo: null, papel: null,
  fx: null, fy: null, x: null, y: null, viewportW: null,
};

/** Quão bem a anotação foi reencontrada na tela de hoje. */
export type Precisao = "exata" | "aproximada" | "perdida";

export const ROTULO_PRECISAO: Record<Precisao, string> = {
  exata: "No lugar",
  aproximada: "O lugar mudou",
  perdida: "Âncora perdida",
};

/* ───────── a chave da TELA ───────── */

/**
 * Um segmento da rota é identificador de registro? (cuid, uuid, número ou token comprido)
 * É o que faz `/ordens/cmwb…/` e `/ordens/outro…/` virarem a MESMA tela na lista.
 */
export function ehSegmentoDeId(seg: string): boolean {
  if (!seg) return false;
  if (/^\d+$/.test(seg)) return true;                              // 123
  if (/^c[a-z0-9]{20,}$/i.test(seg)) return true;                  // cuid
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true; // uuid
  if (/^[A-Za-z0-9_-]{16,}$/.test(seg) && /\d/.test(seg)) return true; // token/id comprido com dígito
  return false;
}

/** Os parâmetros de URL que fazem parte da IDENTIDADE da tela (aba e gaveta abertas). */
export const PARAMS_DA_TELA = ["aba", "secao"] as const;

/**
 * A chave da tela: o caminho com os ids trocados por ":id", mais a aba/gaveta aberta.
 *
 *   /ordens/cmwb123?aba=materiais&q=gas  →  /ordens/:id?aba=materiais
 *   /configuracoes?aba=conta&secao=modulos → /configuracoes?aba=conta&secao=modulos
 *
 * É isto que agrupa a lista "Minhas anotações": por TELA, não por registro — e a aba entra porque
 * "OS › Materiais" e "OS › Atividades" são telas diferentes para quem vai mexer no código.
 * Os filtros (busca, página, ordem) ficam fora: não mudam a tela, só o conteúdo dela.
 */
export function telaDaRota(pathname: string, busca?: string): string {
  const caminho = (pathname || "/").split("?")[0].split("#")[0];
  const normalizado = caminho
    .split("/")
    .map((seg) => (ehSegmentoDeId(seg) ? ":id" : seg))
    .join("/") || "/";
  const limpo = normalizado.length > 1 ? normalizado.replace(/\/+$/, "") : normalizado;
  if (!busca) return limpo;
  const p = new URLSearchParams(busca.startsWith("?") ? busca.slice(1) : busca);
  const partes = PARAMS_DA_TELA.map((k) => (p.get(k) ? `${k}=${p.get(k)}` : null)).filter(Boolean);
  return partes.length ? `${limpo}?${partes.join("&")}` : limpo;
}

/* ───────── o exportar (Markdown, para virar prompt) ───────── */

export interface AnotacaoParaExportar {
  tela: string;
  tituloTela: string | null;
  rotulo: string | null;
  texto: string;
  status: string;
  criadoEm: Date | string;
  rota: string;
}

const dia = (d: Date | string) => {
  const data = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(data.getTime()) ? "" : data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};

/**
 * O texto do exportar: Markdown agrupado por tela, pronto para colar como prompt.
 *
 * O print NÃO vai aqui de propósito — ele congela a tela com dado real de cliente dentro, e o
 * texto exportado circula. Quem quiser a imagem abre a anotação.
 */
export function exportarMarkdown(anotacoes: AnotacaoParaExportar[], agora = new Date()): string {
  if (!anotacoes.length) return "# Anotações internas\n\nNenhuma anotação.\n";
  const porTela = new Map<string, AnotacaoParaExportar[]>();
  for (const a of anotacoes) {
    const lista = porTela.get(a.tela) ?? [];
    lista.push(a);
    porTela.set(a.tela, lista);
  }
  const linhas: string[] = ["# Anotações internas", "", `Exportado em ${dia(agora)} · ${anotacoes.length} anotação(ões)`, ""];
  for (const [tela, itens] of porTela) {
    const titulo = itens.find((i) => i.tituloTela)?.tituloTela;
    linhas.push(`## ${titulo ? `${titulo} — ` : ""}\`${tela}\``, "");
    for (const a of itens) {
      const marca = a.status === "feita" ? "[x]" : "[ ]";
      const onde = a.rotulo ? ` **${a.rotulo}** —` : "";
      linhas.push(`- ${marca}${onde} ${a.texto.trim().replace(/\s*\n\s*/g, " ")}`);
      linhas.push(`  - ${ROTULO_STATUS[a.status as StatusAnotacao] ?? a.status} · ${dia(a.criadoEm)} · \`${a.rota}\``);
    }
    linhas.push("");
  }
  return linhas.join("\n");
}
