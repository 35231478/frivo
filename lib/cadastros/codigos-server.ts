/**
 * Códigos de produto e serviço — lado do servidor: o próximo código da EMPRESA e a criação com código
 * (todo caminho que cria produto/serviço passa por aqui: cadastro, planilha, NF de compra, seed).
 * Regras em lib/cadastros/codigos.ts. Dois cadastros ao mesmo tempo podem pegar o mesmo número: o
 * índice único (empresa, código) recusa o segundo e ele tenta de novo com o próximo.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { prefixoCodigoServico, proximoCodigoServico } from "@/lib/cadastros/codigos";

type Db = Prisma.TransactionClient | typeof prisma;

/** Próximo código do produto: o MAIOR da empresa + 1 (nunca "total + 1") */
export async function proximoCodigoProduto(empresaId: string, db: Db = prisma): Promise<number> {
  const r = await db.produto.aggregate({ where: { empresaId }, _max: { codigo: true } });
  return (r._max.codigo ?? 0) + 1;
}

/** Próximo código do serviço pelo nome ("LIMP" + o maior já usado com esse prefixo + 1) */
export async function proximoCodigoServicoDaEmpresa(empresaId: string, nome: string, db: Db = prisma): Promise<string> {
  const usados = await db.servico.findMany({ where: { empresaId, codigo: { startsWith: prefixoCodigoServico(nome) } }, select: { codigo: true } });
  return proximoCodigoServico(nome, usados.map((u) => u.codigo));
}

/** Colidiu no índice único do código (outro cadastro pegou o mesmo número ao mesmo tempo) */
export const colisaoDeCodigo = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String((e.meta as { target?: unknown })?.target ?? "").includes("codigo");

const TENTATIVAS = 5;

/**
 * Dentro de uma transação (ex.: lançar a NF), trava a numeração da empresa até o fim dela — lá dentro
 * não dá para tentar de novo depois de um erro (a transação inteira é abortada). Fora (sem `tx`), o
 * índice único + nova tentativa resolvem.
 */
const travar = async (db: Db, empresaId: string, tipo: string) => {
  if (db !== prisma) await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`codigo-${tipo}:${empresaId}`}))`;
};

/** Cria o produto com o próximo código da empresa (tenta de novo se outro pegou o número ao mesmo tempo) */
export async function criarProdutoComCodigo<T>(
  empresaId: string, criar: (codigo: number) => Promise<T>, db: Db = prisma,
): Promise<T> {
  for (let i = 0; ; i++) {
    try { await travar(db, empresaId, "produto"); return await criar(await proximoCodigoProduto(empresaId, db)); }
    catch (e) { if (i >= TENTATIVAS - 1 || !colisaoDeCodigo(e)) throw e; }
  }
}

/**
 * Cria o serviço: com o código informado (já normalizado; repetido = erro de quem chama) ou, sem ele,
 * com o próximo gerado pelo nome (tenta de novo se colidir).
 */
export async function criarServicoComCodigo<T>(
  empresaId: string, nome: string, informado: string | null | undefined, criar: (codigo: string) => Promise<T>, db: Db = prisma,
): Promise<T> {
  if (informado) return criar(informado);
  for (let i = 0; ; i++) {
    try { await travar(db, empresaId, "servico"); return await criar(await proximoCodigoServicoDaEmpresa(empresaId, nome, db)); }
    catch (e) { if (i >= TENTATIVAS - 1 || !colisaoDeCodigo(e)) throw e; }
  }
}

/** Quem já usa este código de serviço na empresa (fora o próprio, ao editar) */
export function servicoComCodigo(empresaId: string, codigo: string, exceto?: string, db: Db = prisma) {
  return db.servico.findFirst({ where: { empresaId, codigo, ...(exceto && { id: { not: exceto } }) }, select: { id: true, nome: true } });
}
