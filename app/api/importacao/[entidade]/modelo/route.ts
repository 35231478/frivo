import { NextRequest } from "next/server";
import { gerarCsv, gerarXlsx } from "@/lib/folha/planilha";
import { IMPORTACOES } from "@/lib/importacao/entidades";
import { linhasModelo } from "@/lib/importacao/motor";
import { carregarContexto } from "@/lib/importacao/servidor";
import { anexo, exigirImportacao, XLSX, type Ctx } from "@/lib/importacao/rotas";

/** Modelo da planilha (?formato=xlsx|csv): colunas certas + 1 linha de exemplo; aba de instruções com as opções válidas da empresa. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const g = await exigirImportacao(ctx);
  if (!g.ok) return g.resposta;
  const def = IMPORTACOES[g.entidade];
  const { refs } = await carregarContexto(g.entidade, g.empresaId, false);
  const { cabecalho, exemplo, instrucoes } = linhasModelo(def, refs);
  if (req.nextUrl.searchParams.get("formato") === "csv") return anexo(gerarCsv([cabecalho, exemplo]), "text/csv; charset=utf-8", `modelo-${def.entidade}.csv`);
  const xlsx = gerarXlsx([
    { nome: def.plural[0].toUpperCase() + def.plural.slice(1), linhas: [cabecalho, exemplo], larguras: cabecalho.map((c, i) => Math.max(14, c.length + 4, exemplo[i].length + 2)) },
    { nome: "Instruções", linhas: instrucoes, larguras: [20, 12, 70, 60] },
  ]);
  return anexo(new Uint8Array(xlsx), XLSX, `modelo-${def.entidade}.xlsx`);
}
