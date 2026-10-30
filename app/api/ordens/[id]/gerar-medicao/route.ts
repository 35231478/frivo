import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { gerarNumeroMedicao } from "@/lib/utils";
import { itensFaturaveisDaOs, osJaFaturada, travarParaFaturar } from "@/lib/faturamento-os";
import { partesBR } from "@/lib/fuso";

type Params = { params: Promise<{ id: string }> };

/**
 * Fatura a OS: gera a medição de ADICIONAL com os itens EXECUTADOS do orçamento da OS
 * + os serviços adicionais marcados "Cobrar" (com o preço definido pelo escritório).
 * A mensalidade do contrato NUNCA sai daqui (é do faturamento mensal do contrato).
 * Regras (F1/C7): só OS CONCLUÍDA; a trava osJaFaturada enxerga TODOS os caminhos;
 * medição cancelada libera o refaturamento (F4). Idempotente: a OS fica TRANCADA na transação que
 * confere a trava e cria a medição — dois cliques ao mesmo tempo devolvem a mesma medição.
 */
export async function POST(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    select: { id: true, numero: true, status: true, clienteId: true },
  });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  if (os.status !== "CONCLUIDA") {
    return NextResponse.json({ erro: "Só uma OS CONCLUÍDA pode ser faturada. Conclua a OS antes de gerar a medição." }, { status: 400 });
  }

  const existente = await osJaFaturada(id);
  if (existente) {
    return NextResponse.json({ id: existente.id, jaExistia: true });
  }

  const { itens, adicionais } = await itensFaturaveisDaOs(id);
  if (itens.length === 0 && adicionais.length === 0) {
    return NextResponse.json({
      erro: "Nada a faturar: a OS não tem itens executados nem serviços adicionais marcados \"Cobrar\" com preço.",
    }, { status: 400 });
  }

  const agora = new Date();
  const { ano, mes: mes0 } = partesBR(agora); // competência pelo mês de Brasília

  const linhas = [
    ...itens.map((it) => ({
      servicoId: it.orcamentoServico?.servicoId ?? null,
      descricao: it.descricao,
      quantidade: Number(it.quantidade),
      valorUnitario: Number(it.valorUnitario),
      valorTotal: Number(it.valorTotal),
    })),
    ...adicionais.map((a) => ({
      servicoId: null as string | null,
      descricao: `Serviço adicional — ${a.descricao}`,
      quantidade: 1,
      valorUnitario: Number(a.valor),
      valorTotal: Number(a.valor),
    })),
  ];
  const valorTotal = linhas.reduce((acc, l) => acc + l.valorTotal, 0);

  const r = await prisma.$transaction(async (tx) => {
    const travadas = await travarParaFaturar(tx, { osIds: [os.id] });
    if (travadas.os.length) return { id: travadas.os[0].medicao.id, jaExistia: true };
    const sequencial = (await tx.medicao.count({ where: { empresaId } })) + 1;
    const numero = gerarNumeroMedicao(sequencial, ano);
    const medicao = await tx.medicao.create({
      data: {
        empresaId,
        clienteId: os.clienteId,
        numero,
        tipo: "ADICIONAL",
        mes: mes0 + 1,
        ano,
        descricao: `Adicional — OS ${os.numero}`,
        status: "RASCUNHO",
        valorTotal,
        valorLiquido: valorTotal,
        tokenPublico: crypto.randomUUID(),
        itens: {
          create: linhas.map((l, idx) => ({
            tipo: "SERVICO" as const,
            ordemServicoId: os.id,
            servicoId: l.servicoId,
            descricao: l.descricao,
            quantidade: l.quantidade,
            valorUnitario: l.valorUnitario,
            valorTotal: l.valorTotal,
            ordem: idx,
          })),
        },
      },
    });
    return { id: medicao.id, jaExistia: false };
  }, { timeout: 20_000 });

  return NextResponse.json(r, { status: r.jaExistia ? 200 : 201 });
}
