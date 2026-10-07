import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirPermissao } from "@/lib/permissoes-server";
import { permissoesDoUsuario, permissoesExcedentes, type Permissoes } from "@/lib/permissoes";
import { enviarConvite } from "@/lib/usuarios/convite";

type Params = { params: Promise<{ id: string }> };

/**
 * (Re)envia o convite para o usuário definir a senha. Mesma permissão da tela de Usuários.
 * Segurança: o LINK só volta para quem pediu se o usuário AINDA NÃO fez o primeiro acesso (convite
 * inicial sem e-mail configurado). Para quem já usa o sistema, só por e-mail — senão quem pediu
 * poderia definir a senha de outra pessoa e entrar no lugar dela.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const guard = await exigirPermissao("configuracoes", "gerenciar");
  if (guard.erro) return guard.resposta;
  const eu = guard.session.user;
  const { id } = await params;
  if (id === eu.id) return NextResponse.json({ erro: "Para trocar a sua senha, use Meu perfil › Senha." }, { status: 400 });

  const u = await prisma.usuario.findFirst({
    where: { id, empresaId: eu.empresaId },
    select: { id: true, ativo: true, role: true, ultimoAcesso: true, perfilAcesso: { select: { ativo: true, permissoes: true } } },
  });
  if (!u) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });
  if (!u.ativo) return NextResponse.json({ erro: "Usuário inativo: reative antes de enviar o convite." }, { status: 409 });
  if (permissoesExcedentes(eu.permissoes as Permissoes, permissoesDoUsuario(u), eu.role).length > 0)
    return NextResponse.json({ erro: "Este usuário tem acessos que você não tem; só um administrador pode enviar o convite." }, { status: 403 });

  const r = await enviarConvite(u.id, req.nextUrl.origin);
  if (r.enviadoPorEmail) return NextResponse.json({ enviadoPorEmail: true });
  if (u.ultimoAcesso) {
    return NextResponse.json({
      erro: `Não foi possível enviar o e-mail (${r.erroEmail ?? "e-mail não configurado"}). Como este usuário já usa o sistema, o link só pode ir por e-mail: configure o envio em Configurações › E-mail.`,
    }, { status: 409 });
  }
  return NextResponse.json({ enviadoPorEmail: false, link: r.link, erroEmail: r.erroEmail });
}
