/**
 * DOCUMENTAÇÃO DA EQUIPE PARA O CLIENTE — as REGRAS PURAS. Sem banco, sem rede, sem React: a tela,
 * o servidor e os testes leem as mesmas funções, então a tela nunca oferece o que a rota recusa.
 *
 * O problema que isto resolve: antes de a equipe entrar na obra, o cliente pede a documentação de
 * cada pessoa (ASO, NR-10, NR-35, ficha de EPI, contrato). Hoje isso é uma pasta no Google Drive,
 * montada à mão, com link eterno e ninguém sabendo o que foi para quem. Aqui o pacote é montado a
 * partir do que JÁ está na ficha do colaborador, sai por link com prazo, zip ou e-mail, e fica
 * registrado.
 *
 * Três decisões que valem para tudo abaixo:
 *
 *  1. **O pacote é uma lista fechada.** O que o cliente recebe é exatamente o que foi marcado —
 *     aqueles colaboradores, aquelas gavetas. Nada entra depois, nem por conveniência.
 *  2. **Vencido não sai.** Documento vencido num pacote é pior do que documento faltando: o
 *     cliente lê "ASO" e confia. O pacote com vencido não é gerado — a pessoa renova o documento
 *     ou tira aquele colaborador do pacote, e a decisão fica com ela, não com o sistema.
 *  3. **Nem toda gaveta pode sair.** Advertência e dados bancários não vão para cliente nenhum,
 *     com permissão ou sem.
 */

import { CATEGORIAS, ROTULO_GRUPO, rotuloCategoria, situacaoValidade, type CategoriaDoc } from "@/lib/colaborador/documentos";

/* ───────────────────────── o que pode sair ───────────────────────── */

/**
 * As gavetas que NUNCA entram num pacote para o cliente.
 *  - `disciplinar`: advertência e suspensão são assunto entre a empresa e a pessoa;
 *  - `dados_bancarios`: conta e PIX não têm por que sair da folha.
 * É regra, não preferência: o servidor recusa mesmo que a tela mande.
 */
export const CATEGORIAS_PROIBIDAS: readonly string[] = ["disciplinar", "dados_bancarios"];

/** As gavetas que a tela oferece para marcar, na ordem da casa. */
export const CATEGORIAS_ENVIAVEIS: CategoriaDoc[] = CATEGORIAS.filter((c) => !CATEGORIAS_PROIBIDAS.includes(c.id));

const ENVIAVEIS = new Set(CATEGORIAS_ENVIAVEIS.map((c) => c.id));
export const categoriaEnviavel = (id: string | null | undefined): boolean => !!id && ENVIAVEIS.has(id);

/**
 * O que já vem marcado: segurança e medicina do trabalho (ASO, NRs, ficha de EPI, integração) —
 * é o que o cliente pede para liberar a entrada. O resto a pessoa marca se o cliente pedir.
 */
export const CATEGORIAS_PADRAO: string[] = CATEGORIAS_ENVIAVEIS.filter((c) => c.grupo === "SMT").map((c) => c.id);

/** As gavetas enviáveis agrupadas, para a tela montar os blocos de marcar. */
export function categoriasEnviaveisPorGrupo(): { grupo: string; rotulo: string; itens: CategoriaDoc[] }[] {
  return (["SMT", "CONTRATO", "PESSOAL", "OUTROS"] as const)
    .map((g) => ({ grupo: g, rotulo: ROTULO_GRUPO[g], itens: CATEGORIAS_ENVIAVEIS.filter((c) => c.grupo === g) }))
    .filter((g) => g.itens.length > 0);
}

/* ───────────────────────── limites ───────────────────────── */

export const COLABORADORES_MAX = 200;
/** O teto de arquivos de um pacote é o do zip da casa (lib/zip.ts). */
export const ITENS_MAX = 500;
export const CLIENTES_NO_LOTE_MAX = 50;
export const DESTINATARIOS_MAX = 10;

/* ───────────────────────── a validade do link ───────────────────────── */

/** Os prazos que a tela oferece, em dias. Curto de propósito: é dado de pessoa fora da empresa. */
export const VALIDADES_DIAS = [3, 7, 15, 30] as const;
export const VALIDADE_PADRAO_DIAS = 7;
export const VALIDADE_MAX_DIAS = 30;

/** O prazo pedido, dentro do que a casa permite (fora da lista vira o padrão — nunca "eterno"). */
export function validadeDoLink(dias: unknown): number {
  const n = Math.trunc(Number(dias));
  return (VALIDADES_DIAS as readonly number[]).includes(n) ? n : VALIDADE_PADRAO_DIAS;
}

export const expiraEm = (dias: number, agora: Date = new Date()): Date =>
  new Date(agora.getTime() + validadeDoLink(dias) * 24 * 60 * 60 * 1000);

export type SituacaoLink = "SEM_LINK" | "ATIVO" | "EXPIRADO" | "REVOGADO";

/** Em que pé está o link. Revogado ganha de expirado: é o que a pessoa fez de propósito. */
export function situacaoDoLink(
  e: { token?: string | null; expiraEm?: Date | string | null; revogadoEm?: Date | string | null },
  agora: Date = new Date(),
): SituacaoLink {
  if (!e.token) return "SEM_LINK";
  if (e.revogadoEm) return "REVOGADO";
  if (!e.expiraEm || new Date(e.expiraEm).getTime() <= agora.getTime()) return "EXPIRADO";
  return "ATIVO";
}

export const ROTULO_LINK: Record<SituacaoLink, string> = {
  SEM_LINK: "Sem link",
  ATIVO: "Link ativo",
  EXPIRADO: "Link expirado",
  REVOGADO: "Link revogado",
};

/** O caminho da página pública. A barra final é o que separa do que é interno no middleware. */
export const caminhoPublicoDocumentacao = (token: string) => `/documentacao/${token}`;

/* ───────────────────────── as vias e os eventos ───────────────────────── */

export const VIAS = ["LINK", "ZIP", "EMAIL"] as const;
export type Via = (typeof VIAS)[number];
export const viaValida = (v: unknown): v is Via => (VIAS as readonly string[]).includes(String(v));

export const ROTULO_VIA: Record<Via, string> = { LINK: "Link", ZIP: "Zip", EMAIL: "E-mail" };

export type TipoEvento =
  | "CRIADO" | "LINK_GERADO" | "ZIP_BAIXADO" | "EMAIL_ENVIADO" | "EMAIL_FALHOU" | "REVOGADO"
  | "ACESSO" | "DOWNLOAD" | "DOWNLOAD_ZIP";

export const ROTULO_EVENTO: Record<TipoEvento, string> = {
  CRIADO: "Pacote montado",
  LINK_GERADO: "Link gerado",
  ZIP_BAIXADO: "Zip baixado",
  EMAIL_ENVIADO: "E-mail enviado",
  EMAIL_FALHOU: "E-mail não enviado",
  REVOGADO: "Link revogado",
  ACESSO: "Cliente abriu o link",
  DOWNLOAD: "Cliente baixou um arquivo",
  DOWNLOAD_ZIP: "Cliente baixou o pacote",
};

/** O que o cliente fez pelo link (não tem usuário: o autor é quem tem o link). */
export const EVENTOS_DO_CLIENTE: readonly TipoEvento[] = ["ACESSO", "DOWNLOAD", "DOWNLOAD_ZIP"];

/* ───────────────────────── as pastas ───────────────────────── */

export const ORGANIZACOES = ["POR_COLABORADOR", "POR_TIPO", "COLABORADOR_E_TIPO"] as const;
export type Organizacao = (typeof ORGANIZACOES)[number];
export const ORGANIZACAO_PADRAO: Organizacao = "POR_COLABORADOR";
export const organizacaoValida = (v: unknown): v is Organizacao => (ORGANIZACOES as readonly string[]).includes(String(v));

export const ROTULO_ORGANIZACAO: Record<Organizacao, string> = {
  POR_COLABORADOR: "Uma pasta por colaborador",
  POR_TIPO: "Uma pasta por tipo de documento",
  COLABORADOR_E_TIPO: "Colaborador e, dentro, tipo",
};

/** Barra e controle fora: o nome vira um pedaço de caminho, não um caminho. */
const semBarra = (s: string) => String(s ?? "").replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim();

/**
 * Onde o arquivo fica dentro do pacote. O nome do arquivo sempre diz de quem é e o que é — quem
 * baixa um arquivo solto do link não pode ficar com um "documento.pdf" sem dono.
 */
export function caminhoNoPacote(
  item: { colaboradorNome: string; categoriaRotulo: string; nome: string },
  organizacao: Organizacao,
): string {
  const pessoa = semBarra(item.colaboradorNome) || "Colaborador";
  const tipo = semBarra(item.categoriaRotulo) || "Documento";
  const nome = semBarra(item.nome) || "documento";
  switch (organizacao) {
    case "POR_TIPO": return `${tipo}/${pessoa} - ${nome}`;
    case "COLABORADOR_E_TIPO": return `${pessoa}/${tipo}/${nome}`;
    default: return `${pessoa}/${tipo} - ${nome}`;
  }
}

/* ───────────────────────── o diagnóstico ───────────────────────── */

export interface DocumentoCandidato {
  id: string;
  colaboradorId: string;
  categoria: string | null;
  nome: string;
  dataVencimento: Date | string | null;
  tamanho: number | null;
  temArquivo: boolean;
}

export interface ItemDoPacote {
  documentoId: string;
  colaboradorId: string;
  colaboradorNome: string;
  categoria: string;
  categoriaRotulo: string;
  nome: string;
  dataVencimento: Date | string | null;
  tamanho: number | null;
  /** Vence nos próximos 30 dias: entra, mas a tela avisa (o cliente vai cobrar de novo logo). */
  venceEmBreve: boolean;
}

export interface Pendencia {
  colaboradorId: string;
  colaboradorNome: string;
  categoria: string;
  categoriaRotulo: string;
  /** Só nos vencidos: o documento que segura o pacote. */
  documentoId?: string;
  nome?: string;
  dataVencimento?: Date | string | null;
}

export interface Diagnostico {
  /** O que entra no pacote. */
  itens: ItemDoPacote[];
  /** Vencidos SEM renovação na mesma gaveta: seguram o pacote. */
  vencidos: Pendencia[];
  /** Colaborador marcado sem nenhum documento daquela gaveta: avisa, e a pessoa decide. */
  faltando: Pendencia[];
  /** Pode gerar? (Sem vencido segurando e com pelo menos um arquivo.) */
  liberado: boolean;
}

/**
 * Monta o pacote e diz o que impede. Para cada colaborador × gaveta marcada:
 *
 *  - documentos em dia (ou sem validade) → entram;
 *  - documento VENCIDO com uma renovação em dia na mesma gaveta → fica de fora, sem alarde (o ASO
 *    antigo não segura o pacote de quem já fez o novo);
 *  - documento VENCIDO sem renovação → segura o pacote;
 *  - nenhum documento na gaveta → falta.
 *
 * "Renovação" é documento da mesma gaveta, em dia e COM validade: um papel sem data de vencimento
 * na gaveta do ASO não prova que o exame foi refeito.
 */
export function diagnosticar(
  colaboradores: readonly { id: string; nome: string }[],
  categorias: readonly string[],
  documentos: readonly DocumentoCandidato[],
  agora: Date = new Date(),
): Diagnostico {
  const marcadas = [...new Set(categorias)].filter(categoriaEnviavel);
  const itens: ItemDoPacote[] = [];
  const vencidos: Pendencia[] = [];
  const faltando: Pendencia[] = [];

  for (const pessoa of colaboradores) {
    for (const categoria of marcadas) {
      const rot = rotuloCategoria({ categoria });
      const daGaveta = documentos.filter((d) => d.colaboradorId === pessoa.id && d.categoria === categoria && d.temArquivo);
      if (!daGaveta.length) {
        faltando.push({ colaboradorId: pessoa.id, colaboradorNome: pessoa.nome, categoria, categoriaRotulo: rot });
        continue;
      }
      const comSituacao = daGaveta.map((d) => ({ d, v: situacaoValidade(d.dataVencimento, agora) }));
      const temRenovacao = comSituacao.some(({ v }) => v.situacao === "EM_DIA" || v.situacao === "VENCE_EM_BREVE");

      for (const { d, v } of comSituacao) {
        if (v.situacao === "VENCIDO") {
          if (!temRenovacao) {
            vencidos.push({
              colaboradorId: pessoa.id, colaboradorNome: pessoa.nome, categoria, categoriaRotulo: rot,
              documentoId: d.id, nome: d.nome, dataVencimento: d.dataVencimento,
            });
          }
          continue; // vencido nunca entra — com renovação ou sem
        }
        itens.push({
          documentoId: d.id, colaboradorId: pessoa.id, colaboradorNome: pessoa.nome,
          categoria, categoriaRotulo: rot, nome: d.nome,
          dataVencimento: d.dataVencimento, tamanho: d.tamanho,
          venceEmBreve: v.situacao === "VENCE_EM_BREVE",
        });
      }
    }
  }

  return { itens, vencidos, faltando, liberado: vencidos.length === 0 && itens.length > 0 };
}

/** A frase do bloqueio — a mesma na tela e na rota. */
export function mensagemDeVencidos(vencidos: readonly Pendencia[]): string {
  if (!vencidos.length) return "";
  const nomes = [...new Set(vencidos.map((v) => `${v.categoriaRotulo} de ${v.colaboradorNome}`))];
  const lista = nomes.length > 3 ? `${nomes.slice(0, 3).join("; ")} e mais ${nomes.length - 3}` : nomes.join("; ");
  return `Há documento vencido no pacote: ${lista}. Renove o documento ou tire o colaborador do pacote.`;
}

/* ───────────────────────── os destinatários ───────────────────────── */

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** Aceita lista ou texto com vírgula/ponto e vírgula; devolve os endereços limpos, sem repetir. */
export function limparEmails(bruto: unknown): string[] {
  const partes = Array.isArray(bruto) ? bruto : String(bruto ?? "").split(/[,;\n]+/);
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const p of partes) {
    const e = String(p ?? "").trim();
    const chave = e.toLowerCase();
    if (!e || vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(e);
  }
  return saida;
}

export interface Destinatarios { para: string[]; cc: string[] }

/**
 * Confere os destinatários do e-mail. Quem está em "Para" não se repete em "Cópia", e o total tem
 * teto — o envio é para o contato do cliente, não para uma lista de distribuição.
 */
export function conferirDestinatarios(para: unknown, cc: unknown): { ok: true; valor: Destinatarios } | { ok: false; erro: string } {
  const p = limparEmails(para);
  const emPara = new Set(p.map((e) => e.toLowerCase()));
  const c = limparEmails(cc).filter((e) => !emPara.has(e.toLowerCase()));
  if (!p.length) return { ok: false, erro: "Informe pelo menos um e-mail de destino." };
  const invalido = [...p, ...c].find((e) => !EMAIL.test(e));
  if (invalido) return { ok: false, erro: `E-mail inválido: ${invalido}` };
  if (p.length + c.length > DESTINATARIOS_MAX) return { ok: false, erro: `No máximo ${DESTINATARIOS_MAX} destinatários por envio.` };
  return { ok: true, valor: { para: p, cc: c } };
}
