import { prisma } from "@/lib/prisma";
import { anoBR } from "@/lib/fuso";
import { codigoOrcamento } from "@/lib/orcamentos/proposta";

/**
 * Próximo código do orçamento do ano ("ORC-2026-0147"), por empresa, pelo MAIOR sequencial já usado
 * — a mesma regra da numeração da OS (lib/os-server.ts). Nunca "total + 1" (colide depois de excluir)
 * e nunca a ordem de texto do código ("ORC-2026-9999" > "ORC-2026-10000" como texto).
 */
export async function proximoCodigoOrcamento(empresaId: string, ano = anoBR()): Promise<string> {
  const prefixo = `ORC-${ano}-`;
  const [r] = await prisma.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(split_part(codigo, '-', 3) AS INTEGER)) AS max
    FROM orcamentos
    WHERE empresa_id = ${empresaId} AND codigo LIKE ${prefixo + "%"} AND split_part(codigo, '-', 3) ~ '^[0-9]{1,9}$'`;
  return codigoOrcamento(ano, (r?.max ?? 0) + 1);
}
