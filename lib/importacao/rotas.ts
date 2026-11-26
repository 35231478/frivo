import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pode, type Acao, type Permissoes } from "@/lib/permissoes";
import { ehEntidadeImportacao, IMPORTACOES, type EntidadeImportacao } from "@/lib/importacao/entidades";
import { PERMISSOES_IMPORTACAO, temRequisito } from "@/lib/importacao/servidor";
import { MODULO_DA_IMPORTACAO, PERMISSOES_EXPORTACAO } from "@/lib/importacao/entidades";
import { MSG_MODULO_DESLIGADO } from "@/lib/modulos/catalogo";
import { temModulo } from "@/lib/modulos/servidor";

/** Planilha de um módulo que a empresa desligou: 403 com o motivo (permissão é do usuário, módulo é da empresa). */
async function moduloDesligado(entidade: EntidadeImportacao, empresaId: string) {
  const m = MODULO_DA_IMPORTACAO[entidade];
  if (!m || (await temModulo(empresaId, m))) return null;
  return NextResponse.json({ erro: MSG_MODULO_DESLIGADO(m), modulo: m }, { status: 403 });
}

export type Ctx = { params: Promise<{ entidade: string }> };

/**
 * Sessão + cadastro + permissão de CRIAR (importar). `podeAtualizar` = permissão de editar.
 * A empresa vem SEMPRE da sessão — nada da planilha decide empresa.
 */
export async function exigirImportacao(ctx: Ctx): Promise<
  | { ok: true; entidade: EntidadeImportacao; empresaId: string; podeAtualizar: boolean; permitido: (m: string, a: Acao) => boolean }
  | { ok: false; resposta: NextResponse }
> {
  const { entidade } = await ctx.params;
  if (!ehEntidadeImportacao(entidade)) return { ok: false, resposta: NextResponse.json({ erro: "Importação não disponível para este cadastro." }, { status: 404 }) };
  const session = await auth();
  const u = session?.user;
  if (!u) return { ok: false, resposta: NextResponse.json({ erro: "Não autorizado" }, { status: 401 }) };
  const permissoes = (u.permissoes ?? {}) as Permissoes;
  const req = PERMISSOES_IMPORTACAO[entidade];
  if (!temRequisito(req.criar, permissoes, u.role))
    return { ok: false, resposta: NextResponse.json({ erro: `Sem permissão para importar ${IMPORTACOES[entidade].plural} (precisa poder criar).` }, { status: 403 }) };
  const desligado = await moduloDesligado(entidade, u.empresaId);
  if (desligado) return { ok: false, resposta: desligado };
  return {
    ok: true, entidade, empresaId: u.empresaId, podeAtualizar: temRequisito(req.editar, permissoes, u.role),
    permitido: (m, a) => pode(permissoes, m, a, u.role),
  };
}

/** Baixar a planilha: sessão + cadastro + permissão de VER o módulo da lista. Empresa sempre da sessão. */
export async function exigirExportacao(ctx: Ctx): Promise<
  | { ok: true; entidade: EntidadeImportacao; empresaId: string }
  | { ok: false; resposta: NextResponse }
> {
  const { entidade } = await ctx.params;
  if (!ehEntidadeImportacao(entidade)) return { ok: false, resposta: NextResponse.json({ erro: "Exportação não disponível para este cadastro." }, { status: 404 }) };
  const session = await auth();
  const u = session?.user;
  if (!u) return { ok: false, resposta: NextResponse.json({ erro: "Não autorizado" }, { status: 401 }) };
  if (!temRequisito(PERMISSOES_EXPORTACAO[entidade], (u.permissoes ?? {}) as Permissoes, u.role))
    return { ok: false, resposta: NextResponse.json({ erro: `Sem permissão para baixar a planilha de ${IMPORTACOES[entidade].plural}.` }, { status: 403 }) };
  const desligado = await moduloDesligado(entidade, u.empresaId);
  if (desligado) return { ok: false, resposta: desligado };
  return { ok: true, entidade, empresaId: u.empresaId };
}

export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const anexo = (corpo: Uint8Array | string, tipo: string, nome: string) =>
  new NextResponse(corpo as BodyInit, { headers: { "Content-Type": tipo, "Content-Disposition": `attachment; filename="${nome}"`, "Cache-Control": "no-store" } });
