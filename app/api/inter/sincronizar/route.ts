import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { carregarConfigInter, consultarBoletoInter } from "@/lib/inter-api";
import { ErroConta, registrarRecebimento } from "@/lib/financeiro/parcelas-server";

/**
 * Consulta no Inter o status de todos os boletos emitidos e ainda não pagos,
 * atualizando as contas a receber (e medições) que foram pagas/canceladas.
 */
export async function POST() {
  const guard = await exigirPermissao("financeiro", "contasReceber");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const { ativo } = await carregarConfigInter(empresaId);
  if (!ativo) return NextResponse.json({ erro: "Integração não configurada/ativa." }, { status: 400 });

  const contas = await prisma.contaReceber.findMany({
    where: { empresaId, boletoStatus: "EMITIDO", boletoId: { not: null } },
    select: { id: true, boletoId: true },
    take: 200,
  });

  let pagos = 0, cancelados = 0, erros = 0;
  for (const c of contas) {
    try {
      const det = await consultarBoletoInter(empresaId, c.boletoId!);
      const situacao = String(det?.cobranca?.situacao ?? det?.situacao ?? "").toUpperCase();
      if (situacao === "RECEBIDO" || situacao === "MARCADO_RECEBIDO" || situacao === "PAGO") {
        try {
          await prisma.$transaction((tx) => registrarRecebimento(tx, {
            empresaId, contaId: c.id, data: new Date(), formaPagamento: "BOLETO", origem: "BOLETO", boletoPago: true,
          }), { timeout: 20_000 });
          pagos++;
        } catch (e) {
          if (!(e instanceof ErroConta)) throw e;
          // Já recebida à mão (baixa total por fora): só o boleto passa a pago
          await prisma.contaReceber.update({ where: { id: c.id }, data: { boletoStatus: "PAGO" } });
        }
      } else if (situacao === "CANCELADO" || situacao === "EXPIRADO") {
        await prisma.contaReceber.update({ where: { id: c.id }, data: { boletoStatus: situacao === "EXPIRADO" ? "VENCIDO" : "CANCELADO" } });
        cancelados++;
      }
    } catch { erros++; }
  }

  return NextResponse.json({ ok: true, total: contas.length, pagos, cancelados, erros });
}
