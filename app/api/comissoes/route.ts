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
 * nascerem daqui em diante — e o vencimento da conta a pagar do fechamento, que vale para o próximo fechamento) e, da
 * COM-2, opcionais: quando a comissão do técnico fica devida, os dias do retorno e os tipos de OS que contam como
 * retorno (a mesma lista do Desempenho); da COM-1.2, se a renovação do contrato também gera comissão.
 */
export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("desempenho", "gerenciar");
  if (guard.erro) return guard.resposta;
  const parsed = configComissaoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.errors[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const empresaId = guard.session.user!.empresaId;
  const d = parsed.data;
  if (d.tiposRetorno?.length && (await prisma.tipoOs.count({ where: { empresaId, id: { in: d.tiposRetorno } } })) !== new Set(d.tiposRetorno).size) {
    return NextResponse.json({ erro: "Tipo de OS não encontrado nesta empresa." }, { status: 400 });
  }
  const data = {
    comissaoQuando: d.quando, comissaoLiquidaImpostos: d.liquidaImpostos,
    // COM-1.1: o vencimento da conta a pagar do fechamento
    ...(d.vencimentoTipo ? { comissaoVencimentoTipo: d.vencimentoTipo, comissaoVencimentoDia: d.vencimentoDia } : {}),
    // COM-2: o técnico
    ...(d.executorQuando ? { comissaoExecutorQuando: d.executorQuando } : {}),
    ...(d.retornoDias !== undefined ? { comissaoRetornoDias: d.retornoDias } : {}),
    // COM-1.2: a renovação do contrato também gera?
    ...(d.renovacaoGera !== undefined ? { comissaoRenovacaoGera: d.renovacaoGera } : {}),
  };
  await prisma.$transaction(async (tx) => {
    await tx.configuracao.upsert({ where: { empresaId }, update: data, create: { empresaId, ...data } });
    if (d.tiposRetorno) {
      await tx.desempenhoTipoRetorno.deleteMany({ where: { empresaId, tipoOsId: { notIn: d.tiposRetorno } } });
      const ja = (await tx.desempenhoTipoRetorno.findMany({ where: { empresaId }, select: { tipoOsId: true } })).map((t) => t.tipoOsId);
      const novos = [...new Set(d.tiposRetorno)].filter((t) => !ja.includes(t));
      if (novos.length) await tx.desempenhoTipoRetorno.createMany({ data: novos.map((tipoOsId) => ({ empresaId, tipoOsId })) });
    }
  });
  return NextResponse.json({ ok: true });
}
