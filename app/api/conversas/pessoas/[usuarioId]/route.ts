import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { comentarioSchema } from "@/lib/tecnico/comentarios";
import { comentarParaPessoa } from "@/lib/execucao/comentarios";
import { conversaComPessoa, lerAoResponderEscritorio, pessoasDaEmpresa, podeConversas } from "@/lib/chat/pessoas-servidor";
import { MSG_SEM_CONVERSA, MSG_SEM_PERMISSAO_CONVERSAS } from "@/lib/chat/regras";
import { guardaEscritorio, SEM_CACHE } from "@/lib/chat/rotas-server";
import { prisma } from "@/lib/prisma";
import { pode } from "@/lib/permissoes";
import { filtroOrdens } from "@/lib/escopo/proprios";

type Params = { params: Promise<{ usuarioId: string }> };

/** GET /api/conversas/pessoas/[usuarioId] — CHAT-1: a conversa com um técnico (lê e marca como lida), as OS dele no dia e a OS padrão. */
export async function GET(_: NextRequest, { params }: Params) {
  const g = await guardaEscritorio("visualizar", [["conversas", "visualizar"]]);
  if (g.resposta) return g.resposta;
  if (!podeConversas(g.quem, "visualizar")) return NextResponse.json({ erro: MSG_SEM_PERMISSAO_CONVERSAS }, { status: 403 });
  const { usuarioId } = await params;
  const r = await conversaComPessoa(g.quem, usuarioId);
  if (!r) return NextResponse.json({ erro: MSG_SEM_CONVERSA }, { status: 404 });
  return NextResponse.json(r, { headers: SEM_CACHE });
}

/**
 * POST /api/conversas/pessoas/[usuarioId] { clientId, texto, foto?, miniatura?, osId? } — o escritório escreve para UMA
 * pessoa, com a OS da mensagem ou sem OS. Pede "Conversas › Enviar"; com OS, também ver a OS (e o "Ver só os próprios").
 */
export async function POST(req: NextRequest, { params }: Params) {
  const g = await guardaEscritorio("visualizar", [["conversas", "enviar"]]);
  if (g.resposta) return g.resposta;
  if (!podeConversas(g.quem, "enviar")) return NextResponse.json({ erro: MSG_SEM_PERMISSAO_CONVERSAS }, { status: 403 });
  const { usuarioId } = await params;
  if (!(await pessoasDaEmpresa(g.quem.empresaId)).some((p) => p.usuarioId === usuarioId)) return NextResponse.json({ erro: MSG_SEM_CONVERSA }, { status: 404 });
  const bruto = await req.json().catch(() => null);
  const { osId, ...resto } = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : {} as Record<string, unknown>;
  if (osId !== undefined && osId !== null && typeof osId !== "string") return NextResponse.json({ erro: "OS inválida" }, { status: 400 });
  if (osId) {
    const ve = pode(g.quem.permissoes ?? null, "ordens", "visualizar", g.quem.role ?? undefined)
      && !!(await prisma.ordemServico.findFirst({ where: { id: osId, empresaId: g.quem.empresaId, ...filtroOrdens(g.quem) }, select: { id: true } }));
    if (!ve) return NextResponse.json({ erro: "OS não encontrada" }, { status: 404 });
  }
  const parsed = comentarioSchema.safeParse({ clientId: randomUUID().replace(/-/g, ""), ...resto });
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const r = await comentarParaPessoa(g.quem.empresaId, g.quem.id, usuarioId, (osId as string) || null, parsed.data);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  // Responder é ler: o ✓✓ das mensagens do técnico (quem já estava com a conversa aberta não relia)
  await lerAoResponderEscritorio(g.quem, usuarioId);
  return NextResponse.json({ mensagem: r.dados.comentario }, { status: r.status });
}
