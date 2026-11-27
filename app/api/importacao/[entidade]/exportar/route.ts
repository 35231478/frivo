import { gerarXlsx } from "@/lib/folha/planilha";
import { defPara } from "@/lib/importacao/entidades";
import { linhasExportacao, linhasModelo } from "@/lib/importacao/motor";
import { carregarContexto, carregarExportacao } from "@/lib/importacao/servidor";
import { anexo, exigirExportacao, XLSX, type Ctx } from "@/lib/importacao/rotas";
import { chaveDiaBR } from "@/lib/fuso";

/**
 * Baixar a planilha do cadastro (.xlsx): TODOS os registros da empresa da sessão, nas MESMAS colunas
 * do modelo de importação — com o id_sistema (e o código, em produtos/serviços) para o reupload
 * atualizar em vez de duplicar. Aba de instruções igual à do modelo. Permissão: ver o módulo da lista.
 */
export async function GET(_: Request, ctx: Ctx) {
  const g = await exigirExportacao(ctx);
  if (!g.ok) return g.resposta;
  // As colunas restritas (custo) só saem para quem tem a permissão — nem são consultadas para os outros
  const def = defPara(g.entidade, g.permitido, g.papel);
  const [registros, { refs }] = await Promise.all([
    carregarExportacao(g.entidade, g.empresaId, { verCusto: def.colunas.some((c) => c.chave === "custo_unitario") }),
    carregarContexto(g.entidade, g.empresaId, false),
  ]);
  const linhas = linhasExportacao(def, registros, refs);
  const { instrucoes } = linhasModelo(def, refs, { exportada: true });
  const larguras = def.colunas.map((c, i) => Math.min(60, Math.max(12, c.titulo.length + 4, ...linhas.slice(1, 200).map((l) => l[i].length + 2))));
  const xlsx = gerarXlsx([
    { nome: def.plural[0].toUpperCase() + def.plural.slice(1), linhas, larguras },
    { nome: "Instruções", linhas: instrucoes, larguras: [20, 12, 70, 60] },
  ]);
  return anexo(new Uint8Array(xlsx), XLSX, `${def.entidade}-${chaveDiaBR(new Date())}.xlsx`);
}
