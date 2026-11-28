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

export type TipoColaborador = "TECNICO_CAMPO" | "RESPONSAVEL_TECNICO" | "ADMINISTRATIVO" | "MOTORISTA" | "OUTRO";
export type TipoEquipe = "CAMPO" | "ADMINISTRATIVO";

export const ROTULO_CAMPO = "Usa o app de campo";
export const DICA_CAMPO = "Aparece na aba Campo de Equipes, no mapa e entre os técnicos da OS; entra no custo-hora dos técnicos.";
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
