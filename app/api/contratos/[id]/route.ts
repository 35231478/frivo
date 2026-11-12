import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { exigirPermissao } from "@/lib/permissoes-server";
import { faltaPermissaoAutomacao } from "@/lib/contratos/automacao";
import { contratoSchema } from "@/lib/validations";
import { contratoGeraFinanceiro, encerrarFinanceiroDoContrato, gerarPrevisaoContratoContasReceber, sincronizarPrevisoesDoContrato } from "@/lib/financeiro-server";
import { gerarOsRecorrentesContrato, gerarOsRecorrentesLocais } from "@/lib/recorrencia-server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("contratos", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const contrato = await prisma.contrato.findFirst({
    where: { id, empresaId },
    include: {
      cliente: { select: { id: true, nome: true, nomeFantasia: true } },
      responsavelTecnico: { select: { id: true, nome: true, crea: true } },
      unidades: { include: { unidade: true } },
      anexos: { select: { id: true, nome: true, tipo: true, tamanho: true, categoria: true, criadoEm: true }, orderBy: { criadoEm: "desc" } },
      reajustes: { orderBy: { data: "desc" }, include: { usuario: { select: { nome: true } } } },
    },
  });
  if (!contrato) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });
  return NextResponse.json(contrato);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("contratos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contrato.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = contratoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.numero !== existente.numero) {
    const dup = await prisma.contrato.findUnique({
      where: { numero_empresaId: { numero: parsed.data.numero, empresaId } },
    });
    if (dup) return NextResponse.json({ erro: "Número já cadastrado" }, { status: 409 });
  }

  // PR3-A/B: a automação do faturamento fatura sem ninguém olhar — pede Financeiro › Medições (+ Fiscal / Contas a receber)
  const faltaAutomacao = faltaPermissaoAutomacao(parsed.data, existente, session.user!);
  if (faltaAutomacao) return NextResponse.json({ erro: faltaAutomacao }, { status: 403 });
  const { unidadeIds, recorrenciasLocais, dataInicio, dataFim, valorMensal, valorTotal, responsavelTecnicoId, tipoOsRecorrenciaId, tecnicoRecorrenciaId, artVencimento, ...resto } = parsed.data;
  // Cliente, locais, tipos de OS e técnicos (inclusive os da recorrência por local) precisam ser da mesma empresa
  try {
    await Promise.all([
      validarRefEmpresa("cliente", resto.clienteId, empresaId, "Cliente"),
      validarRefsEmpresa("unidade", unidadeIds, empresaId, "Local"),
      validarRefsEmpresa("tipoOs", [tipoOsRecorrenciaId, ...recorrenciasLocais.map((r) => r.tipoOsId)], empresaId, "Tipo de OS"),
      validarRefsEmpresa("tecnico", [responsavelTecnicoId, tecnicoRecorrenciaId, ...recorrenciasLocais.map((r) => r.tecnicoId)], empresaId, "Técnico"),
      // Serviço padrão: da empresa; escolha nova precisa estar ativo (manter o atual, mesmo inativo, vale)
      validarRefEmpresa("servico", resto.servicoId, empresaId, "Serviço padrão", { novoAtivo: true, manter: [existente.servicoId] }),
    ]);
  } catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }

  const atualizado = await prisma.$transaction(async (tx) => {
    await tx.contratoUnidade.deleteMany({ where: { contratoId: id } });
    await tx.contratoRecorrenciaLocal.deleteMany({ where: { contratoId: id } });
    const c = await tx.contrato.update({
      where: { id },
      data: {
        ...resto,
        dataInicio: new Date(dataInicio),
        dataFim: dataFim ? new Date(dataFim) : null,
        valorMensal: valorMensal ?? null,
        valorTotal: valorTotal ?? null,
        responsavelTecnicoId: responsavelTecnicoId || null,
        tipoOsRecorrenciaId: tipoOsRecorrenciaId || null,
        tecnicoRecorrenciaId: tecnicoRecorrenciaId || null,
        artVencimento: artVencimento ? new Date(artVencimento) : null,
        unidades: {
          create: unidadeIds.map((unidadeId) => ({ unidadeId })),
        },
      },
      include: { unidades: true },
    });
    if (recorrenciasLocais.length) {
      await tx.contratoRecorrenciaLocal.createMany({
        data: recorrenciasLocais
          .filter((r) => unidadeIds.includes(r.unidadeId))
          .map((r) => ({
            empresaId, contratoId: id, unidadeId: r.unidadeId, ativa: r.ativa,
            frequencia: r.frequencia ?? null, tipoOsId: r.tipoOsId || null, tecnicoId: r.tecnicoId || null,
            dataPrimeiraOs: r.dataPrimeiraOs ? new Date(r.dataPrimeiraOs) : null,
          })),
      });
    }
    return c;
  });

  // CO2: só contrato ATIVO movimenta financeiro/recorrência; ao sair de ATIVO,
  // a receita fantasma é limpa (previsões PREVISTO e OS agendadas intocadas).
  if (contratoGeraFinanceiro(atualizado.status)) {
    // As previsões abertas acompanham o contrato (valor, vencimento, vigência) e depois
    // nascem os meses que entraram na vigência (idempotente).
    await sincronizarPrevisoesDoContrato(id, existente, session.user!.id).catch((e) => console.error("[contrato] sincronizar previsões", id, e));
    await gerarPrevisaoContratoContasReceber(id, session.user!.id).catch(() => 0);
    // Gera as OS recorrentes: por local (novo) + contrato-nível legado (idempotentes).
    await gerarOsRecorrentesLocais(id, session.user!.id).catch(() => 0);
    if (atualizado.recorrencia) await gerarOsRecorrentesContrato(id, session.user!.id).catch(() => 0);
  } else {
    await encerrarFinanceiroDoContrato(id, `Contrato ${atualizado.numero} não está ativo (${atualizado.status})`, session.user!.id).catch(() => null);
  }

  return NextResponse.json(atualizado);
}

export async function DELETE(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("contratos", "editar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const existente = await prisma.contrato.findFirst({ where: { id, empresaId } });
  if (!existente) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  // Excluir = encerrar (o contrato fica no histórico). CO2: como em qualquer saída de ATIVO,
  // a receita fantasma sai junto — previsões ainda abertas e OS futuras intocadas.
  if (existente.status !== "ENCERRADO") {
    await prisma.$transaction([
      prisma.contrato.update({ where: { id }, data: { status: "ENCERRADO" } }),
      prisma.contratoHistoricoStatus.create({
        data: { empresaId, contratoId: id, statusAnterior: existente.status, statusNovo: "ENCERRADO", motivo: "Contrato excluído", usuarioId: session.user!.id },
      }),
    ]);
  }
  const limpeza = await encerrarFinanceiroDoContrato(id, `Contrato ${existente.numero} excluído`, session.user!.id);
  return NextResponse.json({ ok: true, ...limpeza });
}
