import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { valorACobrarDaMedicao } from "@/lib/financeiro-server";
import { baseRetencoes, calcularRetencoes, camposDaMedicao, motivoRetencaoInvalida, RETENCOES, type Retencoes } from "@/lib/financeiro/retencoes";
import { formatarMoeda } from "@/lib/utils";
import { reajustarParcelas } from "@/lib/financeiro/parcelas-server";

type Params = { params: Promise<{ id: string }> };
class ConflitoConta extends Error {}

const aliquota = z.number().finite().nullable().optional();
const schema = z.object(Object.fromEntries(RETENCOES.map((d) => [d.chave, aliquota])) as Record<(typeof RETENCOES)[number]["chave"], typeof aliquota>);

const texto = (r: Retencoes, base: number) => {
  const d = calcularRetencoes(base, r);
  return d.linhas.length ? d.linhas.map((l) => `${l.rotulo} ${String(l.aliquota).replace(".", ",")}%`).join(", ") : "nenhuma";
};

/**
 * Retenções na fonte da medição (quem marca é o usuário). Grava as alíquotas e o total retido, e a
 * conta a receber da medição passa a cobrar valor da nota − retenções. Não muda com boleto emitido
 * (o boleto já saiu com o valor antigo), conta recebida, medição paga/cancelada, nem quando a medição
 * tem várias contas (contratos da fatura única — o desconto não teria em qual conta cair).
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const novas: Retencoes = Object.fromEntries(RETENCOES.map((d) => [d.chave, parsed.data[d.chave] ?? null]));

  const medicao = await prisma.medicao.findFirst({
    where: { id, empresaId },
    include: {
      contasReceber: { where: { status: { not: "CANCELADO" }, excluidaEm: null }, select: { id: true, numero: true, status: true, valor: true, boletoStatus: true } },
      itens: { select: { tipo: true, valorTotal: true } },
    },
  });
  if (!medicao) return NextResponse.json({ erro: "Medição não encontrada" }, { status: 404 });
  if (medicao.status === "PAGO" || medicao.status === "CANCELADA") {
    return NextResponse.json({ erro: medicao.status === "PAGO" ? "Medição paga: as retenções não mudam mais." : "Medição cancelada." }, { status: 409 });
  }
  // Base = o valor da nota (os serviços); a conta continua sendo o líquido − retenções
  const base = baseRetencoes(medicao);
  const invalida = motivoRetencaoInvalida(base, novas);
  if (invalida) return NextResponse.json({ erro: invalida }, { status: 400 });

  const contas = medicao.contasReceber;
  if (contas.some((c) => c.status === "RECEBIDO")) return NextResponse.json({ erro: "Conta já recebida: as retenções não mudam mais." }, { status: 409 });
  if (contas.some((c) => c.status === "PERDA")) return NextResponse.json({ erro: "Conta em perda: as retenções não mudam mais." }, { status: 409 });
  if (contas.some((c) => c.boletoStatus === "EMITIDO")) return NextResponse.json({ erro: "Boleto emitido: cancele o boleto antes de mudar as retenções." }, { status: 409 });
  if (contas.length > 1) return NextResponse.json({ erro: "Esta medição tem várias contas (contratos): retenção não disponível aqui." }, { status: 409 });

  const detalhe = calcularRetencoes(base, novas);
  const conta = contas[0];
  const valorNovo = valorACobrarDaMedicao({ valorLiquido: medicao.valorLiquido, valorRetencoes: detalhe.total });

  try {
    await prisma.$transaction(async (tx) => {
      // Só grava se ninguém emitiu boleto/recebeu no meio (mesma regra de cima, agora atômica)
      if (conta?.status === "PARCELADO") {
        // Conta parcelada: o total novo se reparte nas parcelas (na mesma proporção), enquanto nenhuma
        // teve recebimento/boleto; senão recusa com o motivo
        const motivo = await reajustarParcelas(tx, { empresaId, lancamentoId: conta.id, novoTotal: valorNovo, usuarioId: session.user!.id, motivo: "Retenções" });
        if (motivo) throw new ConflitoConta(motivo);
        await tx.contaReceberEvento.create({
          data: {
            empresaId, contaReceberId: conta.id, tipo: "RETENCOES", usuarioId: session.user!.id,
            detalhe: `${texto(novas, base)} · valor ${formatarMoeda(Number(conta.valor))} → ${formatarMoeda(valorNovo)}`,
          },
        });
      } else if (conta) {
        const { count } = await tx.contaReceber.updateMany({
          where: { id: conta.id, status: { notIn: ["RECEBIDO", "CANCELADO", "PERDA"] }, OR: [{ boletoStatus: null }, { boletoStatus: { not: "EMITIDO" } }] },
          data: { valor: valorNovo },
        });
        if (count !== 1) throw new ConflitoConta();
        await tx.contaReceberEvento.create({
          data: {
            empresaId, contaReceberId: conta.id, tipo: "RETENCOES", usuarioId: session.user!.id,
            detalhe: `${texto(novas, base)} · valor ${formatarMoeda(Number(conta.valor))} → ${formatarMoeda(valorNovo)}`,
          },
        });
      }
      await tx.medicao.update({ where: { id }, data: { ...camposDaMedicao(novas), valorRetencoes: detalhe.total } });
    });
  } catch (e) {
    if (!(e instanceof ConflitoConta)) throw e;
    return NextResponse.json({ erro: e.message || "A conta mudou enquanto você editava (boleto ou recebimento). Atualize a tela." }, { status: 409 });
  }
  return NextResponse.json({ ok: true, ...detalhe, contaReceber: conta ? { id: conta.id, numero: conta.numero, valor: valorNovo } : null });
}
