import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { comunicacaoPreferenciasSchema } from "@/lib/validations";

type Params = { params: Promise<{ id: string }> };

// Lista as preferências de comunicação do cliente (contato × tipo × canal).
export async function GET(_: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const preferencias = await prisma.comunicacaoPreferencia.findMany({
    where: { clienteId: id, empresaId },
    select: { contatoId: true, tipo: true, canal: true },
  });

  return NextResponse.json(preferencias);
}

// Substitui todas as preferências de comunicação do cliente (bulk replace).
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  const empresaId = session.user!.empresaId;

  const cliente = await prisma.cliente.findFirst({ where: { id, empresaId }, select: { id: true } });
  if (!cliente) return NextResponse.json({ erro: "Cliente não encontrado" }, { status: 404 });

  const parsed = comunicacaoPreferenciasSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ erro: "Dados inválidos", detalhes: parsed.error.flatten() }, { status: 400 });
  }

  // Só aceita contatos que pertençam a este cliente/empresa.
  const contatosValidos = new Set(
    (await prisma.contatoCliente.findMany({ where: { clienteId: id, empresaId }, select: { id: true } })).map((c) => c.id),
  );
  // Deduplica por (contatoId+tipo) — o índice único garante isso no banco.
  const vistos = new Set<string>();
  const dados = parsed.data.preferencias
    .filter((p) => contatosValidos.has(p.contatoId))
    .filter((p) => { const k = `${p.contatoId}:${p.tipo}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .map((p) => ({ empresaId, clienteId: id, contatoId: p.contatoId, tipo: p.tipo, canal: p.canal }));

  await prisma.$transaction([
    prisma.comunicacaoPreferencia.deleteMany({ where: { clienteId: id, empresaId } }),
    ...(dados.length ? [prisma.comunicacaoPreferencia.createMany({ data: dados })] : []),
  ]);

  return NextResponse.json({ ok: true, total: dados.length });
}
