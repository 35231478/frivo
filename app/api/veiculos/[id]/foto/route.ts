import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { respostaFoto } from "@/lib/anexos-server";
import { exigirPermissao } from "@/lib/permissoes-server";

type Params = { params: Promise<{ id: string }> };

/**
 * Serve uma foto do veículo como imagem (padrão: a capa, índice 0 = Frente).
 * Mesmo padrão de /api/equipamentos/:id/foto: as fotos ficam em base64 no array
 * `fotos`; esta rota lê só o elemento pedido, e a listagem carrega cada capa sob
 * demanda (loading="lazy") em vez de trafegar todas as fotos de uma vez.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("veiculos", "visualizar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;
  const { id } = await params;
  const indice = Math.max(0, Math.min(7, Number(req.nextUrl.searchParams.get("i") ?? 0) || 0));

  // Arrays do Postgres são 1-based
  const linhas = await prisma.$queryRaw<{ foto: string | null }[]>`
    SELECT fotos[${indice + 1}] AS foto FROM veiculos WHERE id = ${id} AND empresa_id = ${empresaId} LIMIT 1
  `;
  const foto = linhas[0]?.foto;
  if (!foto) return NextResponse.json({ erro: "Sem foto" }, { status: 404 });

  // O tipo sai dos BYTES e só imagem é servida (nosniff + sandbox); valor antigo
  // que não seja imagem (HTML/SVG disfarçado, URL) vira 404 — nunca executa nem redireciona.
  return respostaFoto(foto);
}
