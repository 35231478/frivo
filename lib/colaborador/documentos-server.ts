/**
 * DOCUMENTOS DO COLABORADOR — o servidor.
 *
 * Um documento por vez: anexar, baixar, alterar a validade, excluir. Nada de "salvar a lista
 * inteira" — era isso que apagava sem rastro o que o colaborador tinha mandado pela admissão.
 *
 * Acesso: sempre pela EMPRESA da sessão. A busca é `{ colaborador: { empresaId } }`, nunca pelo id
 * do documento sozinho — um id de outra empresa devolve 404, não o arquivo.
 *
 * Permissão (a mesma de quem já vê o dado sensível do colaborador, sem inventar módulo novo):
 *   • ver, baixar, anexar e alterar a validade → "Equipes / Colaboradores › gerenciar" (é a
 *     permissão que a ficha completa — CPF, RG, documentos — já exigia para abrir);
 *   • excluir → "Equipes / Colaboradores › excluir", a mesma de inativar e apagar o colaborador.
 */

import { prisma } from "@/lib/prisma";
import { validarDataUrl } from "@/lib/anexos-server";
import { diaCivilDeChave } from "@/lib/fuso";
import {
  CATEGORIA_PADRAO, NOME_MAX, categoriaValida, nomePadrao,
} from "@/lib/colaborador/documentos";

export class ErroDocumento extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ErroDocumento";
  }
}

/** Teto de documentos por colaborador: uma pasta de RH inteira cabe em muito menos. */
export const DOCUMENTOS_POR_COLABORADOR_MAX = 120;

const MSG_NAO_ENCONTRADO = "Documento não encontrado";

export interface DocumentoLinha {
  id: string;
  nome: string;
  categoria: string | null;
  tipo: string;
  origem: string;
  arquivoTipo: string | null;
  tamanho: number | null;
  dataVencimento: string | null;
  criadoEm: string;
  criadoPorNome: string | null;
  temArquivo: boolean;
}

const SELECT_LINHA = {
  id: true, nome: true, categoria: true, tipo: true, origem: true,
  arquivoTipo: true, tamanho: true, dataVencimento: true, criadoEm: true,
  criadoPor: { select: { nome: true } },
} as const;

type LinhaCrua = {
  id: string; nome: string; categoria: string | null; tipo: string; origem: string;
  arquivoTipo: string | null; tamanho: number | null; dataVencimento: Date | null;
  criadoEm: Date; criadoPor: { nome: string } | null;
};

/** `temArquivo` sai de um SELECT separado: o data URL é grande e não vai para a tela de lista. */
function serializar(l: LinhaCrua, comArquivo: Set<string>): DocumentoLinha {
  return {
    id: l.id, nome: l.nome, categoria: l.categoria, tipo: l.tipo, origem: l.origem,
    arquivoTipo: l.arquivoTipo, tamanho: l.tamanho,
    dataVencimento: l.dataVencimento ? l.dataVencimento.toISOString() : null,
    criadoEm: l.criadoEm.toISOString(),
    criadoPorNome: l.criadoPor?.nome ?? null,
    temArquivo: comArquivo.has(l.id),
  };
}

/**
 * Quais destes documentos têm arquivo guardado. Por SQL cru de propósito: o arquivo é um data URL
 * que pode ter megabytes, e a lista da ficha não precisa dele — precisa só saber se existe.
 */
async function idsComArquivo(ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const linhas = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM colaborador_documentos
    WHERE id = ANY(${ids as string[]}) AND arquivo_url IS NOT NULL AND arquivo_url <> ''`;
  return new Set(linhas.map((r) => r.id));
}

/** O colaborador existe NESTA empresa? Devolve o id, ou estoura 404. */
async function exigirColaborador(colaboradorId: string, empresaId: string): Promise<string> {
  const t = await prisma.tecnico.findFirst({ where: { id: colaboradorId, empresaId }, select: { id: true } });
  if (!t) throw new ErroDocumento("Colaborador não encontrado", 404);
  return t.id;
}

/** Os documentos vivos de um colaborador, do mais novo para o mais antigo. */
export async function documentosDoColaborador(colaboradorId: string, empresaId: string): Promise<DocumentoLinha[]> {
  await exigirColaborador(colaboradorId, empresaId);
  const linhas = await prisma.colaboradorDocumento.findMany({
    where: { colaboradorId, excluidoEm: null },
    select: SELECT_LINHA,
    orderBy: [{ criadoEm: "desc" }],
  });
  if (!linhas.length) return [];
  const comArquivo = await idsComArquivo(linhas.map((l) => l.id));
  return linhas.map((l) => serializar(l as LinhaCrua, comArquivo));
}

/** A data de validade digitada ("AAAA-MM-DD") como dia civil gravável. Vazio = sem validade. */
function lerVencimento(valor: unknown): Date | null {
  const texto = typeof valor === "string" ? valor.trim() : "";
  if (!texto) return null;
  const d = diaCivilDeChave(texto.slice(0, 10));
  if (!d) throw new ErroDocumento("Data de validade inválida", 400);
  return d;
}

export interface DadosAnexar {
  categoria?: string | null;
  nome?: string | null;
  arquivoUrl: string;
  dataVencimento?: string | null;
}

/**
 * Anexa um arquivo à ficha. O tipo do arquivo é decidido pelos BYTES (um HTML com nome de PDF não
 * passa), como em todo anexo do sistema, e o que foi lido dos bytes é o que fica gravado.
 */
export async function anexarDocumento(
  colaboradorId: string, empresaId: string, dados: DadosAnexar,
  autor: { usuarioId: string }, agora: Date = new Date(),
): Promise<DocumentoLinha> {
  await exigirColaborador(colaboradorId, empresaId);

  // Categoria vazia é "Outros"; categoria que NÃO EXISTE é erro. Engolir e arquivar em "Outros"
  // seria pôr o papel na gaveta errada sem ninguém ficar sabendo (o PATCH já recusava).
  const pedida = typeof dados.categoria === "string" ? dados.categoria.trim() : "";
  if (pedida && !categoriaValida(pedida)) throw new ErroDocumento("Categoria inválida", 400);
  const categoria = pedida || CATEGORIA_PADRAO;
  const vencimento = lerVencimento(dados.dataVencimento);

  const quantos = await prisma.colaboradorDocumento.count({ where: { colaboradorId, excluidoEm: null } });
  if (quantos >= DOCUMENTOS_POR_COLABORADOR_MAX) {
    throw new ErroDocumento("Muitos documentos neste colaborador. Exclua algum antes de anexar outro.", 409);
  }

  const pedido = (dados.nome ?? "").trim().slice(0, NOME_MAX);
  const r = validarDataUrl(dados.arquivoUrl ?? "", pedido || "documento");
  if (!r.ok) throw new ErroDocumento(r.erro, 400);

  const criado = await prisma.colaboradorDocumento.create({
    data: {
      colaboradorId,
      // `tipo` guarda a categoria nos documentos que o RH anexa (é o que os antigos já faziam);
      // nos que vêm da admissão, guarda o id do documento pedido. A gaveta mora em `categoria`.
      tipo: categoria,
      categoria,
      nome: pedido || nomePadrao(categoria, r.arquivo.nome),
      arquivoUrl: r.arquivo.conteudo,
      arquivoTipo: r.arquivo.tipo,
      tamanho: r.arquivo.tamanho,
      origem: "MANUAL",
      dataVencimento: vencimento,
      criadoEm: agora,
      criadoPorId: autor.usuarioId,
    },
    select: SELECT_LINHA,
  });
  return serializar(criado as LinhaCrua, new Set([criado.id]));
}

export interface DadosAlterar {
  categoria?: string | null;
  nome?: string | null;
  dataVencimento?: string | null;
}

/**
 * Corrige o que foi digitado: a gaveta, o nome e a validade. O ARQUIVO não se troca por aqui —
 * trocar o arquivo por baixo de um documento já guardado seria perder o original sem rastro; para
 * isso, anexa-se o novo e exclui-se o antigo.
 */
export async function alterarDocumento(
  documentoId: string, colaboradorId: string, empresaId: string, dados: DadosAlterar,
): Promise<DocumentoLinha> {
  const atual = await prisma.colaboradorDocumento.findFirst({
    where: { id: documentoId, colaboradorId, excluidoEm: null, colaborador: { empresaId } },
    select: { id: true, categoria: true, tipo: true, origem: true },
  });
  if (!atual) throw new ErroDocumento(MSG_NAO_ENCONTRADO, 404);

  const dado: { categoria?: string; nome?: string; dataVencimento?: Date | null } = {};

  if (dados.categoria !== undefined && dados.categoria !== null) {
    if (!categoriaValida(dados.categoria)) throw new ErroDocumento("Categoria inválida", 400);
    // Só a `categoria` muda. O `tipo` de um documento da ADMISSÃO é o protocolo do link (qual
    // documento pedido aquele arquivo atende) — mexer nele faria a admissão perder a conta do que
    // já chegou.
    dado.categoria = String(dados.categoria);
  }
  if (dados.nome !== undefined && dados.nome !== null) {
    const nome = String(dados.nome).trim().slice(0, NOME_MAX);
    if (!nome) throw new ErroDocumento("O documento precisa de um nome.", 400);
    dado.nome = nome;
  }
  if (dados.dataVencimento !== undefined) dado.dataVencimento = lerVencimento(dados.dataVencimento);

  if (!Object.keys(dado).length) throw new ErroDocumento("Nada para alterar", 400);

  const salvo = await prisma.colaboradorDocumento.update({
    where: { id: atual.id }, data: dado, select: SELECT_LINHA,
  });
  return serializar(salvo as LinhaCrua, await idsComArquivo([salvo.id]));
}

/**
 * Exclui COM RASTRO: sai da ficha, fica no banco com quem apagou e quando. Documento de colaborador
 * não some sem deixar registro — nem o que o RH anexou, nem o que o colaborador mandou.
 *
 * UMA instrução só: quem decide se achou é a contagem do próprio UPDATE, não uma leitura antes.
 * Com `excluidoEm: null` no filtro, dois cliques simultâneos gravam uma vez só — o segundo não
 * encontra linha para atualizar e vira 404, sem reescrever o rastro do primeiro. Ler primeiro e
 * escrever depois deixaria o segundo clique passar pela brecha entre as duas idas ao banco.
 */
export async function excluirDocumento(
  documentoId: string, colaboradorId: string, empresaId: string,
  autor: { usuarioId: string }, agora: Date = new Date(),
): Promise<void> {
  const { count } = await prisma.colaboradorDocumento.updateMany({
    where: { id: documentoId, colaboradorId, excluidoEm: null, colaborador: { empresaId } },
    data: { excluidoEm: agora, excluidoPorId: autor.usuarioId },
  });
  if (!count) throw new ErroDocumento(MSG_NAO_ENCONTRADO, 404);
}

/** O arquivo em si, para a resposta de download. 404 quando não há arquivo guardado. */
export async function arquivoDoDocumento(
  documentoId: string, colaboradorId: string, empresaId: string,
): Promise<{ nome: string; conteudo: string }> {
  const d = await prisma.colaboradorDocumento.findFirst({
    where: { id: documentoId, colaboradorId, excluidoEm: null, colaborador: { empresaId } },
    select: { nome: true, arquivoUrl: true },
  });
  if (!d) throw new ErroDocumento(MSG_NAO_ENCONTRADO, 404);
  if (!d.arquivoUrl) throw new ErroDocumento("Este documento não tem arquivo anexado.", 404);
  return { nome: d.nome, conteudo: d.arquivoUrl };
}
