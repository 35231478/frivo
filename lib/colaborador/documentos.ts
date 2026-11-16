/**
 * DOCUMENTOS DO COLABORADOR — as regras puras.
 *
 * Um lugar só para os papéis de uma pessoa: o que o RH anexa na ficha (contrato de quem veio da
 * plataforma anterior, ASO, certificados de NR) e o que o próprio colaborador manda pela admissão
 * digital. A tabela é a mesma; o que muda é a `origem`.
 *
 * Sem banco e sem React aqui dentro: só listas, rótulos e contas de data. É o que o servidor e a
 * tela usam para não discordarem — a tela nunca libera o que a rota recusaria.
 */

import { diasAteDiaCivil } from "@/lib/fuso";

/* ───────────────────────── categorias ───────────────────────── */

export type GrupoCategoria = "CONTRATO" | "PESSOAL" | "SMT" | "OUTROS";

export interface CategoriaDoc {
  id: string;
  rotulo: string;
  grupo: GrupoCategoria;
  /** Documento que normalmente vence: a tela sugere preencher a validade. */
  venceNormalmente?: boolean;
}

export const ROTULO_GRUPO: Record<GrupoCategoria, string> = {
  CONTRATO: "Contrato e registro",
  PESSOAL: "Documentos pessoais",
  SMT: "Segurança e medicina do trabalho",
  OUTROS: "Outros",
};

/**
 * As gavetas. A ordem é a da tela. O id é o que vai para o banco (coluna `categoria`) — mudar um
 * rótulo não mexe no que já está gravado.
 *
 * O grupo SMT existe porque é dele que sai a documentação que o cliente pede antes de a equipe
 * entrar na obra: ASO em dia, NR-10, NR-35, NR-13, ficha de EPI e integração.
 */
export const CATEGORIAS: CategoriaDoc[] = [
  { id: "contrato", rotulo: "Contrato de trabalho", grupo: "CONTRATO" },
  { id: "registro", rotulo: "Ficha de registro", grupo: "CONTRATO" },
  // Nascem do motor de Modelos de documento (lib/documentos/modelos.ts), que gera o papel e o
  // guarda aqui como qualquer outro — sem lista paralela.
  { id: "termo_responsabilidade", rotulo: "Termo de responsabilidade", grupo: "CONTRATO" },
  { id: "disciplinar", rotulo: "Advertência e suspensão", grupo: "CONTRATO" },
  { id: "documento_pessoal", rotulo: "Documento pessoal", grupo: "PESSOAL" },
  { id: "comprovante_residencia", rotulo: "Comprovante de residência", grupo: "PESSOAL" },
  { id: "dados_bancarios", rotulo: "Dados bancários", grupo: "PESSOAL" },
  { id: "escolaridade", rotulo: "Escolaridade", grupo: "PESSOAL" },
  { id: "aso", rotulo: "ASO (exame)", grupo: "SMT", venceNormalmente: true },
  { id: "nr_10", rotulo: "NR-10", grupo: "SMT", venceNormalmente: true },
  { id: "nr_35", rotulo: "NR-35", grupo: "SMT", venceNormalmente: true },
  { id: "nr_13", rotulo: "NR-13", grupo: "SMT", venceNormalmente: true },
  { id: "ficha_epi", rotulo: "Ficha de EPI", grupo: "SMT" },
  { id: "integracao", rotulo: "Integração", grupo: "SMT", venceNormalmente: true },
  { id: "cnh", rotulo: "CNH", grupo: "OUTROS", venceNormalmente: true },
  { id: "outros", rotulo: "Outros", grupo: "OUTROS" },
];

export const CATEGORIA_PADRAO = "outros";

const POR_ID = new Map(CATEGORIAS.map((c) => [c.id, c]));

export const categoriaValida = (id: string | null | undefined): boolean => !!id && POR_ID.has(id);

/**
 * Esta gaveta costuma ter validade? A tela lembra de preencher — é o dado de que os avisos de
 * vencimento (e o pacote que vai ao cliente) dependem.
 */
export const categoriaVenceNormalmente = (id: string | null | undefined): boolean =>
  !!id && POR_ID.get(id)?.venceNormalmente === true;

/** As categorias agrupadas, na ordem da tela — o `<optgroup>` sai daqui. */
export function categoriasPorGrupo(): { grupo: GrupoCategoria; rotulo: string; itens: CategoriaDoc[] }[] {
  const ordem: GrupoCategoria[] = ["CONTRATO", "PESSOAL", "SMT", "OUTROS"];
  return ordem.map((g) => ({
    grupo: g,
    rotulo: ROTULO_GRUPO[g],
    itens: CATEGORIAS.filter((c) => c.grupo === g),
  }));
}

/**
 * O rótulo que a tela mostra na coluna "Categoria".
 *
 * Os documentos antigos (de antes da coluna `categoria`) guardavam o rótulo no `tipo` — "CNH",
 * "Diploma", "Certificado NR-35". Esses continuam legíveis exatamente como eram: sem `categoria`,
 * mostra-se o `tipo`. Nenhum documento legado é reclassificado por adivinhação, e nenhum fica sem
 * rótulo.
 */
export function rotuloCategoria(doc: { categoria?: string | null; tipo?: string | null }): string {
  const c = (doc.categoria ?? "").trim();
  if (c) return POR_ID.get(c)?.rotulo ?? c;
  const t = (doc.tipo ?? "").trim();
  return t || ROTULO_GRUPO.OUTROS;
}

/**
 * A categoria de um documento que chega pela ADMISSÃO. O `tipo` lá é o id do documento que a
 * empresa pede, e a empresa pode renomear e inventar os seus — então o que não está no mapa cai em
 * "Outros" em vez de ser chutado para uma gaveta errada.
 */
const CATEGORIA_DO_PEDIDO: Record<string, string> = {
  rg: "documento_pessoal",
  cpf: "documento_pessoal",
  ctps: "documento_pessoal",
  foto: "documento_pessoal",
  titulo_eleitor: "documento_pessoal",
  certidao_nascimento_filhos: "documento_pessoal",
  comprovante_residencia: "comprovante_residencia",
  comprovante_escolaridade: "escolaridade",
  dados_bancarios: "dados_bancarios",
  aso: "aso",
};

export const categoriaDoPedido = (docId: string): string =>
  CATEGORIA_DO_PEDIDO[(docId ?? "").trim()] ?? CATEGORIA_PADRAO;

/* ───────────────────────── origem ───────────────────────── */

/** MANUAL: o RH anexou. ADMISSAO: o colaborador mandou pelo link. GERADO: saiu de um modelo. */
export type OrigemDoc = "MANUAL" | "ADMISSAO" | "GERADO";

export const ROTULO_ORIGEM: Record<OrigemDoc, string> = {
  MANUAL: "Anexado pelo RH",
  ADMISSAO: "Enviado na admissão",
  GERADO: "Gerado por modelo",
};

export const origemValida = (v: unknown): v is OrigemDoc => v === "MANUAL" || v === "ADMISSAO" || v === "GERADO";

/* ───────────────────────── validade ───────────────────────── */

/** Quantos dias antes do vencimento o documento já aparece com selo de atenção. */
export const DIAS_AVISO_VALIDADE = 30;

export type SituacaoValidade = "SEM_VALIDADE" | "VENCIDO" | "VENCE_EM_BREVE" | "EM_DIA";

export interface Validade {
  situacao: SituacaoValidade;
  /** Dias até vencer: negativo quando já venceu, null quando não há validade. */
  dias: number | null;
}

/**
 * Em que pé está a validade de um documento.
 *
 * A conta de dias é a MESMA do resto do sistema (`diasAteDiaCivil`, no fuso de operação): a ficha,
 * a lista de colaboradores e o sino não podem discordar sobre o que está vencido. Vence HOJE ainda
 * não está vencido — vale o dia inteiro.
 */
export function situacaoValidade(
  dataVencimento: Date | string | null | undefined,
  agora: Date = new Date(),
  diasAviso: number = DIAS_AVISO_VALIDADE,
): Validade {
  if (!dataVencimento) return { situacao: "SEM_VALIDADE", dias: null };
  const dias = diasAteDiaCivil(dataVencimento, agora);
  if (dias === null || Number.isNaN(dias)) return { situacao: "SEM_VALIDADE", dias: null };

  if (dias < 0) return { situacao: "VENCIDO", dias };
  if (dias <= diasAviso) return { situacao: "VENCE_EM_BREVE", dias };
  return { situacao: "EM_DIA", dias };
}

/** O que o selo diz. Sem validade não tem selo — devolve string vazia. */
export function rotuloValidade(v: Validade): string {
  switch (v.situacao) {
    case "VENCIDO":
      return v.dias === -1 ? "Venceu ontem" : `Vencido há ${Math.abs(v.dias ?? 0)} dias`;
    case "VENCE_EM_BREVE":
      if (v.dias === 0) return "Vence hoje";
      return v.dias === 1 ? "Vence amanhã" : `Vence em ${v.dias} dias`;
    default:
      return "";
  }
}

/** O tom do selo, no vocabulário de cor da casa (atrasado = vermelho, atencao = amarelo). */
export const TOM_VALIDADE: Record<SituacaoValidade, "atrasado" | "atencao" | "neutro"> = {
  VENCIDO: "atrasado",
  VENCE_EM_BREVE: "atencao",
  EM_DIA: "neutro",
  SEM_VALIDADE: "neutro",
};

/* ───────────────────────── a ficha inteira ───────────────────────── */

export interface DocumentoDaFicha {
  id: string;
  nome: string;
  categoria?: string | null;
  tipo?: string | null;
  origem: string;
  arquivoTipo?: string | null;
  tamanho?: number | null;
  dataVencimento?: Date | string | null;
  criadoEm: Date | string;
  criadoPorNome?: string | null;
  temArquivo: boolean;
}

/**
 * O aviso do topo da ficha: quantos documentos estão vencidos e quantos vencem em breve. É o
 * mesmo cálculo da lista de colaboradores, para a ficha e a lista nunca discordarem.
 */
export function resumoValidade(
  docs: readonly { dataVencimento?: Date | string | null }[],
  agora: Date = new Date(),
  diasAviso: number = DIAS_AVISO_VALIDADE,
): { vencidos: number; vencendo: number } {
  let vencidos = 0;
  let vencendo = 0;
  for (const d of docs) {
    const s = situacaoValidade(d.dataVencimento, agora, diasAviso).situacao;
    if (s === "VENCIDO") vencidos++;
    else if (s === "VENCE_EM_BREVE") vencendo++;
  }
  return { vencidos, vencendo };
}

/** O tamanho do arquivo em palavras curtas, para a linha da lista. */
export function tamanhoEmPalavras(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(kb / 1024 < 10 ? 1 : 0)} MB`;
}

/** "PDF", "JPEG", "PNG" — o que o arquivo é, curto, a partir do tipo lido dos bytes. */
export function formatoEmPalavras(arquivoTipo: string | null | undefined): string {
  const t = (arquivoTipo ?? "").trim().toLowerCase();
  if (!t) return "";
  if (t === "application/pdf") return "PDF";
  const sub = t.split("/")[1] ?? "";
  if (!sub) return "";
  if (sub === "jpeg" || sub === "jpg") return "JPEG";
  return sub.toUpperCase();
}

/** Nome obrigatório e com teto — o mesmo limite no servidor e na tela. */
export const NOME_MAX = 120;

export function nomeValido(nome: string | null | undefined): boolean {
  const n = (nome ?? "").trim();
  return n.length > 0 && n.length <= NOME_MAX;
}

/**
 * O nome que fica quando o RH não digita nada: o rótulo da categoria. Melhor que "documento.pdf" —
 * a lista fica legível sem ninguém digitar.
 */
export function nomePadrao(categoriaId: string, nomeArquivo?: string | null): string {
  const digitado = (nomeArquivo ?? "").trim();
  if (digitado) return digitado.slice(0, NOME_MAX);
  return (POR_ID.get(categoriaId)?.rotulo ?? ROTULO_GRUPO.OUTROS).slice(0, NOME_MAX);
}
