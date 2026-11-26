/**
 * O ACESSO de quem está logado é o do cadastro de AGORA, não o do momento do login.
 *
 * Antes, papel, perfil e permissões eram gravados no token (JWT) no login e valiam até a sessão
 * vencer (até 30 dias). Dois efeitos, ambos vistos em uso:
 *  - o administrador concede "Admissão digital › Gerenciar" ao perfil do RH, e quem já estava
 *    logado continua em "sem permissão" até sair e entrar de novo;
 *  - o administrador RETIRA uma permissão (ou inativa o perfil), e quem já estava logado continua
 *    com ela — na tela e na API.
 *
 * Aqui fica a regra pura (sem banco): o que o cadastro diz hoje e se isso difere do token. Quem lê
 * o banco é lib/sessao-ativa.ts (uma consulta por requisição, a mesma que já conferia "ativo").
 */
import { permissoesDoUsuario, type Permissoes } from "@/lib/permissoes";

export interface CadastroDeAcesso<R extends string = string> {
  role: R;
  perfilAcesso?: { nome?: string | null; ativo?: boolean | null; permissoes: unknown } | null;
}

export interface AcessoAtual<R extends string = string> {
  role: R;
  permissoes: Permissoes;
  perfilNome: string | null;
}

/** Papel, permissões e nome do perfil como o cadastro está agora (mesma regra do login). */
export function acessoAtual<R extends string>(u: CadastroDeAcesso<R>): AcessoAtual<R> {
  const perfil = u.perfilAcesso;
  return {
    role: u.role,
    permissoes: permissoesDoUsuario({ role: u.role, perfilAcesso: perfil ?? null }),
    perfilNome: perfil && perfil.ativo !== false ? perfil.nome ?? null : null,
  };
}

/** Só as ações LIGADAS, em ordem estável: `{ a: { x: false } }` e `{}` dão o mesmo acesso. */
function ligadas(p: unknown): string {
  if (!p || typeof p !== "object") return "";
  const chaves: string[] = [];
  for (const [modulo, acoes] of Object.entries(p as Record<string, unknown>)) {
    if (!acoes || typeof acoes !== "object") continue;
    for (const [acao, v] of Object.entries(acoes as Record<string, unknown>)) if (v === true) chaves.push(`${modulo}.${acao}`);
  }
  return chaves.sort().join(",");
}

/**
 * O acesso do token é diferente do acesso de agora? (papel ou alguma ação ligada/desligada.)
 * O nome do perfil não conta: trocar o nome não muda o que a pessoa pode fazer.
 */
export function acessoMudou(token: { role?: unknown; permissoes?: unknown }, atual: AcessoAtual): boolean {
  return token.role !== atual.role || ligadas(token.permissoes) !== ligadas(atual.permissoes);
}
