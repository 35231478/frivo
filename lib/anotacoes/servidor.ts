/**
 * ANOTAÇÕES INTERNAS — o lado do SERVIDOR. Uma porta só para ler e gravar, para não existir
 * consulta solta por aí.
 *
 * A REGRA QUE NÃO SE NEGOCIA: toda consulta daqui é filtrada por `empresaId` E `usuarioId` da
 * SESSÃO — nunca por id sozinho. Isso vale igual para o SUPER_ADMIN: o papel é a chave da
 * ferramenta, não uma chave-mestra entre empresas (lib/anotacoes/dono.ts explica). Pedir pelo id
 * uma anotação de outra empresa, ou de outro dono, devolve "não encontrada".
 */
import { prisma } from "@/lib/prisma";
import { validarFoto } from "@/lib/anexos-server";
import {
  LIMITE_LISTA, PRINT_MAX_BYTES, TEXTO_MAX, ehStatusAnotacao, resolveStatus,
  type Ancora, type StatusAnotacao,
} from "@/lib/anotacoes/regras";

/** O dono da anotação: as duas chaves que travam TODA consulta deste arquivo. */
export interface Quem {
  empresaId: string;
  usuarioId: string;
}

const SELECT_LISTA = {
  id: true, tela: true, rota: true, tituloTela: true,
  ancora: true, ancoraIndice: true, caminho: true, rotulo: true, papel: true,
  fx: true, fy: true, x: true, y: true, viewportW: true,
  texto: true, status: true, criadoEm: true, atualizadoEm: true, resolvidoEm: true,
  // só o SINAL de que existe print: a listagem nunca arrasta base64 (a imagem vem por rota própria)
  print: { select: { largura: true, altura: true, printFx: true, printFy: true, bytes: true } },
} as const;

export type AnotacaoDaLista = Awaited<ReturnType<typeof listarAnotacoes>>[number];

/** As anotações do dono, mais novas primeiro. Sem paginação na fase 1, com teto. */
export async function listarAnotacoes(quem: Quem, filtro?: { status?: StatusAnotacao; tela?: string }) {
  return prisma.anotacaoInterna.findMany({
    where: {
      empresaId: quem.empresaId,
      usuarioId: quem.usuarioId,
      ...(filtro?.status ? { status: filtro.status } : {}),
      ...(filtro?.tela ? { tela: filtro.tela } : {}),
    },
    select: SELECT_LISTA,
    orderBy: [{ tela: "asc" }, { criadoEm: "desc" }],
    take: LIMITE_LISTA,
  });
}

export interface NovaAnotacao extends Ancora {
  tela: string;
  rota: string;
  tituloTela?: string | null;
  texto: string;
  /** data URL do print já reduzido no navegador. Ausente, inválido ou grande demais: salva sem print. */
  print?: { conteudo: string; largura: number; altura: number; printFx?: number | null; printFy?: number | null } | null;
}

export interface ResultadoCriar {
  ok: boolean;
  erro?: string;
  id?: string;
  /** Por que o print não entrou (a anotação entrou de qualquer jeito) */
  avisoPrint?: string;
}

/**
 * Cria a anotação. O print NUNCA bloqueia o salvar: se ele falhar na validação ou estourar o teto,
 * a anotação é gravada sem imagem e o aviso volta para a tela. Perder a anotação porque a captura
 * da tela deu errado seria perder a única coisa que importa aqui.
 */
export async function criarAnotacao(quem: Quem, dados: NovaAnotacao): Promise<ResultadoCriar> {
  const texto = (dados.texto ?? "").trim();
  if (!texto) return { ok: false, erro: "Escreva a anotação." };
  if (texto.length > TEXTO_MAX) return { ok: false, erro: `A anotação passa de ${TEXTO_MAX} caracteres.` };
  const tela = (dados.tela ?? "").trim();
  const rota = (dados.rota ?? "").trim();
  if (!tela || !rota) return { ok: false, erro: "Contexto da tela ausente." };

  let avisoPrint: string | undefined;
  let print: { conteudo: string; largura: number; altura: number; printFx: number | null; printFy: number | null; bytes: number } | null = null;
  if (dados.print?.conteudo) {
    const bytes = Math.floor(((dados.print.conteudo.length - dados.print.conteudo.indexOf(",") - 1) * 3) / 4);
    if (bytes > PRINT_MAX_BYTES) {
      avisoPrint = "O print ficou grande demais e não foi guardado; a anotação foi salva.";
    } else {
      const v = validarFoto(dados.print.conteudo, { tamanhoMax: PRINT_MAX_BYTES });
      if (!v.ok) avisoPrint = `O print não pôde ser guardado (${v.erro}); a anotação foi salva.`;
      else print = {
        conteudo: v.arquivo.conteudo,
        largura: Math.max(1, Math.round(dados.print.largura || 1)),
        altura: Math.max(1, Math.round(dados.print.altura || 1)),
        printFx: dados.print.printFx ?? null,
        printFy: dados.print.printFy ?? null,
        bytes: v.arquivo.tamanho,
      };
    }
  }

  const criada = await prisma.anotacaoInterna.create({
    data: {
      empresaId: quem.empresaId,
      usuarioId: quem.usuarioId,
      tela, rota,
      tituloTela: dados.tituloTela?.trim() || null,
      ancora: dados.ancora ?? null,
      ancoraIndice: Math.max(0, Math.round(dados.ancoraIndice ?? 0)),
      caminho: dados.caminho ?? null,
      rotulo: dados.rotulo ?? null,
      papel: dados.papel ?? null,
      fx: dados.fx ?? null,
      fy: dados.fy ?? null,
      x: dados.x ?? null,
      y: dados.y ?? null,
      viewportW: dados.viewportW ?? null,
      texto,
      ...(print ? { print: { create: print } } : {}),
    },
    select: { id: true },
  });
  return { ok: true, id: criada.id, avisoPrint };
}

/**
 * Muda o status e/ou o texto. O `updateMany` com as duas chaves é de propósito: ele não tem como
 * alcançar a anotação de outra empresa nem de outro dono — se o id não for dele, nada é atualizado
 * e a resposta é "não encontrada".
 */
export async function atualizarAnotacao(
  quem: Quem, id: string, mudanca: { status?: string; texto?: string }, agora = new Date(),
): Promise<{ ok: boolean; erro?: string }> {
  const data: Record<string, unknown> = {};
  if (mudanca.status !== undefined) {
    if (!ehStatusAnotacao(mudanca.status)) return { ok: false, erro: "Status inválido." };
    data.status = mudanca.status;
    data.resolvidoEm = resolveStatus(mudanca.status, agora);
  }
  if (mudanca.texto !== undefined) {
    const texto = mudanca.texto.trim();
    if (!texto) return { ok: false, erro: "Escreva a anotação." };
    if (texto.length > TEXTO_MAX) return { ok: false, erro: `A anotação passa de ${TEXTO_MAX} caracteres.` };
    data.texto = texto;
  }
  if (!Object.keys(data).length) return { ok: false, erro: "Nada para mudar." };

  const r = await prisma.anotacaoInterna.updateMany({
    where: { id, empresaId: quem.empresaId, usuarioId: quem.usuarioId },
    data,
  });
  return r.count ? { ok: true } : { ok: false, erro: "Anotação não encontrada." };
}

/** Exclui de vez (o print cai com ela, por cascade). Só a do próprio dono, na própria empresa. */
export async function excluirAnotacao(quem: Quem, id: string): Promise<{ ok: boolean; erro?: string }> {
  const r = await prisma.anotacaoInterna.deleteMany({
    where: { id, empresaId: quem.empresaId, usuarioId: quem.usuarioId },
  });
  return r.count ? { ok: true } : { ok: false, erro: "Anotação não encontrada." };
}

/** O print de UMA anotação, para a rota que serve a imagem. Mesmas duas travas. */
export async function printDaAnotacao(quem: Quem, id: string) {
  const a = await prisma.anotacaoInterna.findFirst({
    where: { id, empresaId: quem.empresaId, usuarioId: quem.usuarioId },
    select: { print: { select: { conteudo: true } } },
  });
  return a?.print?.conteudo ?? null;
}
