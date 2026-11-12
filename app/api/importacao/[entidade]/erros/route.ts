import { NextRequest, NextResponse } from "next/server";
import { gerarXlsx } from "@/lib/folha/planilha";
import { IMPORTACOES } from "@/lib/importacao/entidades";
import { linhasErros, MAX_LINHAS_IMPORTACAO } from "@/lib/importacao/motor";
import { anexo, exigirImportacao, XLSX, type Ctx } from "@/lib/importacao/rotas";

/** Planilha de erros (.xlsx): as linhas que falharam, com os valores originais e o motivo — corrigir e subir de novo. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await exigirImportacao(ctx);
  if (!g.ok) return g.resposta;
  const def = IMPORTACOES[g.entidade];
  const corpo = await req.json().catch(() => null);
  const erros = Array.isArray(corpo?.erros) ? corpo.erros.slice(0, MAX_LINHAS_IMPORTACAO) : null;
  if (!erros) return NextResponse.json({ erro: "Nada para exportar." }, { status: 400 });
  const limpos = erros.map((e: any) => ({
    linha: Number(e?.linha) || 0,
    erros: Array.isArray(e?.erros) ? e.erros.map(String) : [],
    valores: e?.valores && typeof e.valores === "object" ? Object.fromEntries(Object.entries(e.valores).map(([k, v]) => [k, String(v ?? "")])) : {},
  }));
  const linhas = linhasErros(def, limpos);
  return anexo(new Uint8Array(gerarXlsx([{ nome: "Erros", linhas, larguras: linhas[0].map((c, i) => (i === linhas[0].length - 1 ? 70 : Math.max(14, c.length + 4))) }])), XLSX, `erros-importacao-${def.entidade}.xlsx`);
}
