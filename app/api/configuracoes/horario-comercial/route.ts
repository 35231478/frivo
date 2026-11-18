import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { horarioComercialSchema, horarioDe } from "@/lib/atendimento/prazo";
import { jornadaDaEmpresa } from "@/lib/atendimento/prazo-server";

/**
 * HORÁRIO COMERCIAL da empresa da sessão: a jornada semanal que "só em horário comercial" usa no
 * prazo de atendimento dos contratos. GET: Configurações › visualizar. PUT: Configurações › gerenciar.
 * Mudar a jornada vale para os prazos fixados daqui em diante — o que já foi gravado nas OS não muda.
 */
export async function GET() {
  const guard = await exigirPermissao("configuracoes", "visualizar");
  if (guard.erro) return guard.resposta;
  return NextResponse.json(horarioDe(await jornadaDaEmpresa(prisma, guard.session.user!.empresaId)));
}

export async function PUT(req: NextRequest) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const parsed = horarioComercialSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Horário comercial inválido." }, { status: 400 });
  // Os dias ficam gravados em ordem (domingo → sábado), como a leitura devolve
  const horario = { dias: [...parsed.data.dias].sort((a, b) => a.dia - b.dia) };
  await prisma.configuracao.upsert({ where: { empresaId }, create: { empresaId, horarioComercial: horario }, update: { horarioComercial: horario } });
  return NextResponse.json(horario);
}
