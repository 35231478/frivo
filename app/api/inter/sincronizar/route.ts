import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { carregarConfigInter, consultarBoletoInter } from "@/lib/inter-api";

/**
 * Consulta no Inter o status de todos os boletos emitidos e ainda não pagos,
 * atualizando as contas a receber (e medições) que foram pagas/canceladas.
 */
export async function POST() {
  const guard = await exigirPermissao("financeiro", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const { ativo } = await carregarConfigInter(empresaId);
  if (!ativo) return NextResponse.json({ erro: "Integração não configurada/ativa." }, { status: 400 });

  const contas = await prisma.contaReceber.findMany({
    where: { empresaId, boletoStatus: "EMITIDO", boletoId: { not: null } },
    select: { id: true, boletoId: true, medicaoId: true },
    take: 200,
  });

  let pagos = 0, cancelados = 0, erros = 0;
  for (const c of contas) {
    try {
      const det = await consultarBoletoInter(empresaId, c.boletoId!);
      const situacao = String(det?.cobranca?.situacao ?? det?.situacao ?? "").toUpperCase();
      if (situacao === "RECEBIDO" || situacao === "MARCADO_RECEBIDO" || situacao === "PAGO") {
        await prisma.contaReceber.update({ where: { id: c.id }, data: { status: "RECEBIDO", boletoStatus: "PAGO", dataRecebimento: new Date(), formaPagamento: "BOLETO" } });
        if (c.medicaoId) await prisma.medicao.updateMany({ where: { id: c.medicaoId, status: { notIn: ["PAGO", "CANCELADA"] } }, data: { status: "PAGO", dataPagamento: new Date(), formaPagamento: "BOLETO" } });
        pagos++;
      } else if (situacao === "CANCELADO" || situacao === "EXPIRADO") {
        await prisma.contaReceber.update({ where: { id: c.id }, data: { boletoStatus: situacao === "EXPIRADO" ? "VENCIDO" : "CANCELADO" } });
        cancelados++;
      }
    } catch { erros++; }
  }

  return NextResponse.json({ ok: true, total: contas.length, pagos, cancelados, erros });
}
