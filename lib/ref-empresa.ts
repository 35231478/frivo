import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Isolamento multi-tenant dos VÍNCULOS recebidos no corpo das requisições: todo id que aponta
 * para outro cadastro (cargo, perfil, tipo de OS, tabela de preço, catálogo…) precisa ser da
 * empresa da sessão. Id de outra empresa (ou inexistente) é recusado com 400, sem dizer se ele
 * existe em outro lugar.
 *
 *   await validarRefEmpresa("cargo", body.cargoId, empresaId, "Cargo");
 *   await validarRefsEmpresa("tipoOs", body.competenciaIds, empresaId, "Competência");
 *
 * Vazio/null/undefined = "sem vínculo" (passa). Não exige `ativo`: um vínculo antigo com um
 * cadastro inativado continua valendo (inativo não pode quebrar o passado).
 */

/** Modelos com `empresaId` que aparecem como vínculo em requisições. */
export type ModeloRef =
  | "cliente" | "cargo" | "perfilAcesso" | "tipoOs" | "tabelaPreco" | "servico" | "produto"
  | "checklistTemplate" | "unidade" | "tecnico" | "equipe" | "veiculo" | "formularioTemplate";

export class ErroRefEmpresa extends Error {}

type Delegate = { count: (args: { where: Record<string, unknown> }) => Promise<number> };
const delegate = (modelo: ModeloRef) => (prisma as unknown as Record<ModeloRef, Delegate>)[modelo];

export async function validarRefsEmpresa(
  modelo: ModeloRef, ids: readonly (string | null | undefined)[] | null | undefined, empresaId: string, rotulo: string,
) {
  const unicos = [...new Set((ids ?? []).filter((x): x is string => typeof x === "string" && x.length > 0))];
  if (!unicos.length) return;
  const n = await delegate(modelo).count({ where: { id: { in: unicos }, empresaId } });
  if (n !== unicos.length) throw new ErroRefEmpresa(`${rotulo} inválido(a).`);
}

export async function validarRefEmpresa(modelo: ModeloRef, id: string | null | undefined, empresaId: string, rotulo: string) {
  return validarRefsEmpresa(modelo, [id], empresaId, rotulo);
}

/** Converte o erro em resposta 400 (ou devolve null se não for erro de vínculo). */
export function respostaRefEmpresa(e: unknown) {
  return e instanceof ErroRefEmpresa ? NextResponse.json({ erro: e.message }, { status: 400 }) : null;
}
