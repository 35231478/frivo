/**
 * A TRILHA DA EMPRESA na área do dono do Frivo (tabela `empresa_eventos`) — a parte pura: os tipos, os rótulos
 * da tela e o texto de cada evento. Quem grava é lib/empresa/criar-empresa.ts.
 *
 *  - DADOS_EDITADOS: o super admin editou o cadastro (detalhe: uma linha "Campo: antes → depois" por campo);
 *  - NOVA_SENHA_ADMIN: nova senha provisória do 1º administrador (o detalhe diz de quem; NUNCA a senha);
 *  - INATIVADA / REATIVADA: a situação da empresa.
 */

export const TIPOS_EVENTO_EMPRESA = ["DADOS_EDITADOS", "NOVA_SENHA_ADMIN", "INATIVADA", "REATIVADA"] as const;
export type TipoEventoEmpresa = (typeof TIPOS_EVENTO_EMPRESA)[number];

export const ROTULO_EVENTO_EMPRESA: Record<TipoEventoEmpresa, string> = {
  DADOS_EDITADOS: "Dados editados",
  NOVA_SENHA_ADMIN: "Nova senha provisória do administrador",
  INATIVADA: "Empresa inativada",
  REATIVADA: "Empresa reativada",
};

export const rotuloEventoEmpresa = (tipo: string) => ROTULO_EVENTO_EMPRESA[tipo as TipoEventoEmpresa] ?? tipo;

/** Os dados que o super admin edita, na ordem da tela. */
export const CAMPOS_EMPRESA = [
  ["razaoSocial", "Razão social"],
  ["nomeFantasia", "Nome fantasia"],
  ["cnpj", "CNPJ"],
  ["email", "E-mail"],
  ["telefone", "Telefone"],
] as const;
export type CampoEmpresa = (typeof CAMPOS_EMPRESA)[number][0];
export type DadosEmpresa = Record<CampoEmpresa, string | null>;

const mostrar = (v: string | null | undefined) => (v && v.trim() ? v.trim() : "(vazio)");

/**
 * O que mudou, uma linha por campo: "Razão social: Antiga Ltda → Nova Ltda". Vazio e nulo são a mesma coisa;
 * o e-mail compara sem maiúsculas (é gravado em minúsculas). Nada mudou = lista vazia (nenhum evento).
 */
export function diferencasEmpresa(antes: DadosEmpresa, depois: DadosEmpresa): string[] {
  const igual = (c: CampoEmpresa, a: string | null, b: string | null) => {
    const x = (a ?? "").trim(), y = (b ?? "").trim();
    return c === "email" ? x.toLowerCase() === y.toLowerCase() : x === y;
  };
  return CAMPOS_EMPRESA.filter(([c]) => !igual(c, antes[c], depois[c])).map(([c, rotulo]) => `${rotulo}: ${mostrar(antes[c])} → ${mostrar(depois[c])}`);
}

/** O detalhe do evento de nova senha: de quem foi — a senha não entra na trilha. */
export const detalheNovaSenhaAdmin = (admin: { nome: string; email: string }) =>
  `Para ${admin.nome} (${admin.email}). Troca obrigatória no próximo acesso; as sessões abertas foram encerradas.`;
