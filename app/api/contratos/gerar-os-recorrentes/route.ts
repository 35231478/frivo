import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { intervaloMeses, ehOcorrencia, dataAgendadaRecorrencia } from "@/lib/recorrencia-helpers";

/**
 * Gera OS recorrentes para todos os contratos ativos com recorrência habilitada.
 * Body opcional: { mes, ano }. Default: mês/ano corrente. Idempotente por período.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const body = await req.json().catch(() => ({}));
  const agora = new Date();
  const mes = Number(body?.mes) || agora.getMonth() + 1;
  const ano = Number(body?.ano) || agora.getFullYear();

  const inicioMes = new Date(ano, mes - 1, 1, 0, 0, 0);
  const fimMes = new Date(ano, mes, 0, 23, 59, 59);

  const contratos = await prisma.contrato.findMany({
    where: {
      empresaId,
      status: "ATIVO",
      recorrencia: true,
      frequenciaRecorrencia: { not: null },
    },
    include: { cliente: { select: { nome: true, nomeFantasia: true } }, tipoOsRecorrencia: { select: { id: true, nome: true } } },
  });

  let seq = await prisma.ordemServico.count({ where: { empresaId } });
  let criadas = 0;
  let ignoradas = 0;
  const resultado: { contrato: string; numero?: string; status: string }[] = [];

  for (const ct of contratos) {
    const rotulo = `${ct.numero} — ${ct.cliente.nomeFantasia ?? ct.cliente.nome}`;

    // Vigência
    if (ct.dataInicio > fimMes) { ignoradas++; resultado.push({ contrato: rotulo, status: "fora da vigência" }); continue; }
    if (ct.dataFim && ct.dataFim < inicioMes) { ignoradas++; resultado.push({ contrato: rotulo, status: "contrato encerrado" }); continue; }

    const intervalo = intervaloMeses(ct.frequenciaRecorrencia);
    if (!ehOcorrencia(ct.dataInicio, ano, mes, intervalo)) {
      ignoradas++; resultado.push({ contrato: rotulo, status: "não é mês de ocorrência" }); continue;
    }

    const periodo = `${ano}-${String(mes).padStart(2, "0")}`;
    const jaExiste = await prisma.ordemServico.findFirst({
      where: { empresaId, contratoId: ct.id, periodoRecorrencia: periodo },
      select: { id: true },
    });
    if (jaExiste) { ignoradas++; resultado.push({ contrato: rotulo, status: "já gerada" }); continue; }

    const dataAgendada = dataAgendadaRecorrencia(ano, mes, ct.diaRecorrencia ?? 1, ct.fimSemanaRecorrencia);
    seq++;
    const numero = `OS-${ano}-${String(seq).padStart(4, "0")}`;
    const tituloTipo = ct.tipoOsRecorrencia?.nome ?? "Atendimento recorrente";

    const os = await prisma.ordemServico.create({
      data: {
        empresaId,
        numero,
        clienteId: ct.clienteId,
        contratoId: ct.id,
        criadoPorId: usuarioId,
        status: "AGENDADA",
        origem: "RECORRENTE",
        periodoRecorrencia: periodo,
        prioridade: "NORMAL",
        descricao: `${tituloTipo} — contrato ${ct.numero} (${String(mes).padStart(2, "0")}/${ano})`,
        previsaoConclusao: dataAgendada,
        atividades: (ct.tipoOsRecorrenciaId || ct.tecnicoRecorrenciaId)
          ? {
              create: {
                empresaId,
                tipoOsId: ct.tipoOsRecorrenciaId || null,
                tecnicoId: ct.tecnicoRecorrenciaId || null,
                titulo: tituloTipo,
                status: "AGENDADA",
                dataAgendada,
              },
            }
          : undefined,
      },
    });

    await prisma.osHistorico.create({
      data: { ordemServicoId: os.id, usuarioId, acao: "OS recorrente gerada", detalhes: `Gerada automaticamente do contrato ${ct.numero} (${periodo}).` },
    });

    criadas++;
    resultado.push({ contrato: rotulo, numero, status: "criada" });
  }

  return NextResponse.json({ ok: true, mes, ano, criadas, ignoradas, resultado });
}
