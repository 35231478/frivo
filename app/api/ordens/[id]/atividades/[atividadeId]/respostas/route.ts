import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;

  const atividade = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, ordemServicoId: id, empresaId }, select: { id: true } });
  if (!atividade) return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });

  const body = await req.json();
  const { respostas, formularioId } = body as {
    formularioId: string;
    respostas: Array<{ campoId: string; resposta?: string; arquivoUrl?: string }>;
  };

  if (!respostas || !formularioId) {
    return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  }

  // Upsert each response
  for (const r of respostas) {
    await prisma.atividadeResposta.upsert({
      where: { atividadeId_campoId: { atividadeId, campoId: r.campoId } },
      create: {
        atividadeId,
        campoId: r.campoId,
        formularioId,
        resposta: r.resposta ?? null,
        arquivoUrl: r.arquivoUrl ?? null,
      },
      update: {
        resposta: r.resposta ?? null,
        arquivoUrl: r.arquivoUrl ?? null,
      },
    });
  }

  // Generate summary
  const campos = await prisma.formularioCampo.findMany({
    where: { formularioId },
    orderBy: { ordem: "asc" },
  });

  const respostasDb = await prisma.atividadeResposta.findMany({
    where: { atividadeId },
    include: { campo: true },
  });

  const resumoLinhas = campos.map((campo) => {
    const resp = respostasDb.find((r) => r.campoId === campo.id);
    const valor = resp?.resposta ?? "—";
    if (campo.tipo === "SIM_NAO") {
      return `${campo.label}: ${valor === "true" || valor === "Sim" ? "Sim" : "Não"}`;
    }
    if (campo.tipo === "FOTO") {
      return `${campo.label}: ${resp?.arquivoUrl ? "Foto anexada" : "Sem foto"}`;
    }
    return `${campo.label}: ${valor}`;
  });

  const resumo = resumoLinhas.join("\n");
  await prisma.atividadeOs.update({ where: { id: atividadeId }, data: { resumo } });

  return NextResponse.json({ ok: true, resumo });
}
