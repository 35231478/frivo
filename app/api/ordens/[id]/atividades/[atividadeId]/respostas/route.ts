import { NextRequest, NextResponse } from "next/server";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { respostaRefEmpresa, validarRefEmpresa } from "@/lib/ref-empresa";

type Params = { params: Promise<{ id: string; atividadeId: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["ordens", "editar"], ["ordens", "concluir"]]);
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const { id, atividadeId } = await params;
  const empresaId = session.user!.empresaId;

  const atividade = await prisma.atividadeOs.findFirst({ where: { id: atividadeId, ordemServicoId: id, empresaId }, select: { id: true } });
  if (!atividade) return NextResponse.json({ erro: "Atividade não encontrada" }, { status: 404 });

  const body = await req.json();
  const { respostas, formularioId } = body as {
    formularioId: string;
    respostas: Array<{ campoId: string; resposta?: string; arquivoUrl?: string }>;
  };

  if (!Array.isArray(respostas) || !formularioId) {
    return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  }
  // Formulário da empresa; campos dele, ativos (ou removidos já respondidos nesta atividade)
  try { await validarRefEmpresa("formularioTemplate", formularioId, empresaId, "Formulário"); }
  catch (e) { const r = respostaRefEmpresa(e); if (r) return r; throw e; }
  const campos = await prisma.formularioCampo.findMany({
    where: { formularioId, OR: [{ ativo: true }, { respostas: { some: { atividadeId } } }] },
    orderBy: { ordem: "asc" },
  });
  const validos = new Set(campos.map((c) => c.id));
  if (respostas.some((r) => !validos.has(r.campoId)))
    return NextResponse.json({ erro: "Campo inválido (não pertence a este formulário ou foi removido)." }, { status: 400 });

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

  // Resumo: campos ativos + removidos que têm resposta (lista lida antes de gravar)

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
