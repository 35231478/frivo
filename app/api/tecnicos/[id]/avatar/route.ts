import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAlgumaPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

/**
 * Serve a foto (avatar) do colaborador como imagem, sob demanda — mesmo padrão de
 * /api/equipamentos/:id/foto: a listagem não trafega o base64 de cada colaborador.
 * Liberado para quem vê colaboradores ou as OS (onde o técnico aparece).
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const guard = await exigirAlgumaPermissao([["equipes", "visualizar"], ["ordens", "visualizar"], ["calendario", "visualizar"]]);
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;

  const t = await prisma.tecnico.findFirst({ where: { id, empresaId }, select: { avatar: true } });
  const foto = t?.avatar;
  if (!foto) return NextResponse.json({ erro: "Sem foto" }, { status: 404 });

  const cache = { "Cache-Control": "private, max-age=86400" };
  const m = foto.match(/^data:([^;,]+);base64,([\s\S]*)$/);
  if (m) return new NextResponse(Buffer.from(m[2], "base64"), { headers: { "Content-Type": m[1], ...cache } });
  if (/^https?:\/\//.test(foto) || foto.startsWith("/")) return NextResponse.redirect(new URL(foto, _req.url), { headers: cache });
  return NextResponse.json({ erro: "Formato de foto não suportado" }, { status: 415 });
}
