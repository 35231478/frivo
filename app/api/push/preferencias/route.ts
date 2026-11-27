import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { escopoDaSessao } from "@/lib/tecnico/escopo";
import { CHAVE_PREFERENCIA_PUSH, ehPrevisto, lerPreferenciaPush, tipoLigado, tiposDoUsuario, type QuemRecebe } from "@/lib/push/tipos";

async function quem() {
  const session = await auth();
  if (!session) return null;
  const u = session.user!;
  const q: QuemRecebe = { permissoes: u.permissoes, role: u.role, restrito: escopoDaSessao(session).restrito, temTecnico: !!u.tecnicoId };
  return { usuarioId: u.id, q };
}

async function lerPref(usuarioId: string) {
  const linha = await prisma.preferenciaUsuario.findUnique({ where: { usuarioId_chave: { usuarioId, chave: CHAVE_PREFERENCIA_PUSH } }, select: { valor: true } });
  return lerPreferenciaPush(linha?.valor);
}

/** GET — os tipos que ESTA pessoa pode receber, cada um ligado ou não (sem preferência gravada: ligado). */
export async function GET() {
  const s = await quem();
  if (!s) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const pref = await lerPref(s.usuarioId);
  return NextResponse.json(tiposDoUsuario(s.q).map((t) => ({ id: t.id, rotulo: t.rotulo, dica: t.dica, ligado: tipoLigado(pref, t.id), previsto: ehPrevisto(t.id) })));
}

/** PUT { tipo: boolean, … } — liga/desliga; só tipos que a pessoa pode receber (o resto é ignorado). */
export async function PUT(req: NextRequest) {
  const s = await quem();
  if (!s) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const pedido = lerPreferenciaPush(await req.json().catch(() => null));
  const permitidos = new Set(tiposDoUsuario(s.q).map((t) => t.id));
  const atual = await lerPref(s.usuarioId);
  for (const [tipo, ligado] of Object.entries(pedido)) if (permitidos.has(tipo as never)) atual[tipo as keyof typeof atual] = ligado;
  await prisma.preferenciaUsuario.upsert({
    where: { usuarioId_chave: { usuarioId: s.usuarioId, chave: CHAVE_PREFERENCIA_PUSH } },
    update: { valor: atual }, create: { usuarioId: s.usuarioId, chave: CHAVE_PREFERENCIA_PUSH, valor: atual },
  });
  return NextResponse.json({ ok: true });
}
