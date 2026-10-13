import { NextRequest, NextResponse } from "next/server";
import { ErroPlanilha, lerPlanilha } from "@/lib/folha/planilha";
import { IMPORTACOES } from "@/lib/importacao/entidades";
import { analisar, ErroImportacao, MAX_BYTES_IMPORTACAO } from "@/lib/importacao/motor";
import { carregarContexto, gravarImportacao } from "@/lib/importacao/servidor";
import { exigirImportacao, type Ctx } from "@/lib/importacao/rotas";

/**
 * Importação em massa por planilha (clientes, fornecedores, serviços, produtos) — motor único.
 * - etapa=previa: analisa e devolve o que vai acontecer (nada é gravado);
 * - etapa=confirmar: analisa o arquivo DE NOVO e grava as linhas válidas em lotes.
 * Empresa sempre da sessão; criar exige a permissão de criar; atualizar duplicados, a de editar.
 */
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: Ctx) {
  const g = await exigirImportacao(ctx);
  if (!g.ok) return g.resposta;
  const def = IMPORTACOES[g.entidade];

  const form = await req.formData().catch(() => null);
  const arquivo = form?.get("arquivo");
  if (!form || !(arquivo instanceof Blob)) return NextResponse.json({ erro: "Envie o arquivo da planilha (.xlsx ou .csv)." }, { status: 400 });
  if (arquivo.size > MAX_BYTES_IMPORTACAO) return NextResponse.json({ erro: "Arquivo maior que 5 MB." }, { status: 400 });
  const confirmar = form.get("etapa") === "confirmar";

  let analise;
  try {
    const tabela = lerPlanilha(Buffer.from(await arquivo.arrayBuffer()), (arquivo as File).name ?? "", MAX_BYTES_IMPORTACAO);
    analise = analisar(tabela, def, await carregarContexto(g.entidade, g.empresaId, g.podeAtualizar));
  } catch (e) {
    if (e instanceof ErroPlanilha || e instanceof ErroImportacao) return NextResponse.json({ erro: e.message }, { status: 400 });
    throw e;
  }

  // Prévia: sem os dados convertidos (só o que a tela mostra)
  if (!confirmar) {
    return NextResponse.json({
      podeAtualizar: g.podeAtualizar,
      analise: { ...analise, linhas: analise.linhas.map(({ dados: _d, existenteId: _e, chave: _c, ...l }) => l) },
    });
  }
  if (analise.resumo.criar + analise.resumo.atualizar === 0)
    return NextResponse.json({ erro: "Nenhuma linha válida para gravar: corrija a planilha e envie de novo." }, { status: 400 });

  const r = await gravarImportacao(g.entidade, analise, g.empresaId);
  return NextResponse.json({ ok: true, criados: r.criados, atualizados: r.atualizados, comErro: r.erros.length, erros: r.erros });
}
