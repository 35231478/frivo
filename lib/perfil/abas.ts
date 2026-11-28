/**
 * "Meu perfil" — as regras puras da tela: quais abas existem, qual abrir pela URL e o que mudou nos dados
 * (o corpo do PATCH /api/perfil). A tela (components/perfil/perfil-client) só desenha.
 */

export type AbaPerfil = "dados" | "seguranca" | "comissoes" | "preferencias";

export interface DefAbaPerfil { id: AbaPerfil; label: string }

/**
 * Dados e Segurança sempre; Comissões só quando a empresa usa comissão (COM-1: o extrato da própria pessoa);
 * Preferências só quando há o que preferir (hoje: as notificações deste aparelho).
 */
export function abasDoPerfil(o: { notificacoes: boolean; comissoes?: boolean }): DefAbaPerfil[] {
  return [
    { id: "dados", label: "Dados" },
    { id: "seguranca", label: "Segurança" },
    ...(o.comissoes ? [{ id: "comissoes" as const, label: "Comissões" }] : []),
    ...(o.notificacoes ? [{ id: "preferencias" as const, label: "Preferências" }] : []),
  ];
}

/** A aba pedida na URL (?aba=), se existir nesta tela; senão Dados. Os nomes antigos levam ao lugar novo. */
export function abaInicialDoPerfil(pedida: string | null | undefined, abas: DefAbaPerfil[]): AbaPerfil {
  const antigas: Record<string, AbaPerfil> = { foto: "dados", conta: "dados", notificacoes: "preferencias" };
  const alvo = pedida ? (antigas[pedida] ?? pedida) : "dados";
  return abas.some((a) => a.id === alvo) ? (alvo as AbaPerfil) : "dados";
}

export interface DadosPerfil { nome: string; email: string; telefone: string }

/**
 * O que mudou nos dados (só os campos alterados vão no corpo). `null` = nada mudou. O e-mail só conta quando
 * pode ser editado; trocá-lo pede a confirmação e a senha atual (a rota confere de novo).
 */
export function alteracoesDoPerfil(
  antes: DadosPerfil, agora: DadosPerfil & { confirmacaoEmail?: string; senhaAtual?: string },
  o: { emailEditavel: boolean },
): Record<string, string | null> | null {
  const corpo: Record<string, string | null> = {};
  if (agora.nome.trim() !== antes.nome.trim()) corpo.nome = agora.nome.trim();
  const tel = agora.telefone.trim();
  if (tel !== antes.telefone.trim()) corpo.telefone = tel || null;
  if (o.emailEditavel && agora.email.trim().toLowerCase() !== antes.email.trim().toLowerCase()) {
    corpo.email = agora.email.trim();
    corpo.confirmacaoEmail = (agora.confirmacaoEmail ?? "").trim();
    corpo.senhaAtual = agora.senhaAtual ?? "";
  }
  return Object.keys(corpo).length ? corpo : null;
}

/** "Administrador · Clima Total": o perfil de acesso UMA vez (o nome do perfil, ou o papel quando não há perfil). */
export const linhaDaConta = (perfilNome: string | null | undefined, cargo: string, empresa: string) =>
  [perfilNome?.trim() || cargo, empresa].filter(Boolean).join(" · ");
