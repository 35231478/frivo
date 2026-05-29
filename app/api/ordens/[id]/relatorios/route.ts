import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { relatorioSchema } from "@/lib/validations";
import { gerarNumeroRelatorio } from "@/lib/utils";

type Params = { params: Promise<{ id: string }> };

function ehFoto(arquivoUrl: string | null, tipoCampo: string): boolean {
  if (!arquivoUrl) return false;
  return tipoCampo === "FOTO" || /^data:image\//.test(arquivoUrl);
}

export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    include: {
      atividades: {
        orderBy: { criadoEm: "asc" },
        include: {
          tipoOs: { select: { nome: true, cor: true } },
          tecnico: { select: { nome: true } },
          respostas: { include: { campo: { select: { label: true, tipo: true } } } },
        },
      },
      relatorios: { orderBy: { criadoEm: "desc" } },
    },
  });
  if (!os) return NextResponse.json({ erro: "Não encontrada" }, { status: 404 });

  const equipamentos = os.unidadeId
    ? await prisma.equipamento.count({ where: { unidadeId: os.unidadeId, ativo: true } })
    : 0;

  const tecnicos = new Set<string>();
  let totalFotos = 0;
  const atividades = os.atividades.map((a) => {
    if (a.tecnico) tecnicos.add(a.tecnico.nome);
    const fotos = a.respostas.filter((r) => ehFoto(r.arquivoUrl, r.campo.tipo)).length;
    totalFotos += fotos;
    const respostasPreenchidas = a.respostas.filter((r) => (r.resposta ?? "").trim()).length;
    const base = (a.observacao || a.resumo || "").trim();
    const primeira = a.respostas.find((r) => (r.resposta ?? "").trim());
    const resumo = base ? base.slice(0, 150) : primeira ? `${primeira.campo.label}: ${primeira.resposta}`.slice(0, 150) : "";
    return {
      id: a.id, titulo: a.titulo, status: a.status, criadoEm: a.criadoEm, duracaoMin: a.duracaoMin,
      tipoOsNome: a.tipoOs?.nome ?? null, tipoOsCor: a.tipoOs?.cor ?? null, tecnicoNome: a.tecnico?.nome ?? null,
      resumo, fotos, respostas: respostasPreenchidas,
    };
  });

  const datas = os.atividades.map((a) => new Date(a.criadoEm).getTime());
  const periodoInicio = datas.length ? new Date(Math.min(...datas)) : null;
  const periodoFim = datas.length ? new Date(Math.max(...datas)) : null;

  return NextResponse.json({
    relatorios: os.relatorios,
    resumo: {
      statusOs: os.status,
      totalAtividades: os.atividades.length,
      totalTecnicos: tecnicos.size,
      totalFotos,
      totalEquipamentos: equipamentos,
      periodoInicio,
      periodoFim,
      atividades,
    },
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const os = await prisma.ordemServico.findFirst({
    where: { id, empresaId },
    select: { id: true, contratoId: true },
  });
  if (!os) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });

  const parsed = relatorioSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const seq = (await prisma.relatorioOs.count({ where: { empresaId } })) + 1;
  const numero = gerarNumeroRelatorio(seq, data.anoReferencia);

  const relatorio = await prisma.relatorioOs.create({
    data: {
      empresaId,
      ordemServicoId: id,
      contratoId: os.contratoId,
      numero,
      tipo: data.tipo,
      mesReferencia: data.mesReferencia,
      anoReferencia: data.anoReferencia,
      valorFinanceiro: data.valorFinanceiro ?? null,
      observacao: data.observacao ?? null,
      status: "RASCUNHO",
      tokenPublico: crypto.randomUUID(),
    },
  });

  return NextResponse.json(relatorio, { status: 201 });
}
