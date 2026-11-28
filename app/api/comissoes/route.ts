import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { configComissaoSchema } from "@/lib/comissoes/regras";
import { telaDeComissoes } from "@/lib/comissoes/servidor";

/**
 * COM-1 — Configurações › Comissões: as regras, QUANDO a comissão fica devida e a base. Valores de pagamento:
 * "Desempenho › Gerenciar" (o mesmo de quem configura bônus e fecha o mês).
 */
export async function GET() {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json(await telaDeComissoes(guard.session.user!.empresaId));
}

/**
 * Grava a configuração da empresa (quando fica devida, base líquida de impostos — vale para as comissões que
 * nascerem daqui em diante — e o vencimento da conta a pagar do fechamento, que vale para o próximo fechamento).
 */
export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = configComissaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const empresaId = guard.session.user!.empresaId;
  const data = {
    comissaoQuando: parsed.data.quando, comissaoLiquidaImpostos: parsed.data.liquidaImpostos,
    ...(parsed.data.vencimentoTipo ? { comissaoVencimentoTipo: parsed.data.vencimentoTipo, comissaoVencimentoDia: parsed.data.vencimentoDia } : {}),
  };
  await prisma.configuracao.upsert({ where: { empresaId }, update: data, create: { empresaId, ...data } });
  return NextResponse.json({ ok: true });
}
