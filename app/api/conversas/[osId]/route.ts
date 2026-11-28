import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { comentarioSchema } from "@/lib/tecnico/comentarios";
import { comentarDoEscritorio } from "@/lib/execucao/comentarios";
import { conversaDoEscritorio } from "@/lib/chat/servidor";
import { MSG_SEM_CONVERSA } from "@/lib/chat/regras";
import { guardaEscritorio, lerAte, SEM_CACHE } from "@/lib/chat/rotas-server";
import { prisma } from "@/lib/prisma";
import { filtroOrdens } from "@/lib/escopo/proprios";

type Params = { params: Promise<{ osId: string }> };

/**
 * GET /api/conversas/[osId]?ate= — CHAT-1: a conversa da OS (o resumo e as mensagens). Ler marca como lidas (o ✓✓ de
 * quem escreveu). `ate`: o id de uma mensagem antiga (a citada) — traz desde ela.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const g = await guardaEscritorio("visualizar");
  if (g.resposta) return g.resposta;
  const { osId } = await params;
  const r = await conversaDoEscritorio(g.quem, osId, { ate: lerAte(req.url) });
  if (!r) return NextResponse.json({ erro: MSG_SEM_CONVERSA }, { status: 404 });
  return NextResponse.json(r, { headers: SEM_CACHE });
}

/**
 * POST /api/conversas/[osId] { clientId, texto, foto?, miniatura? } — o escritório escreve (quem edita OS). A mesma
 * mensagem reenviada (clientId) não duplica; OS cancelada é só leitura (409).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const g = await guardaEscritorio("editar");
  if (g.resposta) return g.resposta;
  const { osId } = await params;
  // "Ver só os próprios" (COM-1) e a empresa: fora do escopo é como se a OS não existisse (antes de ler o corpo)
  const os = await prisma.ordemServico.findFirst({ where: { id: osId, empresaId: g.quem.empresaId, ...filtroOrdens(g.quem) }, select: { id: true } });
  if (!os) return NextResponse.json({ erro: MSG_SEM_CONVERSA }, { status: 404 });
  const bruto = await req.json().catch(() => null);
  const parsed = comentarioSchema.safeParse(bruto && typeof bruto === "object" ? { clientId: randomUUID().replace(/-/g, ""), ...bruto } : bruto);
  if (!parsed.success) return NextResponse.json({ erro: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  const r = await comentarDoEscritorio(g.quem.empresaId, osId, g.quem.id, parsed.data);
  if (!r.ok) return NextResponse.json({ erro: r.erro }, { status: r.status });
  return NextResponse.json({ mensagem: r.dados.comentario }, { status: r.status });
}
