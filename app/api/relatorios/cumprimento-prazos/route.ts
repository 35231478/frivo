import { type NextRequest } from "next/server";
import { exigirPermissao } from "@/lib/permissoes-server";
import { prisma } from "@/lib/prisma";
import { respostaPdfArquivo } from "@/lib/pdf/resposta";
import { lerPeriodo } from "@/lib/periodo";
import { formatarCpfCnpj, formatarData, formatarDataHora } from "@/lib/utils";
import { gerarCumprimentoPdf } from "@/lib/prazos/cumprimento-pdf";
import { alvoDoRelatorio, relatorioCumprimento } from "@/lib/prazos/cumprimento-server";

/**
 * O RELATÓRIO DE CUMPRIMENTO DE PRAZOS em PDF — o documento que a empresa manda ao cliente.
 *
 * Mesmos parâmetros da tela (período, cliente, contrato): o papel é o retrato do que está na tela,
 * nunca um segundo relatório com outra conta. `?ver=1` abre no navegador; sem isso, baixa.
 *
 * Permissão: Relatórios › Exportar. Ver a tela (Relatórios › Visualizar) não basta — mandar um
 * documento ao cliente é outro ato.
 */
export async function GET(req: NextRequest) {
  const guard = await exigirPermissao("relatorios", "exportar");
  if (guard.erro) return guard.resposta;
  const empresaId = guard.session.user!.empresaId;

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const agora = new Date();
  const periodo = lerPeriodo(sp, agora, { permitirTodos: true, padrao: "mes" });
  const clienteId = sp.clienteId || null;
  const contratoId = sp.contratoId || null;

  const [{ linhas, resumo }, { cliente, contrato }, empresa] = await Promise.all([
    relatorioCumprimento(empresaId, { gte: periodo.gte ?? undefined, lt: periodo.lt ?? undefined, clienteId, contratoId }, agora),
    alvoDoRelatorio(empresaId, { clienteId, contratoId }),
    prisma.empresa.findUnique({ where: { id: empresaId }, select: { nome: true, nomeFantasia: true, cnpj: true } }),
  ]);

  const arquivo = await gerarCumprimentoPdf({
    empresa: { nome: empresa?.nomeFantasia || empresa?.nome || "", cnpj: formatarCpfCnpj(empresa?.cnpj ?? "") },
    cliente: cliente ? { nome: cliente.nomeFantasia || cliente.nome, documento: formatarCpfCnpj(cliente.cpfCnpj ?? "") } : null,
    contratoNumero: contrato?.numero ?? null,
    periodo: periodo.rotulo,
    geradoEm: formatarDataHora(agora),
    resumo, linhas,
    aberturaDe: (l) => formatarData(l.abertura),
  });
  return respostaPdfArquivo(arquivo, req.nextUrl.searchParams.get("ver") === "1");
}
