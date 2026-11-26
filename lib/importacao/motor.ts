/**
 * Importação em massa por planilha — MOTOR ÚNICO (puro, sem banco). Cada cadastro só declara as
 * colunas e como validar uma linha (lib/importacao/entidades.ts); o motor faz o resto, igual para todos:
 *  - lê o cabeçalho (nome exato do modelo ou apelidos; sem acento/maiúsculas), ignora o que não reconhece;
 *  - valida linha a linha — uma linha com erro NUNCA derruba as outras;
 *  - deduplica: dentro da planilha (a 2ª ocorrência vira erro) e contra o cadastro DA EMPRESA
 *    (achou → "atualizar"; sem permissão de editar → erro explicando). As chaves vêm em ordem de
 *    preferência (id_sistema → código / CNPJ-CPF → nome); duas chaves da mesma linha apontando para
 *    registros DIFERENTES = erro (nunca atualiza o registro errado);
 *  - linha que sumiu da planilha não apaga nada: a importação só cria e atualiza;
 *  - exporta no MESMO formato (as mesmas colunas), para baixar → editar → subir de novo;
 *  - teto de linhas, para não estourar o tempo da requisição;
 *  - LIGAR COLUNAS (de-para): a planilha exportada de outro sistema (cabeçalhos diferentes) é aceita
 *    sem renomear nada — a pessoa liga cada coluna do modelo a uma coluna da planilha; o resto segue
 *    automático. Faltando coluna obrigatória, o erro traz o cabeçalho da planilha para a tela ligar.
 * A gravação fica no servidor (lib/importacao/servidor.ts), que analisa o arquivo DE NOVO ao
 * confirmar — a prévia que o navegador mostrou nunca é a fonte da verdade.
 */
import type { Celula, Tabela } from "@/lib/folha/planilha";
import type { Acao } from "@/lib/permissoes";

export const MAX_LINHAS_IMPORTACAO = 5000;
export const MAX_BYTES_IMPORTACAO = 5 * 1024 * 1024;

export class ErroImportacao extends Error {}

/**
 * Falta coluna obrigatória: além da mensagem, o cabeçalho da planilha e o que o motor já ligou
 * sozinho — a tela mostra o "Ligar colunas" em vez de só recusar.
 */
export class ErroColunas extends ErroImportacao {
  constructor(mensagem: string, readonly ligar: LigacaoColunas) { super(mensagem); }
}

/**
 * De-para escolhido na tela: coluna do modelo → cabeçalho da planilha (texto exato, como veio) ou
 * null ("não importar"). Coluna do modelo fora do mapa segue a ligação automática (título/apelido).
 */
export type Ligacoes = Record<string, string | null>;

/** Para a tela: os cabeçalhos da planilha e a qual coluna do modelo cada um ficou ligado. */
export interface LigacaoColunas {
  cabecalho: string[];
  /** coluna do modelo → cabeçalho da planilha ligado (null = nenhum) */
  ligadas: Record<string, string | null>;
  faltando: string[];
}

/**
 * Lê o mapa de ligações que veio da tela (JSON): só colunas DESTE modelo, valores texto curto ou
 * null. Qualquer coisa fora disso → ErroImportacao (nunca adivinha).
 */
export function lerLigacoes(bruto: unknown, colunas: ColunaImportacao[]): Ligacoes | undefined {
  if (bruto == null || bruto === "") return undefined;
  let v: unknown = bruto;
  if (typeof bruto === "string") { try { v = JSON.parse(bruto); } catch { throw new ErroImportacao("Ligação de colunas inválida."); } }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ErroImportacao("Ligação de colunas inválida.");
  // Só as colunas do modelo (um mapa enorme já tem chave de fora e é recusado na 1ª)
  const entradas = Object.entries(v as Record<string, unknown>);
  const chaves = new Set(colunas.map((c) => c.chave));
  const saida: Ligacoes = {};
  for (const [k, x] of entradas) {
    if (!chaves.has(k)) throw new ErroImportacao(`Ligação de colunas inválida: “${k}” não é uma coluna do modelo.`);
    if (x !== null && (typeof x !== "string" || x.length > 200)) throw new ErroImportacao("Ligação de colunas inválida.");
    saida[k] = x as string | null;
  }
  return saida;
}

export interface ColunaImportacao {
  chave: string;
  /** Cabeçalho no modelo */
  titulo: string;
  obrig?: boolean;
  ajuda: string;
  exemplo: string;
  /** Outros cabeçalhos aceitos (normalizados) */
  apelidos?: string[];
  /** Valores aceitos (aparecem na aba de instruções do modelo) */
  opcoes?: string[];
}

/** Opção de um campo referenciado (unidade, segmento, tabela de preço…): valor gravado + o que se aceita digitar. */
export interface OpcaoRef { valor: string; rotulo: string; aceitos?: string[] }

export interface ContextoImportacao {
  /** Chave de dedup → id do registro existente (SÓ da empresa da sessão) */
  existentes: Map<string, string>;
  /** Opções dos campos referenciados (carregadas do cadastro da empresa) */
  refs: Record<string, OpcaoRef[]>;
  /** O usuário pode editar? Sem isso, duplicado não é atualizado (vira erro). */
  podeAtualizar: boolean;
  /** Permissões do usuário, para campos com permissão própria (ex.: dados fiscais). Ausente = nenhuma. */
  permitido?: (modulo: string, acao: Acao) => boolean;
  /**
   * Vínculos com OUTROS cadastros da empresa (ex.: "clientes": CNPJ/CPF só dígitos → id do cliente;
   * "unidadeDoCliente": id da unidade → id do cliente). Só da empresa da sessão.
   */
  mapas?: Record<string, Map<string, string>>;
}

export type ResultadoLinha =
  /** avisos: a linha ENTRA, mas a pessoa precisa saber (ex.: sem chave, possível duplicado) */
  | { ok: true; dados: Record<string, unknown>; chaves: string[]; rotulo: string; avisos?: string[] }
  | { ok: false; erros: string[]; rotulo: string };

export interface DefImportacao {
  entidade: string;
  singular: string;
  plural: string;
  /** Palavra feminina (unidade): "atualizadas", "cadastradas"… nas frases da tela */
  feminino?: boolean;
  /** "CNPJ/CPF", "nome"… — explica a dedup nas mensagens */
  chaveDescricao: string;
  colunas: ColunaImportacao[];
  /**
   * Chaves que, informadas, PRECISAM existir na empresa (ex.: id_sistema, código do produto): se não
   * existir, a linha vira erro com esta mensagem (nunca cria um registro "novo" com id de outra empresa).
   */
  chavesQueExistem?: { prefixo: string; erro: (valor: string) => string }[];
  /** Exportação: o registro do cadastro → o valor de cada coluna, no formato que a importação lê de volta */
  exportar: (registro: Record<string, unknown>, refs: Record<string, OpcaoRef[]>) => Record<string, string>;
  /**
   * Valida e converte uma linha. `chaves` = chaves de dedup em ordem de preferência (ex.: documento,
   * depois nome); a primeira que existir no cadastro decide o "atualizar". Campos vazios ficam
   * `undefined` (ao atualizar, vazio NUNCA apaga o que já existe).
   */
  validar: (v: Record<string, Celula>, ctx: ContextoImportacao) => ResultadoLinha;
  /**
   * Conferência ENTRE linhas, depois da análise linha a linha (ex.: duas linhas marcando "principal"
   * para o mesmo cliente). Devolve, por número de linha, o erro a aplicar.
   */
  conferirPlanilha?: (linhas: LinhaAnalisada[]) => Map<number, string>;
  /** Avisos ENTRE linhas que não impedem a gravação (ex.: duas linhas iguais sem nº de série). */
  avisarPlanilha?: (linhas: LinhaAnalisada[]) => Map<number, string>;
  /** Aviso fixo da prévia (ex.: "cada cliente novo ganha a unidade Principal"). */
  avisoPrevia?: string;
}

export type StatusLinha = "criar" | "atualizar" | "erro";

export interface LinhaAnalisada {
  /** Número da linha na planilha (1 = cabeçalho) */
  linha: number;
  status: StatusLinha;
  rotulo: string;
  erros: string[];
  /** A linha entra, mas com um aviso para a pessoa revisar */
  avisos?: string[];
  existenteId?: string;
  /** Chave de dedup que casou com o cadastro (ex.: "doc:…", "nome:…") */
  chave?: string;
  dados?: Record<string, unknown>;
  /** Valores originais por coluna do modelo (para a planilha de erros) */
  valores: Record<string, string>;
}

export interface Analise {
  linhas: LinhaAnalisada[];
  resumo: { total: number; criar: number; atualizar: number; erros: number; avisos: number };
  colunasIgnoradas: string[];
  /** Como as colunas ficaram ligadas (a tela mostra e deixa trocar) */
  colunas: LigacaoColunas;
}

/* ───────────────────────── Cabeçalho ───────────────────────── */

export function normalizar(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
/** Para comparar nomes: sem acento, minúsculas, espaços simples. */
export function chaveNome(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Colunas da planilha de erros que o motor aceita de volta sem reclamar */
const COLUNAS_DE_SERVICO = new Set(["linha_original", "motivo_do_erro", "aviso"]);

export function mapearCabecalho(cab: Celula[], colunas: ColunaImportacao[], ligacoes?: Ligacoes) {
  const mapa = new Map<string, number>();
  const usados = new Set<number>();
  const textos = cab.map((c) => (c == null ? "" : String(c).trim()));
  // 1º: o que a pessoa ligou na tela (vence a ligação automática); null = não importar esta coluna
  for (const [chave, alvo] of Object.entries(ligacoes ?? {})) {
    if (alvo === null) continue;
    const i = textos.findIndex((t, j) => t !== "" && t === alvo.trim() && !usados.has(j));
    if (i >= 0) { mapa.set(chave, i); usados.add(i); }
  }
  const desligadas = new Set(Object.entries(ligacoes ?? {}).filter(([, a]) => a === null).map(([k]) => k));
  const ignoradas: string[] = [];
  textos.forEach((t, i) => {
    if (!t || usados.has(i)) return;
    const n = normalizar(t);
    if (!n || COLUNAS_DE_SERVICO.has(n)) return;
    const col = colunas.find((x) => (normalizar(x.titulo) === n || x.chave === n || x.apelidos?.includes(n)) && !mapa.has(x.chave) && !desligadas.has(x.chave) && !(ligacoes && x.chave in ligacoes));
    if (col) { mapa.set(col.chave, i); usados.add(i); }
    else ignoradas.push(t);
  });
  return { mapa, ignoradas };
}

/** Cabeçalho da planilha + a coluna dela ligada a cada coluna do modelo (para a tela de ligar colunas). */
export function ligacaoColunas(cab: Celula[], colunas: ColunaImportacao[], mapa: Map<string, number>): LigacaoColunas {
  const textos = cab.map((c) => (c == null ? "" : String(c).trim()));
  return {
    cabecalho: textos.filter((t) => t !== "" && !COLUNAS_DE_SERVICO.has(normalizar(t))),
    ligadas: Object.fromEntries(colunas.map((c) => [c.chave, mapa.has(c.chave) ? textos[mapa.get(c.chave)!] : null])),
    faltando: colunas.filter((c) => c.obrig && !mapa.has(c.chave)).map((c) => c.titulo),
  };
}

/* ───────────────────────── Leitura de células ───────────────────────── */

const vazia = (v: Celula) => v == null || (typeof v === "string" && v.trim() === "");
export const texto = (v: Celula) => (vazia(v) ? undefined : String(v).trim());

/** Número BR ou EN: "1.234,56", "1234.56", "12,5", 12.5. undefined = vazio; NaN = inválido. */
export function numero(v: Celula): number | undefined {
  if (vazia(v)) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = String(v).trim().replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}

/**
 * Valor de um campo referenciado (unidade, segmento, tabela…): casa pelo valor, rótulo ou apelidos,
 * sem acento/maiúsculas. Não existe → erro listando as opções válidas (nunca cria "lixo").
 */
export function opcao(v: Celula, opcoes: OpcaoRef[], campo: string): { valor?: string; erro?: string } {
  const t = texto(v);
  if (t === undefined) return {};
  const k = chaveNome(t);
  const achou = opcoes.find((o) => [o.valor, o.rotulo, ...(o.aceitos ?? [])].some((x) => chaveNome(x) === k));
  if (achou) return { valor: achou.valor };
  const lista = opcoes.map((o) => o.rotulo).join(", ");
  return { erro: `${campo} “${t}” não existe. Opções válidas: ${lista || "(nenhuma cadastrada)"}.` };
}

/* ───────────────────────── Análise ───────────────────────── */

export function analisar(tabela: Tabela, def: DefImportacao, ctx: ContextoImportacao, ligacoes?: Ligacoes): Analise {
  const iCab = tabela.findIndex((l) => l.some((c) => !vazia(c)));
  if (iCab < 0) throw new ErroImportacao("A planilha está vazia.");
  const { mapa, ignoradas } = mapearCabecalho(tabela[iCab], def.colunas, ligacoes);
  const colunas = ligacaoColunas(tabela[iCab], def.colunas, mapa);
  if (colunas.faltando.length)
    throw new ErroColunas(`Faltam colunas obrigatórias: ${colunas.faltando.join(", ")}. Ligue cada uma a uma coluna da sua planilha (ou baixe o modelo de ${def.plural} e preencha nele).`, colunas);

  const corpo = tabela.slice(iCab + 1).map((l, i) => ({ l, linha: iCab + 2 + i })).filter(({ l }) => l.some((c) => !vazia(c)));
  if (corpo.length === 0) throw new ErroImportacao("A planilha não tem nenhuma linha preenchida abaixo do cabeçalho.");
  if (corpo.length > MAX_LINHAS_IMPORTACAO)
    throw new ErroImportacao(`A planilha tem ${corpo.length} linhas; o limite é ${MAX_LINHAS_IMPORTACAO} por importação. Divida em arquivos menores.`);

  const vistas = new Map<string, number>(); // chave de dedup → primeira linha da planilha
  const linhas: LinhaAnalisada[] = corpo.map(({ l, linha }) => {
    const v: Record<string, Celula> = {};
    const valores: Record<string, string> = {};
    for (const c of def.colunas) {
      const i = mapa.get(c.chave);
      v[c.chave] = i === undefined ? null : l[i] ?? null;
      valores[c.titulo] = v[c.chave] == null ? "" : String(v[c.chave]);
    }
    let r: ResultadoLinha;
    try { r = def.validar(v, ctx); } catch { r = { ok: false, erros: ["Não foi possível ler esta linha."], rotulo: "" }; }
    if (!r.ok) return { linha, status: "erro", rotulo: r.rotulo, erros: r.erros, valores };

    // Repetida na própria planilha (a 1ª ocorrência vale)
    const kRep = r.chaves.find((k) => vistas.has(k));
    if (kRep !== undefined)
      return { linha, status: "erro", rotulo: r.rotulo, erros: [`Repete a linha ${vistas.get(kRep)} (mesmo ${tipoChave(kRep)}).`], valores };
    for (const k of r.chaves) vistas.set(k, linha);

    const naoExiste = def.chavesQueExistem?.map((c) => {
      const k = r.chaves.find((x) => x.startsWith(c.prefixo) && !ctx.existentes.has(x));
      return k ? c.erro(k.slice(c.prefixo.length)) : null;
    }).find(Boolean);
    if (naoExiste) return { linha, status: "erro", rotulo: r.rotulo, erros: [naoExiste], valores };
    // Chaves que casaram com registros DIFERENTES (ex.: id_sistema de um, código de outro): não adivinha
    const achadas = r.chaves.filter((k) => ctx.existentes.has(k));
    if (new Set(achadas.map((k) => ctx.existentes.get(k))).size > 1)
      return { linha, status: "erro", rotulo: r.rotulo, erros: [`Esta linha aponta para ${def.plural} diferentes: ${achadas.map(descreverChave).join(" e ")} são de cadastros distintos. Confira a planilha.`], valores };
    const chave = achadas[0];
    const existenteId = chave ? ctx.existentes.get(chave) : undefined;
    if (existenteId && !ctx.podeAtualizar)
      return { linha, status: "erro", rotulo: r.rotulo, erros: [`Já existe ${def.singular} com este ${tipoChave(chave!)} e você não tem permissão para editar — não dá para atualizar.`], valores };
    return {
      linha, status: existenteId ? "atualizar" : "criar", rotulo: r.rotulo, erros: [], existenteId, chave: existenteId ? chave : undefined, dados: r.dados, valores,
      ...(r.avisos?.length && { avisos: r.avisos }),
    };
  });

  // Conferência entre linhas (ex.: dois "principal" para o mesmo cliente): a linha vira erro
  const extras = def.conferirPlanilha?.(linhas.filter((l) => l.status !== "erro"));
  if (extras?.size)
    for (const l of linhas) {
      const e = extras.get(l.linha);
      if (e) Object.assign(l, { status: "erro" as const, erros: [e], dados: undefined, existenteId: undefined, chave: undefined, avisos: undefined });
    }
  // Avisos entre linhas (não barram): somam aos da própria linha
  const avisosExtras = def.avisarPlanilha?.(linhas.filter((l) => l.status !== "erro"));
  if (avisosExtras?.size)
    for (const l of linhas) {
      const a = avisosExtras.get(l.linha);
      if (a) l.avisos = [...(l.avisos ?? []), a];
    }

  return {
    colunas,
    linhas,
    resumo: {
      total: linhas.length,
      criar: linhas.filter((l) => l.status === "criar").length,
      atualizar: linhas.filter((l) => l.status === "atualizar").length,
      erros: linhas.filter((l) => l.status === "erro").length,
      avisos: linhas.filter((l) => l.status !== "erro" && l.avisos?.length).length,
    },
    colunasIgnoradas: ignoradas,
  };
}

const TIPOS_CHAVE: Record<string, string> = {
  id: "id_sistema", cod: "código", doc: "CNPJ/CPF", nome: "nome", serie: "nº de série", pat: "patrimônio/TAG",
  // Cadastros que vivem DENTRO de um cliente: a chave é "<id do cliente>|<valor>"
  un: "nome de unidade no mesmo cliente", ctmail: "e-mail no mesmo cliente", ctnome: "nome no mesmo cliente",
};
/** "doc:123" → "CNPJ/CPF" (qual chave casou, para as mensagens) */
export const tipoChave = (k: string) => TIPOS_CHAVE[k.slice(0, k.indexOf(":"))] ?? "identificador";
/** "id:abc" → "o id_sistema abc"; "cod:LIMP01" → "o código LIMP01"… */
export const descreverChave = (k: string) => {
  const v = k.slice(k.indexOf(":") + 1);
  return `o ${tipoChave(k)} ${v.includes("|") ? v.slice(v.indexOf("|") + 1) : v}`;
};

/* ───────────────────────── Modelo, exportação e planilha de erros ───────────────────────── */

/**
 * Exportação: as MESMAS colunas do modelo (e da importação), uma linha por registro — baixar, editar e
 * subir de novo atualiza (id_sistema / código / CNPJ-CPF casam o registro) em vez de duplicar.
 */
export function linhasExportacao(def: DefImportacao, registros: Record<string, unknown>[], refs: Record<string, OpcaoRef[]> = {}) {
  return [
    def.colunas.map((c) => c.titulo),
    ...registros.map((r) => { const v = def.exportar(r, refs); return def.colunas.map((c) => v[c.chave] ?? ""); }),
  ];
}


/** Modelo: cabeçalho + 1 linha de exemplo preenchida; aba de instruções com obrigatórias e opções. */
export function linhasModelo(def: DefImportacao, refs: Record<string, OpcaoRef[]> = {}, o: { exportada?: boolean } = {}) {
  const cabecalho = def.colunas.map((c) => c.titulo);
  const exemplo = def.colunas.map((c) => c.exemplo);
  const instrucoes = [
    ["coluna", "obrigatória", "o que preencher", "valores aceitos"],
    ...def.colunas.map((c) => [c.titulo, c.obrig ? "sim" : "não", c.ajuda, (c.opcoes ?? refs[c.chave]?.map((o) => o.rotulo) ?? []).join(", ")]),
    [],
    o.exportada
      ? ["Importante", "", `Esta planilha veio do sistema: edite e envie de volta em “Importar planilha”. Cada linha ATUALIZA o seu cadastro pelo id_sistema — não altere essa coluna. Linhas novas (id_sistema vazio) são cadastradas.`, ""]
      : ["Importante", "", `A linha de exemplo (linha 2) é só um modelo: apague ou troque pelos seus dados antes de enviar.`, ""],
    ["", "", `${def.plural[0].toUpperCase()}${def.plural.slice(1)} que já existem (mesmo ${def.chaveDescricao}) são ${def.feminino ? "ATUALIZADAS" : "ATUALIZADOS"}; células vazias não apagam nada.`, ""],
    ["", "", `Até ${MAX_LINHAS_IMPORTACAO} linhas por arquivo. Nada é gravado antes da sua confirmação na prévia.`, ""],
    ["", "", "Linha apagada da planilha NÃO apaga nada no sistema: a importação só cria e atualiza.", ""],
  ];
  return { cabecalho, exemplo, instrucoes };
}

/**
 * Planilha de erros: as colunas do modelo + linha original + motivo (corrige e sobe de novo).
 * Com `avisos`, o mesmo formato vira o relatório de revisão (última coluna = "aviso").
 */
export function linhasErros(def: DefImportacao, erros: { linha: number; erros: string[]; valores: Record<string, string> }[], o: { avisos?: boolean } = {}) {
  const titulos = def.colunas.map((c) => c.titulo);
  return [
    [...titulos, "linha_original", o.avisos ? "aviso" : "motivo_do_erro"],
    ...erros.map((e) => [...titulos.map((t) => e.valores[t] ?? ""), String(e.linha), e.erros.join(" | ")]),
  ];
}
