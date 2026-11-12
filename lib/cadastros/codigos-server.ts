/**
 * Códigos de produto e serviço — lado do servidor: o próximo código da EMPRESA e a criação com código
 * (todo caminho que cria produto/serviço passa por aqui: cadastro, planilha, NF de compra, seed).
 * Regras em lib/cadastros/codigos.ts. O índice único (empresa, código) é a garantia final; a trava da
 * numeração evita que dois cadastros ao mesmo tempo peguem o mesmo número.
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

/**
 * A numeração da empresa é travada (advisory lock da transação) do cálculo do próximo código até o
 * INSERT: dois cadastros ao mesmo tempo esperam um pelo outro em vez de colidir. Sem `tx`, abre uma
 * transação só para isso; com `tx` (ex.: lançar a NF), trava dentro dela até o fim.
 */
async function comTrava<T>(db: Db, empresaId: string, tipo: string, fazer: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const rodar = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`codigo-${tipo}:${empresaId}`}))`;
    return fazer(tx);
  };
  return db === prisma ? prisma.$transaction(rodar) : rodar(db as Prisma.TransactionClient);
}

/** Cria o produto com o próximo código da empresa — `criar` grava COM o `tx` recebido */
export function criarProdutoComCodigo<T>(
  empresaId: string, criar: (codigo: number, tx: Prisma.TransactionClient) => Promise<T>, db: Db = prisma,
): Promise<T> {
  return comTrava(db, empresaId, "produto", async (tx) => criar(await proximoCodigoProduto(empresaId, tx), tx));
}

/**
 * Cria o serviço: com o código informado (já normalizado; repetido = erro de quem chama) ou, sem ele,
 * com o próximo gerado pelo nome — `criar` grava COM o `tx` recebido.
 */
export function criarServicoComCodigo<T>(
  empresaId: string, nome: string, informado: string | null | undefined, criar: (codigo: string, tx: Prisma.TransactionClient) => Promise<T>, db: Db = prisma,
): Promise<T> {
  return comTrava(db, empresaId, "servico", async (tx) => criar(informado || await proximoCodigoServicoDaEmpresa(empresaId, nome, tx), tx));
}

/** Quem já usa este código de serviço na empresa (ao editar, só se consulta um código DIFERENTE do próprio) */
export function servicoComCodigo(empresaId: string, codigo: string, db: Db = prisma) {
  return db.servico.findFirst({ where: { empresaId, codigo }, select: { id: true, nome: true } });
}
