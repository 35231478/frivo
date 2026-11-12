import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { itemCronogramaSchema } from "@/lib/pmoc-cronograma";
import { lerCronograma } from "@/lib/pmoc-cronograma-server";
import { atorDoCronograma, dadosDoItem, gerarAoSalvar, planoEditavel, validarItem } from "@/lib/pmoc-cronograma-rotas";

type Params = { params: Promise<{ id: string }> };

/** O cronograma do plano: itens, OS geradas e o que "Reagendar atividades" faria agora. */
export async function GET(_: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "visualizar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const cronograma = await lerCronograma(id, guard.session.user!.empresaId);
  if (!cronograma) return NextResponse.json({ erro: "PMOC não encontrado" }, { status: 404 });
  return NextResponse.json(cronograma);
}

/** Novo item do cronograma. Com o plano publicado e vigente, as OS que faltam já são geradas. */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("pmoc", "editar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const { pmoc, erro } = await planoEditavel(id, empresaId);
  if (erro) return erro;

  const parsed = itemCronogramaSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const invalido = await validarItem(pmoc!, empresaId, parsed.data);
  if (invalido) return NextResponse.json({ erro: invalido }, { status: 400 });

  await prisma.pmocCronograma.create({ data: { pmocId: id, ...dadosDoItem(parsed.data) } });
  const gerado = await gerarAoSalvar(id, atorDoCronograma(guard.session));
  return NextResponse.json({ cronograma: await lerCronograma(id, empresaId), gerado }, { status: 201 });
}
