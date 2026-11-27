/**
 * "Troca de senha no 1º acesso": quem entrou com uma senha definida por OUTRA pessoa (o 1º admin
 * criado em Empresas, o técnico com acesso liberado ou redefinido na ficha) só usa o sistema depois
 * de trocar a senha. A marca vem do cadastro (`usuarios.trocar_senha`) para o token no login.
 *
 * Regra pura e segura para o Edge (o middleware a usa): sem banco, sem bcrypt.
 *  - enquanto a troca estiver pendente, só abrem a tela de troca e a rota que troca a senha
 *    (sair é /api/auth, que o middleware nem intercepta);
 *  - página pedida → vai para a tela de troca; API pedida → 403 com a mensagem (nada é feito).
 */
export const ROTA_TROCAR_SENHA = "/trocar-senha";
/** A troca em si: a mesma rota de Meu perfil › Segurança (exige a senha atual, com limite de erros). */
export const API_TROCAR_SENHA = "/api/perfil/senha";
export const MENSAGEM_TROCA_PENDENTE = "Troque a sua senha para continuar.";

/** Caminhos que abrem com a troca pendente (o caminho exato ou abaixo dele). */
const LIBERADOS = [ROTA_TROCAR_SENHA, API_TROCAR_SENHA, "/sessao-encerrada"] as const;

export function trocaPendente(user: unknown): boolean {
  return !!user && typeof user === "object" && (user as { trocarSenha?: unknown }).trocarSenha === true;
}

export type DecisaoDaTroca = { tipo: "api" } | { tipo: "pagina"; destino: string } | null;

/**
 * O que fazer com o pedido de quem ainda precisa trocar a senha (null = segue normalmente).
 * Rotas públicas não chegam aqui (o middleware só chama para quem está logado fora delas).
 */
export function decisaoDaTroca(pathname: string, user: unknown): DecisaoDaTroca {
  if (!trocaPendente(user)) return null;
  if (LIBERADOS.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return null;
  if (pathname === "/api" || pathname.startsWith("/api/")) return { tipo: "api" };
  return { tipo: "pagina", destino: ROTA_TROCAR_SENHA };
}
