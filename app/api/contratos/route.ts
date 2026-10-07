import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefEmpresa, validarRefsEmpresa } from "@/lib/ref-empresa";
import { exigirAlgumaPermissao, exigirPermissao } from "@/lib/permissoes-server";
import { contratoSchema } from "@/lib/validations";
import { gerarPrevisaoContratoContasReceber } from "@/lib/financeiro-server";
import { gerarOsRecorrentesContrato, gerarOsRecorrentesLocais } from "@/lib/recorrencia-server";

export async function GET(req: NextRequest) {
  const guard = await exigirAlgumaPermissao([["contratos", "visualizar"], ["ordens", "criar"], ["financeiro", "medicoes"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;

  const empresaId = session.user!.empresaId;
  const { searchParams } = new URL(req.url);
  const clienteId = searchParams.get("clienteId");

  const contratos = await prisma.contrato.findMany({
    where: { empresaId, ...(clienteId && { clienteId }) },
    select: { id: true, numero: true, tipo: true, status: true, clienteId: true },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(contratos);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("contratos", "criar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;

  const empresaId = session.user!.empresaId;
  const body = await req.json();
  const parsed = contratoSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  const dup = await prisma.contrato.findUnique({
    where: { numero_empresaId: { numero: parsed.data.numero, empresaId } },
  });
  if (dup) return NextResponse.json({ erro: "Número de contrato já cadastrado" }, { status: 409 });

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

  const contrato = await prisma.contrato.create({
    data: {
      ...resto,
      empresaId,
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

  // Configurações de recorrência por local
  if (recorrenciasLocais.length) {
    await prisma.contratoRecorrenciaLocal.createMany({
      data: recorrenciasLocais
        .filter((r) => unidadeIds.includes(r.unidadeId))
        .map((r) => ({
          empresaId, contratoId: contrato.id, unidadeId: r.unidadeId, ativa: r.ativa,
          frequencia: r.frequencia ?? null, tipoOsId: r.tipoOsId || null, tecnicoId: r.tecnicoId || null,
          dataPrimeiraOs: r.dataPrimeiraOs ? new Date(r.dataPrimeiraOs) : null,
        })),
    });
  }

  // Gera a previsão de contas a receber (idempotente).
  await gerarPrevisaoContratoContasReceber(contrato.id).catch(() => 0);
  // Gera as OS recorrentes: por local (novo) + contrato-nível legado (idempotentes).
  await gerarOsRecorrentesLocais(contrato.id, session.user!.id).catch(() => 0);
  if (contrato.recorrencia) await gerarOsRecorrentesContrato(contrato.id, session.user!.id).catch(() => 0);

  return NextResponse.json(contrato, { status: 201 });
}
