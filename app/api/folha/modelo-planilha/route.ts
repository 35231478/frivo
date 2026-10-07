import { NextRequest, NextResponse } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { gerarCsv, gerarXlsx } from "@/lib/folha/planilha";
import { linhasModelo } from "@/lib/folha/importacao";

/** Modelo da planilha de importação de colaboradores (?formato=xlsx | csv). */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("financeiro", "folha");
  if (guard.erro) return guard.resposta;
  const { cabecalho, instrucoes } = linhasModelo();

  if (new URL(req.url).searchParams.get("formato") === "csv") {
    return new NextResponse(gerarCsv([cabecalho]), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="modelo-colaboradores.csv"',
        "Cache-Control": "no-store",
      },
    });
  }
  const xlsx = gerarXlsx([
    { nome: "Colaboradores", linhas: [cabecalho], larguras: cabecalho.map((c) => Math.max(12, c.length + 4)) },
    { nome: "Instruções", linhas: instrucoes, larguras: [22, 12, 70, 26] },
  ]);
  return new NextResponse(new Uint8Array(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modelo-colaboradores.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
