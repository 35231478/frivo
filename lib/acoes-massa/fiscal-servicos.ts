import { prisma } from "@/lib/prisma";
import { CADASTROS } from "@/lib/cadastros/registro";
import { editarCadastro } from "@/lib/cadastros/servidor";
import { mudancasServico, rotulosCampos } from "@/lib/nfse/aplicar-fiscal";
import { falha, ok, type CodigoFalha, type ContextoItem, type ResultadoItem } from "@/lib/acoes-massa/regras";

const CODIGO: Record<number, CodigoFalha> = { 400: "invalido", 403: "sem_permissao", 404: "nao_encontrado", 409: "bloqueado" };

/**
 * "Aplicar dados fiscais (NFS-e)" num serviço: grava só o que muda, pela MESMA edição da rota
 * individual (/api/cadastros/servicos/[id]): validação do registro, trava por campo (Financeiro ›
 * Fiscal) e a empresa da sessão. `ctx.dados` já vem validado e normalizado (camposParaAplicar).
 */
export async function aplicarFiscalServico(id: string, ctx: ContextoItem): Promise<ResultadoItem> {
  const atual = await prisma.servico.findFirst({ where: { id, empresaId: ctx.empresaId } });
  if (!atual) return falha("nao_encontrado", "Não encontrado (ou de outra empresa)");
  const mudar = mudancasServico(atual as Record<string, unknown>, ctx.dados ?? {});
  const chaves = Object.keys(mudar);
  if (!chaves.length) return ok("Já estava assim");
  const r = await editarCadastro(CADASTROS.servicos, {
    id: ctx.usuarioId, nome: ctx.usuarioNome, empresaId: ctx.empresaId, role: ctx.role, permissoes: ctx.permissoes ?? {},
  }, id, mudar);
  if (!r.ok) return falha(CODIGO[r.status] ?? "erro", r.erro);
  return ok(`Atualizado: ${rotulosCampos(chaves)}`);
}
