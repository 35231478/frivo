import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { intervaloMeses, ehOcorrencia, dataAgendadaRecorrencia } from "@/lib/recorrencia-helpers";
import { anoBR, mesBR } from "@/lib/fuso";
import { comNumero } from "@/lib/numeracao-server";

/**
 * Gera OS recorrentes para todos os contratos ativos com recorrência habilitada.
 * Body opcional: { mes, ano }. Default: mês/ano corrente. Idempotente por período.
 */
export async function POST(req: NextRequest) {
  // Gera OS: quem cria OS ou quem administra o contrato (relatório de contratos)
  const guard = await exigirAlgumaPermissao([["ordens", "criar"], ["contratos", "editar"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;
  const usuarioId = session.user!.id;

  const body = await req.json().catch(() => ({}));
  const agora = new Date();
  const mes = Number(body?.mes) || mesBR(agora);
  const ano = Number(body?.ano) || anoBR(agora);

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
    const tituloTipo = ct.tipoOsRecorrencia?.nome ?? "Atendimento recorrente";

    // Número pelo contador da empresa (rótulo = ano da competência), sob trava, na transação do INSERT
    const os = await comNumero(empresaId, "os", (numero, tx) => tx.ordemServico.create({
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
    }));

    await prisma.osHistorico.create({
      data: { ordemServicoId: os.id, usuarioId, acao: "OS recorrente gerada", detalhes: `Gerada automaticamente do contrato ${ct.numero} (${periodo}).` },
    });

    criadas++;
    resultado.push({ contrato: rotulo, numero: os.numero, status: "criada" });
  }

  return NextResponse.json({ ok: true, mes, ano, criadas, ignoradas, resultado });
}
