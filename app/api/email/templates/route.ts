import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { TEMPLATES_PADRAO } from "@/lib/email-templates";

const schema = z.object({
  tipo: z.string().min(1),
  nome: z.string().min(1),
  assunto: z.string().min(1),
  corpo: z.string().min(1),
  ativo: z.boolean().default(true),
});

export async function GET() {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  const templates = await prisma.emailTemplate.findMany({ where: { empresaId: guard.session.user.empresaId }, orderBy: { nome: "asc" } });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user.empresaId;
  const body = await req.json();

  // Ação especial: criar/restaurar todos os templates padrão
  if (body.restaurarPadroes) {
    for (const t of TEMPLATES_PADRAO) {
      await prisma.emailTemplate.upsert({
        where: { empresaId_tipo: { empresaId, tipo: t.tipo } },
        create: { empresaId, tipo: t.tipo, nome: t.nome, assunto: t.assunto, corpo: t.corpo, ativo: true },
        update: {},
      });
    }
    const templates = await prisma.emailTemplate.findMany({ where: { empresaId }, orderBy: { nome: "asc" } });
    return NextResponse.json(templates);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });
  const tpl = await prisma.emailTemplate.upsert({
    where: { empresaId_tipo: { empresaId, tipo: parsed.data.tipo } },
    create: { empresaId, ...parsed.data },
    update: parsed.data,
  });
  return NextResponse.json(tpl, { status: 201 });
}
