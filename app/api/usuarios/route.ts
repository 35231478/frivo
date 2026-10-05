import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { prisma } from "@/lib/prisma";

/**
 * Lista os usuários ativos da empresa.
 * - configuracoes.gerenciar → lista completa (e-mail, telefone, perfil), usada na tela de Usuários;
 * - ordens/orcamentos.visualizar → só id/nome/role, usada nos seletores de responsável (ex.: Compras
 *   na OS e no orçamento), para não expor dados de contato a quem não administra usuários;
 * - demais → 403.
 */
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const { permissoes, role, empresaId } = session.user!;

  const completo = pode(permissoes, "configuracoes", "gerenciar", role);
  const resumido = pode(permissoes, "ordens", "visualizar", role) || pode(permissoes, "orcamentos", "visualizar", role);
  if (!completo && !resumido) return NextResponse.json({ erro: "Sem permissão para esta ação" }, { status: 403 });

  const usuarios = await prisma.usuario.findMany({
    where: { empresaId, ativo: true },
    select: completo
      ? {
          id: true, nome: true, email: true, role: true, telefone: true,
          perfilAcessoId: true,
          perfilAcesso: { select: { nome: true, cor: true } },
        }
      : { id: true, nome: true, role: true },
    orderBy: { nome: "asc" },
  });
  return NextResponse.json(usuarios);
}
