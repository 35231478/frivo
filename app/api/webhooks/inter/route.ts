import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consultarBoletoInter } from "@/lib/inter-api";

/**
 * Webhook de cobrança do Banco Inter. A URL registrada inclui ?token=<webhookSecret>
 * (gerado por empresa) — o token identifica a empresa e autentica a notificação.
 *
 * O corpo do webhook é tratado como um AVISO, nunca como prova de pagamento: antes de
 * baixar qualquer conta, a situação REAL da cobrança é confirmada na API do Inter
 * (consultarBoletoInter). Um corpo forjado por quem conheça o token não baixa nada.
 *
 * Liberado no middleware (rota pública).
 */

/** Situações do Inter que valem como pagamento confirmado. */
const SITUACOES_PAGAS = ["RECEBIDO", "MARCADO_RECEBIDO", "PAGO"];

/** Confirma na API do Inter a situação real da cobrança (null = não confirmada). */
async function situacaoConfirmada(empresaId: string, codigoSolicitacao: string | null): Promise<string | null> {
  if (!codigoSolicitacao) return null; // sem código não há como confirmar — não baixa
  try {
    const det = await consultarBoletoInter(empresaId, codigoSolicitacao);
    return String(det?.cobranca?.situacao ?? det?.situacao ?? "").toUpperCase() || null;
  } catch {
    return null; // Inter fora do ar ou cobrança desconhecida: não baixa
  }
}
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
    // Conta cancelada ou já recebida nunca é mexida pelo webhook
    if (conta.status === "CANCELADO" || conta.status === "RECEBIDO") continue;

    // O que vale é a situação CONFIRMADA no Inter, não a do corpo recebido
    const confirmada = await situacaoConfirmada(empresaId, conta.boletoId);
    if (!confirmada) continue;

    if (SITUACOES_PAGAS.includes(situacao) && SITUACOES_PAGAS.includes(confirmada)) {
      const dataPg = ev.dataHoraSituacao ? new Date(ev.dataHoraSituacao) : new Date();
      await prisma.contaReceber.updateMany({
        where: { id: conta.id, status: { notIn: ["CANCELADO", "RECEBIDO"] } },
        data: { status: "RECEBIDO", boletoStatus: "PAGO", dataRecebimento: dataPg, formaPagamento: "BOLETO" },
      });
      if (conta.medicaoId) {
        await prisma.medicao.updateMany({
          where: { id: conta.medicaoId, status: { notIn: ["PAGO", "CANCELADA"] } },
          data: { status: "PAGO", dataPagamento: dataPg, formaPagamento: "BOLETO" },
        });
      }
      processados++;
    } else if ((situacao === "CANCELADO" || situacao === "EXPIRADO") && ["CANCELADO", "EXPIRADO"].includes(confirmada)) {
      await prisma.contaReceber.update({
        where: { id: conta.id },
        data: { boletoStatus: confirmada === "EXPIRADO" ? "VENCIDO" : "CANCELADO" },
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
