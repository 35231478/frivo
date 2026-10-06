import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { termoTemplateSchema } from "@/lib/validations";

export async function GET() {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const termos = await prisma.termoReferenciaTemplate.findMany({
    where: { empresaId },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(termos);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { session } = guard;
  const empresaId = session.user!.empresaId;

  const parsed = termoTemplateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  const termo = await prisma.termoReferenciaTemplate.create({
    data: {
      empresaId,
      nome: parsed.data.nome,
      descricao: parsed.data.descricao || null,
      conteudo: parsed.data.conteudo || "",
    },
  });
  return NextResponse.json(termo, { status: 201 });
}
