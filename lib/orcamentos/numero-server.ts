import type { Prisma } from "@prisma/client";
import { proximoNumero } from "@/lib/numeracao-server";

/**
 * Próximo código do orçamento ("ORC-147"), pelo contador da empresa (Configurações › Numeração
 * de documentos), sob trava e dentro da transação de quem grava — numeração contínua (não reinicia no
 * ano; o ano no código é só o rótulo de quando nasceu).
 */
export const proximoCodigoOrcamento = (tx: Prisma.TransactionClient, empresaId: string) => proximoNumero(tx, empresaId, "orcamento");
