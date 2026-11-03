import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { anoBR } from "@/lib/fuso";
import {
  formatarNumero, mensagemMinimo, minimoPermitido, NUMERACOES, regexNumero, TIPOS_NUMERACAO, type NumeracaoTela, type TipoNumeracao,
} from "@/lib/numeracao";

/**
 * Numeração de documentos — lado do servidor. TODO ponto que gera número de orçamento, OS, chamado,
 * contrato, medição/fatura, pedido de compra, conta a receber/pagar, relatório da OS ou QR passa por
 * `proximoNumero` (ou `reservarNumeros`), sempre dentro de uma transação e sob a trava da empresa+tipo
 * (`pg_advisory_xact_lock`, o mesmo padrão dos códigos de produto/serviço): dois pedidos ao mesmo
 * tempo esperam um pelo outro em vez de pegar o mesmo número.
 *
 * O contador (tabela `numeracoes`) guarda o PRÓXIMO sequencial. Sem linha, o 1º uso semeia com o
 * maior número já gravado + 1, em qualquer ano (numeração contínua): nada anda para trás e os
 * documentos existentes não mudam. Configurações pode definir o próximo, nunca abaixo do maior usado.
 */
type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;

const chaveTrava = (empresaId: string, tipo: TipoNumeracao) => `numeracao:${empresaId}:${tipo}`;

async function travar(tx: Tx, empresaId: string, tipo: TipoNumeracao) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chaveTrava(empresaId, tipo)}))`;
}

/** O maior sequencial já gravado deste tipo na empresa, em QUALQUER ano (0 = nenhum) */
export async function maiorUsado(db: Db, empresaId: string, tipo: TipoNumeracao): Promise<number> {
  const d = NUMERACOES[tipo];
  // tabela e coluna vêm da tabela fixa NUMERACOES (nunca do usuário); o id da empresa vai como parâmetro
  const sql = `SELECT MAX(CAST(split_part(split_part("${d.coluna}", '/', 1), '-', 3) AS BIGINT)) AS max
    FROM "${d.tabela}" WHERE "empresa_id" = $1 AND "${d.coluna}" ~ $2`;
  const [r] = await db.$queryRawUnsafe<{ max: bigint | number | null }[]>(sql, empresaId, regexNumero(tipo));
  return Number(r?.max ?? 0);
}

/** Reserva `quantidade` números em sequência (sob a trava); devolve-os formatados com o ano dado */
export async function reservarNumeros(tx: Tx, empresaId: string, tipo: TipoNumeracao, quantidade: number, ano = anoBR()): Promise<string[]> {
  if (quantidade < 1) return [];
  await travar(tx, empresaId, tipo);
  // O contador configurado OU o maior já gravado + 1, o que for maior: um número digitado à mão
  // (contrato), importado ou semeado por fora nunca é repetido
  const atual = await tx.numeracao.findUnique({ where: { empresaId_tipo: { empresaId, tipo } }, select: { proximo: true } });
  const inicio = Math.max(atual?.proximo ?? 0, minimoPermitido(await maiorUsado(tx, empresaId, tipo)));
  await tx.numeracao.upsert({
    where: { empresaId_tipo: { empresaId, tipo } },
    create: { empresaId, tipo, proximo: inicio + quantidade },
    update: { proximo: inicio + quantidade },
  });
  return Array.from({ length: quantidade }, (_, i) => formatarNumero(tipo, inicio + i, ano));
}

/** O próximo número deste tipo, formatado com o ano dado (o de hoje, ou o da competência) — dentro da transação */
export async function proximoNumero(tx: Tx, empresaId: string, tipo: TipoNumeracao, ano = anoBR()): Promise<string> {
  const [n] = await reservarNumeros(tx, empresaId, tipo, 1, ano);
  return n;
}

/**
 * Para quem está FORA de uma transação: abre uma só para isso, pega o número e grava com o `tx`
 * recebido (a trava segura até o commit). Com `db` = transação, usa a dela.
 */
export function comNumero<T>(
  empresaId: string, tipo: TipoNumeracao, fazer: (numero: string, tx: Tx) => Promise<T>, opcoes: { ano?: number; db?: Db } = {},
): Promise<T> {
  const rodar = async (tx: Tx) => fazer(await proximoNumero(tx, empresaId, tipo, opcoes.ano), tx);
  const db = opcoes.db ?? prisma;
  return db === prisma ? prisma.$transaction(rodar) : rodar(db as Tx);
}

/** Só OLHA o próximo número (sem consumir): a sugestão do contrato, cujo número é digitável e confirmado ao salvar */
export async function espiarProximo(empresaId: string, tipo: TipoNumeracao, ano = anoBR()): Promise<string> {
  const atual = await prisma.numeracao.findUnique({ where: { empresaId_tipo: { empresaId, tipo } }, select: { proximo: true } });
  return formatarNumero(tipo, Math.max(atual?.proximo ?? 0, minimoPermitido(await maiorUsado(prisma, empresaId, tipo))), ano);
}

/** A tela de Configurações: cada tipo com o maior usado, o próximo e o exemplo */
export async function lerNumeracoes(empresaId: string, ano = anoBR()): Promise<NumeracaoTela[]> {
  const contadores = await prisma.numeracao.findMany({ where: { empresaId }, select: { tipo: true, proximo: true } });
  const porTipo = new Map(contadores.map((c) => [c.tipo, c.proximo]));
  return Promise.all(TIPOS_NUMERACAO.map(async (tipo) => {
    const d = NUMERACOES[tipo];
    const maior = await maiorUsado(prisma, empresaId, tipo);
    const configurado = porTipo.has(tipo);
    const proximo = Math.max(porTipo.get(tipo) ?? 0, minimoPermitido(maior));
    return { tipo, rotulo: d.rotulo, prefixo: d.prefixo, dica: d.dica, maiorUsado: maior, proximo, configurado, exemplo: formatarNumero(tipo, proximo, ano) };
  }));
}

export type ResultadoDefinir = { ok: true; proximo: number; exemplo: string } | { ok: false; erro: string; minimo: number };

/**
 * Define o próximo número de um tipo (Configurações). Sob a MESMA trava da geração: nenhum número é
 * gerado enquanto a conferência e a gravação acontecem. Recusa valor igual ou abaixo do maior já usado.
 */
export function definirProximo(empresaId: string, tipo: TipoNumeracao, proximo: number, ano = anoBR()): Promise<ResultadoDefinir> {
  return prisma.$transaction(async (tx) => {
    await travar(tx, empresaId, tipo);
    const maior = await maiorUsado(tx, empresaId, tipo);
    if (proximo < minimoPermitido(maior)) return { ok: false, erro: mensagemMinimo(tipo, maior), minimo: minimoPermitido(maior) };
    await tx.numeracao.upsert({
      where: { empresaId_tipo: { empresaId, tipo } },
      create: { empresaId, tipo, proximo },
      update: { proximo },
    });
    return { ok: true, proximo, exemplo: formatarNumero(tipo, proximo, ano) };
  });
}
