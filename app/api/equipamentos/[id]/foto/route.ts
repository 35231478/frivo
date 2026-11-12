import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaFoto } from "@/lib/anexos-server";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

/**
 * Serve uma foto do equipamento como imagem (padrão: a principal, índice 0).
 * As fotos são guardadas como data URL (base64) no array `fotos`; esta rota lê
 * só o elemento pedido no banco — a listagem não precisa trafegar o array inteiro
 * e o navegador carrega/cacheia cada miniatura sob demanda (loading="lazy").
 */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("equipamentos", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const indice = Math.max(0, Math.min(4, Number(req.nextUrl.searchParams.get("i") ?? 0) || 0));

  // Arrays do Postgres são 1-based
  const linhas = await prisma.$queryRaw<{ foto: string | null }[]>`
    SELECT fotos[${indice + 1}] AS foto FROM equipamentos WHERE id = ${id} AND empresa_id = ${empresaId} LIMIT 1
  `;
  const foto = linhas[0]?.foto;
  if (!foto) return NextResponse.json({ erro: "Sem foto" }, { status: 404 });

  // O tipo sai dos BYTES e só imagem é servida (nosniff + sandbox); valor antigo
  // que não seja imagem (HTML/SVG disfarçado, URL) vira 404 — nunca executa nem redireciona.
  return respostaFoto(foto);
}
