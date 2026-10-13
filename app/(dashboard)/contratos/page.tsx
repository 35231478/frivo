import { SelecaoMassaProvider } from "@/components/acoes-massa/selecao";
import { BarraAcoesMassa } from "@/components/acoes-massa/barra";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { whereContratos } from "@/lib/listas/filtros";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";
import { ContratosListaClient } from "@/components/contratos/contratos-lista-client";

export const metadata: Metadata = { title: "Contratos" };

type SP = {
  busca?: string; status?: string; frequencia?: string;
  vigenciaInicio?: string; vigenciaFim?: string; valorMin?: string; valorMax?: string;
  clienteId?: string; sort?: string; dir?: string; pagina?: string; por?: string;
};

const SORT_MAP: Record<string, (dir: "asc" | "desc") => any> = {
  numero: (dir) => ({ numero: dir }),
  status: (dir) => ({ status: dir }),
  valorMensal: (dir) => ({ valorMensal: dir }),
  dataInicio: (dir) => ({ dataInicio: dir }),
  dataFim: (dir) => ({ dataFim: dir }),
  cliente: (dir) => ({ cliente: { nome: dir } }),
};

export default async function ContratosPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const session = await auth();
  const empresaId = session!.user!.empresaId;

  const agora = new Date();
  const em30 = new Date(agora.getTime() + 30 * 864e5);
  const sort = sp.sort && SORT_MAP[sp.sort] ? sp.sort : "dataInicio";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";

  const where = whereContratos(empresaId, sp, agora);
  const { pagina: paginaPedida, porPagina } = lerPaginacao(sp);
  const total = await prisma.contrato.count({ where });
  const pagina = paginaValida(paginaPedida, porPagina, total);

  const [contratos, agregadoFiltrado, ativos, somaAtivos, vencendo, vencidos, clientes] = await Promise.all([
    prisma.contrato.findMany({
      where,
      include: {
        cliente: { select: { id: true, nome: true, nomeFantasia: true, logo: true } },
        ordensServico: { where: { previsaoConclusao: { gte: agora } }, orderBy: { previsaoConclusao: "asc" }, take: 1, select: { id: true, numero: true, status: true, previsaoConclusao: true } },
      },
      orderBy: [SORT_MAP[sort](dir), { id: "asc" }],
      ...janela(pagina, porPagina),
    }),
    prisma.contrato.aggregate({ where, _sum: { valorMensal: true } }),
    prisma.contrato.count({ where: { empresaId, status: "ATIVO" } }),
    prisma.contrato.aggregate({ where: { empresaId, status: "ATIVO" }, _sum: { valorMensal: true } }),
    prisma.contrato.count({ where: { empresaId, status: "ATIVO", dataFim: { gte: agora, lte: em30 } } }),
    prisma.contrato.count({ where: { empresaId, status: { not: "ENCERRADO" }, dataFim: { lt: agora } } }),
    prisma.cliente.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, nomeFantasia: true }, orderBy: { nome: "asc" } }),
  ]);

  const valorMensalAtivos = Number(somaAtivos._sum.valorMensal ?? 0);

  const view = contratos.map((c) => {
    const fim = c.dataFim;
    const vencido = !!fim && fim < agora && c.status !== "ENCERRADO";
    const vencendo = !!fim && fim >= agora && fim <= em30 && c.status === "ATIVO";
    return {
      id: c.id,
      numero: c.numero,
      cliente: c.cliente.nomeFantasia ?? c.cliente.nome,
      clienteLogo: c.cliente.logo ?? null,
      periodicidade: c.periodicidade,
      valorMensal: c.valorMensal ? Number(c.valorMensal) : null,
      dataInicio: c.dataInicio.toISOString(),
      dataFim: fim ? fim.toISOString() : null,
      status: c.status,
      vencido, vencendo,
      proximaOs: c.ordensServico[0]
        ? { id: c.ordensServico[0].id, numero: c.ordensServico[0].numero, status: c.ordensServico[0].status, previsaoConclusao: c.ordensServico[0].previsaoConclusao?.toISOString() ?? null }
        : null,
    };
  });

  return (
    <SelecaoMassaProvider entidade="contratos" idsPagina={contratos.map((c) => c.id)} total={total}>
    <ContratosListaClient
      contratos={view}
      total={total}
      pagina={pagina}
      porPagina={porPagina}
      somaMensalFiltrada={Number(agregadoFiltrado._sum.valorMensal ?? 0)}
      resumo={{ ativos, valorMensalTotal: valorMensalAtivos, valorAnualTotal: valorMensalAtivos * 12, vencendo, vencidos }}
      opcoesClientes={clientes.map((c) => ({ value: c.id, label: c.nomeFantasia ?? c.nome }))}
    />
    <BarraAcoesMassa />
    </SelecaoMassaProvider>
  );
}
