import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { exigirPermissao } from "@/lib/permissoes-server";
import { permissoesDoUsuario, permissoesExcedentes, type Permissoes } from "@/lib/permissoes";

type Params = { params: Promise<{ id: string }> };

const updateSchema = z.object({
  perfilAcessoId: z.string().nullable().optional(),
});

/**
 * Vincula um usuário a um perfil de acesso (ou o deixa sem perfil = sem acesso).
 * Regras contra autopromoção:
 * - ninguém altera o próprio perfil;
 * - o perfil precisa ser da mesma empresa e estar ativo;
 * - quem não é ADMIN só atribui perfis cujas permissões ele mesmo tem, e não mexe em
 *   usuários que têm mais acesso que ele.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const { id } = await params;
  const eu = guard.session.user;
  const empresaId = eu.empresaId;
  const minhasPermissoes = eu.permissoes as Permissoes;

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ erro: "Dados inválidos" }, { status: 400 });

  if (id === eu.id) {
    return NextResponse.json(
      { erro: "Você não pode alterar o seu próprio perfil de acesso. Peça a outro administrador." },
      { status: 403 },
    );
  }

  const usuario = await prisma.usuario.findFirst({
    where: { id, empresaId },
    select: { id: true, role: true, perfilAcesso: { select: { ativo: true, permissoes: true } } },
  });
  if (!usuario) return NextResponse.json({ erro: "Não encontrado" }, { status: 404 });

  if (permissoesExcedentes(minhasPermissoes, permissoesDoUsuario(usuario), eu.role).length > 0) {
    return NextResponse.json(
      { erro: "Este usuário tem acessos que você não tem; só um administrador pode alterar o perfil dele." },
      { status: 403 },
    );
  }

  const perfilAcessoId = parsed.data.perfilAcessoId || null;
  if (perfilAcessoId) {
    const perfil = await prisma.perfilAcesso.findFirst({
      where: { id: perfilAcessoId, empresaId, ativo: true },
      select: { permissoes: true },
    });
    if (!perfil) return NextResponse.json({ erro: "Perfil de acesso inválido ou inativo" }, { status: 400 });

    const excedentes = permissoesExcedentes(minhasPermissoes, perfil.permissoes as Permissoes, eu.role);
    if (excedentes.length > 0) {
      return NextResponse.json(
        { erro: "Você não pode atribuir um perfil com acessos que você mesmo não tem.", excedentes },
        { status: 403 },
      );
    }
  }

  const atualizado = await prisma.usuario.update({
    where: { id },
    data: { perfilAcessoId },
    select: { id: true, nome: true, email: true, role: true, perfilAcessoId: true, perfilAcesso: { select: { nome: true, cor: true } } },
  });
  return NextResponse.json(atualizado);
}
