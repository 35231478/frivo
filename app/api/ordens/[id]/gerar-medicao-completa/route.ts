import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { gerarNumeroRelatorio } from "@/lib/utils";
import { criarMedicaoDeRelatorio } from "@/lib/financeiro-server";
import { osJaFaturada } from "@/lib/faturamento-os";

type Params = { params: Promise<{ id: string }> };

/**
 * Gera o documento integrado Medição + Relatório a partir da OS.
 * Cria (idempotente) um relatório de escopo MEDICAO_COMPLETA e a medição
 * financeira vinculada (status conforme o perfil do cliente).
 * Retorna o token público da medição para abrir /medicao/[token].
 */
export async function POST(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("financeiro", "medicoes");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    include: {
      itensOrcamento: true,
      relatorios: { where: { escopo: "MEDICAO_COMPLETA" }, include: { medicao: { select: { tokenPublico: true, status: true } } } },
    },
  });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  if (os.status !== "CONCLUIDA") {
    return NextResponse.json({ erro: "Só uma OS CONCLUÍDA pode ser faturada. Conclua a OS antes de gerar a medição." }, { status: 400 });
  }
  // OS de CONTRATO não cobra a mensalidade por aqui (F2): 3 preventivas no mês viravam
  // 3 mensalidades. A mensalidade é do faturamento mensal do contrato (Medições › Gerar mês).
  if (os.contratoId) {
    return NextResponse.json({
      erro: "Esta OS pertence a um contrato: a mensalidade é faturada pelo faturamento mensal do contrato (Medições › Gerar mês). Itens e adicionais desta OS saem pelo botão \"Gerar medição\".",
    }, { status: 409 });
  }

  // Idempotente: já existe documento de medição completa com medição VIVA (cancelada refatura — F4)
  const existente = os.relatorios.find((r) => r.medicao && r.medicao.status !== "CANCELADA" && r.medicao.tokenPublico);
  if (existente?.medicao?.tokenPublico) {
    return NextResponse.json({ ok: true, medicaoToken: existente.medicao.tokenPublico, jaExistia: true });
  }
  // A trava única também enxerga o OUTRO caminho (itens já numa medição de adicional)
  const outra = await osJaFaturada(id);
  if (outra) {
    return NextResponse.json({ erro: `Esta OS já está na medição ${outra.numero}. Cancele-a antes de refaturar.` }, { status: 409 });
  }

  const ref = os.dataConclusao ?? new Date();
  // Sem contrato, o valor é o dos itens EXECUTADOS (não o orçado inteiro)
  const valor = os.itensOrcamento.filter((it) => it.executado).reduce((acc, it) => acc + Number(it.valorTotal), 0);
  if (valor <= 0) {
    return NextResponse.json({ erro: "Nada a faturar: a OS não tem itens executados." }, { status: 400 });
  }

  // Reaproveita um relatório MEDICAO_COMPLETA sem medição viva, ou cria um novo
  let relatorioId: string | null = os.relatorios.find((r) => !r.medicaoId || r.medicao?.status === "CANCELADA")?.id ?? null;
  if (!relatorioId) {
    const seq = (await prisma.relatorioOs.count({ where: { empresaId } })) + 1;
    const novo = await prisma.relatorioOs.create({
      data: {
        empresaId,
        ordemServicoId: os.id,
        contratoId: os.contratoId,
        numero: gerarNumeroRelatorio(seq, ref.getFullYear()),
        tipo: "MEDICAO",
        escopo: "MEDICAO_COMPLETA",
        mesReferencia: ref.getMonth() + 1,
        anoReferencia: ref.getFullYear(),
        valorFinanceiro: valor,
        status: "RASCUNHO",
        tokenPublico: crypto.randomUUID(),
      },
    });
    relatorioId = novo.id;
  }

  const medicao = await criarMedicaoDeRelatorio(relatorioId);
  if (!medicao) return NextResponse.json({ erro: "Falha ao gerar medição" }, { status: 500 });

  return NextResponse.json({ ok: true, medicaoToken: medicao.tokenPublico, jaExistia: false }, { status: 201 });
}
