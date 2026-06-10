import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Webhook de cobrança do Banco Inter. A URL registrada inclui ?token=<webhookSecret>
 * (gerado por empresa) — usamos esse token para identificar a empresa e autenticar a
 * notificação, já que a chamada do Inter chega via mTLS/IP do banco.
 *
 * Liberado no middleware (rota pública).
 */
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ erro: "token ausente" }, { status: 401 });

  const integracao = await prisma.integracaoInter.findFirst({ where: { webhookSecret: token } });
  if (!integracao) return NextResponse.json({ erro: "token inválido" }, { status: 401 });
  const empresaId = integracao.empresaId;

  const corpo = await req.json().catch(() => null);
  const eventos: any[] = Array.isArray(corpo) ? corpo : corpo ? [corpo] : [];

  let processados = 0;
  for (const ev of eventos) {
    const codigoSolicitacao = ev.codigoSolicitacao ?? ev.cobranca?.codigoSolicitacao;
    const nossoNumero = ev.nossoNumero ?? ev.boleto?.nossoNumero;
    const situacao = String(ev.situacao ?? ev.cobranca?.situacao ?? "").toUpperCase();

    const conta = await prisma.contaReceber.findFirst({
      where: {
        empresaId,
        OR: [
          codigoSolicitacao ? { boletoId: codigoSolicitacao } : undefined,
          nossoNumero ? { boletoNossoNumero: nossoNumero } : undefined,
        ].filter(Boolean) as any,
      },
    });
    if (!conta) continue;

    if (situacao === "RECEBIDO" || situacao === "MARCADO_RECEBIDO" || situacao === "PAGO") {
      const dataPg = ev.dataHoraSituacao ? new Date(ev.dataHoraSituacao) : new Date();
      await prisma.contaReceber.update({
        where: { id: conta.id },
        data: { status: "RECEBIDO", boletoStatus: "PAGO", dataRecebimento: dataPg, formaPagamento: "BOLETO" },
      });
      if (conta.medicaoId) {
        await prisma.medicao.updateMany({
          where: { id: conta.medicaoId, status: { notIn: ["PAGO", "CANCELADA"] } },
          data: { status: "PAGO", dataPagamento: dataPg, formaPagamento: "BOLETO" },
        });
      }
      processados++;
    } else if (situacao === "CANCELADO" || situacao === "EXPIRADO") {
      await prisma.contaReceber.update({
        where: { id: conta.id },
        data: { boletoStatus: situacao === "EXPIRADO" ? "VENCIDO" : "CANCELADO" },
      });
      processados++;
    }
  }

  return NextResponse.json({ ok: true, processados });
}

// O Inter pode validar a URL com um GET/HEAD — respondemos 200.
export async function GET() {
  return NextResponse.json({ ok: true });
}
