/**
 * A FUNÇÃO do colaborador (Leva J) — dois conceitos claros no lugar de "Tipo" + "Tipo de equipe".
 *
 * A auditoria (docs/leva-j-colaborador.md) achou uso real dos dois campos, e eles se sobrepunham:
 *  - `tipoEquipe` CAMPO/ADMINISTRATIVO decide as abas de Equipes e quem aparece no mapa de localização;
 *  - `tipo` RESPONSAVEL_TECNICO decide quem aparece como responsável técnico (PMOC, contrato/ART, empresa, orçamento) e
 *    pede o CREA; TECNICO_CAMPO/RESPONSAVEL_TECNICO entram no custo-hora dos técnicos (custo de pessoal) e no filtro
 *    "Técnicos" da lista; TECNICO_CAMPO, nos "técnicos próximos".
 * "Técnico de campo" × "Campo" diziam a mesma coisa em dois lugares e podiam discordar. Agora a tela tem:
 *  - "Usa o app de campo"            → tipoEquipe (a fonte única de "é de campo");
 *  - "Responsável técnico (ART/PMOC)" → tipo RESPONSAVEL_TECNICO.
 * As colunas ficam (nenhuma é apagada) e são gravadas sempre coerentes entre si.
 */

import type { ZodError } from "zod";

export type TipoColaborador = "TECNICO_CAMPO" | "RESPONSAVEL_TECNICO" | "ADMINISTRATIVO" | "MOTORISTA" | "OUTRO";
export type TipoEquipe = "CAMPO" | "ADMINISTRATIVO";

export const ROTULO_CAMPO = "Usa o app de campo";
// O custo-hora segue o `tipo` (TECNICO_CAMPO/RESPONSAVEL_TECNICO, lib/folha/calculo), não esta chave: a dica não o promete
export const DICA_CAMPO = "Aparece na aba Campo de Equipes, no mapa e entre os técnicos da OS.";
export const ROTULO_RT = "Responsável técnico (ART/PMOC)";
export const DICA_RT = "Pode assinar como responsável técnico no PMOC, no contrato (ART) e no orçamento. Pede o CREA.";

/** O que a tela mostra a partir do cadastro */
export function funcaoDaFicha(c: { tipo?: string | null; tipoEquipe?: string | null }): { campo: boolean; rt: boolean } {
  return { campo: (c.tipoEquipe ?? "CAMPO") === "CAMPO", rt: c.tipo === "RESPONSAVEL_TECNICO" };
}

/**
 * O que grava. RT manda no `tipo`; sem RT, o `tipo` segue o "campo" (Técnico de campo × Administrativo). Motorista e
 * Outro (que a tela não oferece mais) ficam como estavam enquanto a pessoa não for RT.
 */
export function gravarFuncao(f: { campo: boolean; rt: boolean }, tipoAtual?: string | null): { tipo: TipoColaborador; tipoEquipe: TipoEquipe } {
  const tipoEquipe: TipoEquipe = f.campo ? "CAMPO" : "ADMINISTRATIVO";
  if (f.rt) return { tipo: "RESPONSAVEL_TECNICO", tipoEquipe };
  if (tipoAtual === "MOTORISTA" || tipoAtual === "OUTRO") return { tipo: tipoAtual, tipoEquipe };
  return { tipo: f.campo ? "TECNICO_CAMPO" : "ADMINISTRATIVO", tipoEquipe };
}

/** O que o servidor diz quando o responsável técnico vem sem o CREA (a ficha, o cadastro rápido e a edição no seletor) */
export const MSG_RT_SEM_CREA = "Informe o CREA do responsável técnico.";

/** O login do app é ligado ao colaborador pelo e-mail: com login, a ficha não fica sem e-mail */
export const MSG_EMAIL_COM_LOGIN = "Este colaborador tem login no sistema: o e-mail não pode ficar vazio. Para tirar o acesso, inative o usuário em Configurações › Usuários.";

/**
 * O par que as rotas gravam a partir do corpo (POST/PUT de /api/tecnicos). Sem `tipoEquipe` (o cadastro rápido, um
 * cliente antigo), ela sai do `tipo`: ADMINISTRATIVO → ADMINISTRATIVO, o resto → CAMPO. Com ela, ela manda no "campo"
 * e o `tipo` é refeito por `gravarFuncao` — os dois nunca discordam no banco.
 */
export function funcaoDoCorpo(tipo: string, tipoEquipe?: TipoEquipe | null): { tipo: TipoColaborador; tipoEquipe: TipoEquipe } {
  const equipe: TipoEquipe = tipoEquipe ?? (tipo === "ADMINISTRATIVO" ? "ADMINISTRATIVO" : "CAMPO");
  return gravarFuncao({ campo: equipe === "CAMPO", rt: tipo === "RESPONSAVEL_TECNICO" }, tipo);
}

/**
 * A recusa do cadastro diz O QUE está errado: a 1ª mensagem do schema (as do tecnicoSchema estão em português). Campo
 * ausente/de tipo errado ou valor fora da lista trazem a mensagem do zod em inglês: nesses fica o genérico.
 */
export function erroDoCadastro(e: ZodError): string {
  const i = e.issues[0];
  // O e-mail é "e-mail OU vazio" (uma união): a mensagem que serve é a do e-mail
  if (i?.code === "invalid_union" && i.unionErrors[0]) return erroDoCadastro(i.unionErrors[0]);
  return i && !["invalid_type", "invalid_enum_value", "unrecognized_keys"].includes(i.code) ? i.message : "Dados inválidos";
}
