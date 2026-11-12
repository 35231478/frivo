import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aprovacaoPublicaSchema } from "@/lib/validations";
import { diaCivilPassou } from "@/lib/fuso";
import { ipDaRequisicao } from "@/lib/orcamentos/ciclo";
import { avisarResponsavel, registrarEvento } from "@/lib/orcamentos/ciclo-server";

/**
 * Aceite digital no link público: nome, CPF e assinatura de quem aprova, com data/hora, IP e
 * navegador gravados. Só um orçamento ENVIADO e dentro da validade; a troca de status é atômica
 * (dois cliques não aprovam duas vezes). Avisa o responsável (e-mail + sino). Não cria conta a
 * receber: o aprovado fica "a faturar" até o "Faturar" (Opção A, P2).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);

  const parsed = aprovacaoPublicaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { erro: "Dados de aprovação inválidos", detalhes: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const orcamento = await prisma.orcamento.findUnique({ where: { tokenPublico: token } });
  if (!orcamento) return NextResponse.json({ erro: "Orçamento não encontrado" }, { status: 404 });
  if (orcamento.status !== "ENVIADO") {
    return NextResponse.json(
      { erro: "Este orçamento não está disponível para aprovação" },
      { status: 400 }
    );
  }
  if (diaCivilPassou(orcamento.validadeEm)) { // validade é dia civil: aprova até o fim do dia (Brasília)
    return NextResponse.json({ erro: "Orçamento expirado" }, { status: 410 });
  }

  const cpfLimpo = parsed.data.cpf.replace(/\D/g, "");
  const ip = ipDaRequisicao(req.headers);
  const nome = parsed.data.nome.trim();

  const r = await prisma.orcamento.updateMany({
    where: { id: orcamento.id, status: "ENVIADO" },
    data: {
      status: "APROVADO",
      assinadoEm: new Date(),
      assinadoPor: nome,
      assinadoCpf: cpfLimpo,
      assinaturaUrl: parsed.data.assinaturaUrl,
      aprovadoIp: ip,
      aprovadoUserAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  if (r.count !== 1) return NextResponse.json({ erro: "Este orçamento não está disponível para aprovação" }, { status: 400 });
  await registrarEvento({ empresaId: orcamento.empresaId, orcamentoId: orcamento.id, tipo: "APROVADO", detalhe: nome, ip });

  // Opção A (P2): aprovar NÃO cria conta a receber. O orçamento aprovado fica "a faturar" (calculado:
  // lib/financeiro/a-faturar.ts) e entra na previsão do painel; a cobrança nasce no "Faturar".
  await avisarResponsavel(orcamento.id, "APROVADO");

  return NextResponse.json({ ok: true, status: "APROVADO" });
}
