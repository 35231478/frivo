import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaFoto } from "@/lib/anexos-server";
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

  // O tipo sai dos BYTES e só imagem é servida (nosniff + sandbox); valor antigo
  // que não seja imagem (HTML/SVG disfarçado, URL) vira 404 — nunca executa nem redireciona.
  return respostaFoto(foto);
}
