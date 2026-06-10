import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";

const perfilSchema = z.object({
  nome: z.string().min(1, "Nome é obrigatório"),
  descricao: z.string().optional(),
  tipo: z.enum(["ADMINISTRADOR", "SUPERVISOR", "FINANCEIRO", "TECNICO", "AUXILIAR", "PERSONALIZADO"]).default("PERSONALIZADO"),
  cor: z.string().default("#8B5CF6"),
  permissoes: z.record(z.string(), z.record(z.string(), z.boolean())).default({}),
});

export async function GET() {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const perfis = await prisma.perfilAcesso.findMany({
    where: { empresaId },
    include: { _count: { select: { usuarios: true, colaboradores: true } } },
    orderBy: [{ padraoSistema: "desc" }, { nome: "asc" }],
  });
  return NextResponse.json(perfis);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;

  const body = await req.json();
  const parsed = perfilSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });

  const perfil = await prisma.perfilAcesso.create({
    data: { ...parsed.data, empresaId, padraoSistema: false },
  });
  return NextResponse.json(perfil, { status: 201 });
}
