import { cache } from "react";
import type { JWT } from "next-auth/jwt";
import { prisma } from "@/lib/prisma";
import { impressaoDaSenha } from "@/lib/acesso/impressao-senha";
import { acessoAtual, acessoMudou } from "@/lib/acesso/acesso-atual";
import { emModoTecnico } from "@/lib/tecnico/modo";

/**
 * Sessão (JWT) x cadastro atual: o token é assinado no login e valeria até expirar, mesmo com o
 * usuário (ou a empresa) já inativados ou com a senha já trocada. A cada leitura da sessão no
 * servidor (`auth()` em páginas e APIs) conferimos no banco: inativo, ou senha trocada depois deste
 * login → a sessão deixa de existir na requisição seguinte.
 *
 * Falha de banco não derruba ninguém (a própria requisição já vai falhar ao consultar o banco);
 * só um cadastro inativo, removido ou com outra senha encerra a sessão. `cache`: layout e página
 * chamam `auth()` na mesma renderização — uma consulta só por requisição (fora do React, não memoriza).
 */
const EMPRESA_DA_SESSAO = { ativo: true, configuracao: { select: { appUmDispositivo: true } } } as const;
const lerEmpresa = (id: string) => prisma.empresa.findUnique({ where: { id }, select: EMPRESA_DA_SESSAO });

/**
 * O cadastro de agora, em idas PARALELAS ao banco (roda em TODA página e API): antes, o usuário com o perfil
 * e a empresa (com a configuração) aninhados eram buscados um depois do outro — 3 idas em fila antes de
 * qualquer outra consulta. Agora o usuário e a empresa (a do token) saem juntos; o perfil, só se houver,
 * pelo id. Se a empresa do token não for a do cadastro, vale a do cadastro (busca de novo). Mesmo formato.
 */
export const lerUsuario = cache(async (usuarioId: string, empresaIdDoToken: string | null) => {
  try {
    const [u, empresaDoToken] = await Promise.all([
      prisma.usuario.findUnique({
        where: { id: usuarioId },
        select: { ativo: true, senha: true, sessaoAtiva: true, trocarSenha: true, role: true, empresaId: true, perfilAcessoId: true },
      }),
      empresaIdDoToken ? lerEmpresa(empresaIdDoToken) : Promise.resolve(null),
    ]);
    if (!u) return "removido" as const;
    const [empresa, perfilAcesso] = await Promise.all([
      u.empresaId === empresaIdDoToken && empresaDoToken ? empresaDoToken : lerEmpresa(u.empresaId),
      // O ACESSO de agora (lib/acesso/acesso-atual): papel e perfil
      u.perfilAcessoId ? prisma.perfilAcesso.findUnique({ where: { id: u.perfilAcessoId }, select: { nome: true, ativo: true, permissoes: true } }) : null,
    ]);
    if (!empresa) return "removido" as const;
    const { empresaId: _e, perfilAcessoId: _p, ...cadastro } = u;
    return { ...cadastro, perfilAcesso, empresa };
  } catch (e) {
    console.error("[sessao] não foi possível conferir o usuário", e);
    return null;
  }
});

/**
 * Callback `jwt` do runtime Node: depois do login, a cada leitura confere se o usuário segue ativo e
 * se a senha é a mesma do login (impressão `fs` no token), e põe no token o papel e as permissões
 * do cadastro de agora (`acessoMudou` diz se o cookie recebido estava desatualizado). Sessão aberta antes de existir a impressão
 * passa a carregar a da senha de agora — a partir daí, trocar a senha também a encerra.
 */
export async function conferirTokenAtivo(token: JWT | null, acabouDeEntrar: boolean): Promise<JWT | null> {
  if (!token || acabouDeEntrar) return token; // no login o authorize já exigiu usuário/empresa ativos
  const id = typeof token.id === "string" ? token.id : null;
  if (!id) return null;
  const u = await lerUsuario(id, typeof token.empresaId === "string" ? token.empresaId : null);
  if (u === null) return token;
  if (u === "removido" || motivoDoEncerramento(u, token)) return null;
  const atual = impressaoDaSenha(u.senha ?? "");
  // Papel e permissões são os do cadastro de AGORA, não os do login: conceder ou retirar acesso vale
  // na requisição seguinte, sem pedir que ninguém saia e entre. `acessoMudou` marca que o token que
  // CHEGOU (o cookie) estava diferente — o navegador então pede /api/auth/session, que regrava o
  // cookie com o acesso novo, e o portão do middleware (que só lê o cookie) passa a concordar.
  const acesso = acessoAtual(u);
  // A troca pendente também é a do cadastro de agora (a troca pela própria pessoa limpa; o cookie
  // desta sessão é regravado na hora pela rota da troca, e as outras sessões caem pela senha nova)
  return { ...token, fs: atual, ...acesso, acessoMudou: acessoMudou(token, acesso), trocarSenha: u.trocarSenha === true };
}

type Cadastro = Exclude<Awaited<ReturnType<typeof lerUsuario>>, null>;

/** Por que esta sessão acabou (null = segue valendo). `outro-aparelho` vira a mensagem do login. */
export type MotivoDoEncerramento = "inativo" | "outro-aparelho" | "senha";

/**
 * A regra de encerrar, num lugar só: o callback `jwt` (conferirTokenAtivo) e /sessao-encerrada (que
 * escolhe a mensagem do login) usam a mesma.
 *
 * "Apenas um dispositivo ativo" (Configuracao.appUmDispositivo) vale só para o APP DE CAMPO: o token
 * com técnico ligado e a pessoa em modo técnico (lib/tecnico/modo). Quem usa o escritório (notebook e
 * celular, administrador) nunca cai por ter entrado em outro aparelho. Entrar em outro aparelho regrava
 * o nonce (lib/auth); o técnico com o nonce velho é encerrado aqui.
 */
export function motivoDoEncerramento(u: Cadastro, token: JWT): MotivoDoEncerramento | null {
  if (u === "removido" || !u.ativo || !u.empresa.ativo) return "inativo";
  const acesso = acessoAtual(u);
  const tecnicoId = typeof token.tecnicoId === "string" && token.tecnicoId ? token.tecnicoId : null;
  const appDeCampo = !!tecnicoId && emModoTecnico({ role: acesso.role, permissoes: acesso.permissoes, tecnicoId });
  if (appDeCampo && u.empresa.configuracao?.appUmDispositivo && u.sessaoAtiva && token.sa !== u.sessaoAtiva) return "outro-aparelho";
  if (typeof token.fs === "string" && token.fs !== impressaoDaSenha(u.senha ?? "")) return "senha";
  return null;
}

/** /sessao-encerrada: o motivo de o servidor ter recusado este token (null = sem como saber ou ainda vale). */
export async function motivoDoToken(token: JWT | null): Promise<MotivoDoEncerramento | null> {
  const id = typeof token?.id === "string" ? token.id : null;
  if (!token || !id) return null;
  const u = await lerUsuario(id, typeof token?.empresaId === "string" ? token.empresaId : null);
  return u === null ? null : motivoDoEncerramento(u, token);
}

/** Cookies da sessão do painel (com prefixo seguro e em pedaços). Não toca no cookie do portal. */
export { COOKIE_SESSAO } from "@/lib/acesso/cookie-sessao";
