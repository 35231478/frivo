import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

/**
 * Computa os formulários aplicáveis a uma atividade, cruzando o Tipo de OS da
 * atividade com os tipos dos equipamentos adicionados (via FormTypeMapping),
 * agrupados por tipo de equipamento e com o status de "respondido" por equipamento.
 *
 * Reutilizado pelo PWA do técnico (execução da atividade).
 */
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;

  const atividade = await prisma.atividadeOs.findFirst({
    where: { id: atividadeId, ordemServicoId: id, empresaId },
    select: { id: true, tipoOsId: true },
  });
  if (!atividade) return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });

  const vinculos = await prisma.atividadeEquipamento.findMany({
    where: { atividadeId },
    select: {
      id: true, feito: true,
      equipamento: {
        select: {
          id: true, nome: true, marca: true, modelo: true, localizacao: true,
          tipoEquipamentoId: true,
          tipoEquipamento: { select: { id: true, nome: true } },
        },
      },
    },
    orderBy: { criadoEm: "asc" },
  });

  // Sem tipo de OS ou sem equipamentos → nada a vincular
  if (!atividade.tipoOsId || vinculos.length === 0) {
    return NextResponse.json({ tipoOsId: atividade.tipoOsId, grupos: [], tiposSemFormulario: [] });
  }

  // Agrupa equipamentos por tipo (ignora os sem tipo definido)
  const porTipo = new Map<string, { nome: string; itens: typeof vinculos }>();
  for (const v of vinculos) {
    const tid = v.equipamento.tipoEquipamentoId;
    if (!tid) continue;
    if (!porTipo.has(tid)) porTipo.set(tid, { nome: v.equipamento.tipoEquipamento?.nome ?? "—", itens: [] });
    porTipo.get(tid)!.itens.push(v);
  }

  const tipoIds = [...porTipo.keys()];

  // Mapeamentos (tipoEquipamento + tipoOs) → formulário, com campos
  const mappings = await prisma.formTypeMapping.findMany({
    where: { empresaId, tipoOsId: atividade.tipoOsId, tipoEquipamentoId: { in: tipoIds } },
    select: {
      tipoEquipamentoId: true,
      formularioTemplate: {
        select: {
          id: true, nome: true,
          campos: { orderBy: { ordem: "asc" }, select: { id: true, label: true, tipo: true, obrigatorio: true, ordem: true, opcoes: true } },
        },
      },
    },
  });
  const mapByTipo = new Map(mappings.map((m) => [m.tipoEquipamentoId, m.formularioTemplate]));

  // Respostas já gravadas (para status de respondido por equipamento+formulário)
  const respostas = await prisma.respostaFormularioEquipamento.findMany({
    where: { atividadeId },
    select: { equipamentoId: true, formularioId: true, campoId: true },
  });
  const respMap = new Map<string, Set<string>>(); // `${equipId}|${formId}` -> Set(campoId)
  for (const r of respostas) {
    const k = `${r.equipamentoId}|${r.formularioId}`;
    if (!respMap.has(k)) respMap.set(k, new Set());
    respMap.get(k)!.add(r.campoId);
  }

  const grupos: any[] = [];
  const tiposSemFormulario: any[] = [];

  for (const [tid, grupo] of porTipo) {
    const formulario = mapByTipo.get(tid);
    if (!formulario) {
      tiposSemFormulario.push({ id: tid, nome: grupo.nome, qtd: grupo.itens.length });
      continue;
    }
    const totalCampos = formulario.campos.length;
    const equipamentos = grupo.itens.map((v) => {
      const respondidos = respMap.get(`${v.equipamento.id}|${formulario.id}`)?.size ?? 0;
      return {
        vinculoId: v.id,
        equipamentoId: v.equipamento.id,
        nome: v.equipamento.nome,
        marca: v.equipamento.marca,
        modelo: v.equipamento.modelo,
        localizacao: v.equipamento.localizacao,
        feito: v.feito,
        respondidos,
        respondido: respondidos > 0,
        completo: totalCampos > 0 && respondidos >= totalCampos,
      };
    });
    grupos.push({
      tipoEquipamentoId: tid,
      tipoEquipamentoNome: grupo.nome,
      formulario,
      equipamentos,
      resumo: {
        total: equipamentos.length,
        feitos: equipamentos.filter((e) => e.feito).length,
        respondidos: equipamentos.filter((e) => e.completo).length,
      },
    });
  }

  return NextResponse.json({ tipoOsId: atividade.tipoOsId, grupos, tiposSemFormulario });
}
