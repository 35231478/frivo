import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { exigirPermissao } from "@/lib/permissoes-server";
import { contratoSchema } from "@/lib/validations";
import { gerarPrevisaoContratoContasReceber } from "@/lib/financeiro-server";
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
      reajustes: { orderBy: { data: "desc" } },
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

  const { unidadeIds, recorrenciasLocais, dataInicio, dataFim, valorMensal, valorTotal, responsavelTecnicoId, tipoOsRecorrenciaId, tecnicoRecorrenciaId, artVencimento, itensInclusos, ...resto } = parsed.data;
  // Cliente, locais, tipos de OS e técnicos (inclusive os da recorrência por local) precisam ser da mesma empresa
  try {
    await Promise.all([
      validarRefEmpresa("cliente", resto.clienteId, empresaId, "Cliente"),
      validarRefsEmpresa("unidade", unidadeIds, empresaId, "Local"),
      validarRefsEmpresa("tipoOs", [tipoOsRecorrenciaId, ...recorrenciasLocais.map((r) => r.tipoOsId)], empresaId, "Tipo de OS"),
      validarRefsEmpresa("tecnico", [responsavelTecnicoId, tecnicoRecorrenciaId, ...recorrenciasLocais.map((r) => r.tecnicoId)], empresaId, "Técnico"),
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
        ...(itensInclusos ? { itensInclusos: itensInclusos as any } : {}),
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

  // Atualiza a previsão de contas a receber (idempotente).
  await gerarPrevisaoContratoContasReceber(id).catch(() => 0);
  // Gera as OS recorrentes: por local (novo) + contrato-nível legado (idempotentes).
  await gerarOsRecorrentesLocais(id, session.user!.id).catch(() => 0);
  if (atualizado.recorrencia) await gerarOsRecorrentesContrato(id, session.user!.id).catch(() => 0);

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

  await prisma.contrato.update({ where: { id }, data: { status: "ENCERRADO" } });
  return NextResponse.json({ ok: true });
}
