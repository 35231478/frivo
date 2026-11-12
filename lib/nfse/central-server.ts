/**
 * Tela central "Notas fiscais de serviço": carrega a lista (filtrada e paginada no banco), os
 * cards do período e o detalhe da nota. Empresa SEMPRE a da sessão (quem chama passa); nenhum
 * endereço do PlugNotas sai daqui (PDF/XML são baixados pelo nosso servidor: só "tem ou não tem").
 */
import { prisma } from "@/lib/prisma";
import { janela, paginaValida, type ParamsUrl } from "@/lib/listagem";
import { LABEL_STATUS_NOTA, STATUS_VIVOS, type StatusNota } from "@/lib/nfse/nota";
import { marcarAvisosVistos } from "@/lib/nfse/webhook-server";
import { GRUPOS_SITUACAO, lerFiltros, whereNotas, wherePeriodo, type GrupoSituacao } from "@/lib/nfse/central";
import { rotuloMedicao } from "@/lib/faturamento/fatura";

const SELECT_LINHA = {
  id: true, status: true, numero: true, autorizadaEm: true, criadoEm: true, tomadorNome: true, tomadorCpfCnpj: true,
  origem: true, medicaoId: true, ordemServicoId: true, valorServicos: true, ambiente: true, motivo: true,
  plugnotasId: true, pdfUrl: true, xmlUrl: true,
  medicao: { select: { numero: true, avulsa: true } },
  ordemServico: { select: { numero: true } },
} as const;

type Linha = Awaited<ReturnType<typeof buscarLinhas>>[number];
const buscarLinhas = (ids: string[]) => prisma.notaFiscal.findMany({ where: { id: { in: ids } }, select: SELECT_LINHA });

/**
 * Ordem da lista: pela DATA DA NOTA (a da tela: autorização, senão envio), mais recente primeiro.
 * O Prisma não ordena por "autorização ou envio": busca só id + datas do filtro, ordena aqui e
 * traz os dados completos só da página.
 */
async function idsOrdenados(where: object) {
  const chaves = await prisma.notaFiscal.findMany({ where, select: { id: true, autorizadaEm: true, criadoEm: true } });
  return chaves
    .map((n) => ({ id: n.id, t: (n.autorizadaEm ?? n.criadoEm).getTime() }))
    .sort((a, b) => b.t - a.t || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .map((n) => n.id);
}

/** A linha como a tela recebe (sem os endereços do PlugNotas) */
function paraTela(n: Linha) {
  return {
    id: n.id, status: n.status as StatusNota, statusLabel: LABEL_STATUS_NOTA[n.status as StatusNota] ?? n.status,
    numero: n.numero, autorizadaEm: n.autorizadaEm?.toISOString() ?? null, criadoEm: n.criadoEm.toISOString(),
    tomadorNome: n.tomadorNome, tomadorCpfCnpj: n.tomadorCpfCnpj, origem: n.origem,
    medicaoId: n.medicaoId, medicaoNumero: n.medicao?.numero ?? null,
    /** "Fatura 2026-0012" (avulsa) ou "Medição MED-…" */
    medicaoRotulo: n.medicao ? rotuloMedicao(n.medicao) : null,
    ordemServicoId: n.ordemServicoId, osNumero: n.ordemServico?.numero ?? null,
    valorServicos: Number(n.valorServicos), ambiente: n.ambiente, motivo: n.motivo,
    temPdf: !!n.plugnotasId && !!n.pdfUrl, temXml: !!n.plugnotasId && !!n.xmlUrl,
  };
}
export type NotaLinha = ReturnType<typeof paraTela>;

export interface CardResumo { q: number; v: number }
export type ResumoCentral = Record<GrupoSituacao | "aberto" | "total", CardResumo>;

/** Cards do período (e do ambiente escolhido): não dependem da busca nem da situação */
async function resumoDoPeriodo(empresaId: string, f: ReturnType<typeof lerFiltros>): Promise<ResumoCentral> {
  const base = { empresaId, AND: [wherePeriodo(f.periodo), f.ambiente ? { ambiente: f.ambiente } : {}] };
  const grupos = await prisma.notaFiscal.groupBy({ by: ["status"], where: base, _count: { _all: true }, _sum: { valorServicos: true } });
  const de = (status: readonly string[]): CardResumo => grupos
    .filter((g) => status.includes(g.status))
    .reduce((a, g) => ({ q: a.q + g._count._all, v: a.v + Number(g._sum.valorServicos ?? 0) }), { q: 0, v: 0 });
  // Em aberto: medições aprovadas no período (pedido de compra recebido) ainda sem NFS-e nem NF registrada
  const criadoEm = { ...(f.periodo.gte ? { gte: f.periodo.gte } : {}), ...(f.periodo.lt ? { lt: f.periodo.lt } : {}) };
  const aberto = await prisma.medicao.aggregate({
    where: {
      empresaId, status: "PC_RECEBIDO", nfNumero: null, nfs: { none: {} },
      notasFiscais: { none: { status: { in: [...STATUS_VIVOS] } } },
      ...(Object.keys(criadoEm).length ? { criadoEm } : {}),
    },
    _count: { _all: true }, _sum: { valorLiquido: true },
  });
  const emitidas = de(GRUPOS_SITUACAO.emitidas.status);
  return {
    aberto: { q: aberto._count._all, v: Number(aberto._sum.valorLiquido ?? 0) },
    transmissao: de(GRUPOS_SITUACAO.transmissao.status),
    emitidas,
    falha: de(GRUPOS_SITUACAO.falha.status),
    canceladas: de(GRUPOS_SITUACAO.canceladas.status),
    total: { q: grupos.reduce((a, g) => a + g._count._all, 0), v: emitidas.v },
  };
}

/**
 * Tudo o que a tela precisa. Quem tem Fiscal está vendo o resultado das notas da página: elas saem
 * do sino (a mesma regra do card de notas da medição).
 */
export async function carregarCentral(empresaId: string, sp: ParamsUrl, agora = new Date()) {
  const f = lerFiltros(sp, agora);
  const where = whereNotas(empresaId, f);
  const [ordem, resumo] = await Promise.all([idsOrdenados(where), resumoDoPeriodo(empresaId, f)]);
  const total = ordem.length;
  const pagina = paginaValida(f.pagina, f.porPagina, total);
  const { skip, take } = janela(pagina, f.porPagina);
  const daPagina = ordem.slice(skip, skip + take);
  const porId = new Map((daPagina.length ? await buscarLinhas(daPagina) : []).map((n) => [n.id, n]));
  const linhas = daPagina.map((id) => porId.get(id)!).filter(Boolean);
  await marcarAvisosVistos(empresaId, linhas.map((n) => n.id), agora);
  return {
    notas: linhas.map(paraTela), total, pagina, porPagina: f.porPagina, resumo,
    filtros: {
      q: f.q, situacao: f.situacao ?? "", ambiente: f.ambiente ?? "",
      periodo: { tipo: f.periodo.tipo, mes: f.periodo.mes, de: f.periodo.de, ate: f.periodo.ate, rotulo: f.periodo.rotulo },
    },
  };
}
export type DadosCentral = Awaited<ReturnType<typeof carregarCentral>>;

/** O detalhe da nota (gaveta): dados fiscais, itens, discriminação e o histórico completo */
export async function detalheNota(empresaId: string, id: string, agora = new Date()) {
  const n = await prisma.notaFiscal.findFirst({
    where: { id, empresaId },
    include: {
      itens: { select: { descricao: true, quantidade: true, valorTotal: true, valorDesconto: true } },
      eventos: { orderBy: { criadoEm: "desc" }, take: 100, select: { tipo: true, status: true, mensagem: true, criadoEm: true, usuario: { select: { nome: true } } } },
      emitidaPor: { select: { nome: true } },
      medicao: { select: { id: true, numero: true, avulsa: true } },
      ordemServico: { select: { id: true, numero: true } },
      contaReceber: { select: { id: true, numero: true } },
    },
  });
  if (!n) return null;
  await marcarAvisosVistos(empresaId, [n.id], agora);
  return {
    ...paraTela({ ...n, medicao: n.medicao, ordemServico: n.ordemServico }),
    codigoVerificacao: n.codigoVerificacao, protocolo: n.protocolo,
    codigoLc116: n.codigoLc116, codigoTributacao: n.codigoTributacao,
    aliquotaIss: n.aliquotaIss != null ? Number(n.aliquotaIss) : null, issRetido: n.issRetido,
    valorDesconto: Number(n.valorDesconto), discriminacao: n.discriminacao,
    emitidaPor: n.emitidaPor?.nome ?? null,
    contaReceber: n.contaReceber,
    itens: n.itens.map((i) => ({ descricao: i.descricao, quantidade: Number(i.quantidade), valorTotal: Number(i.valorTotal), valorDesconto: Number(i.valorDesconto) })),
    eventos: n.eventos.map((e) => ({ tipo: e.tipo, status: e.status, mensagem: e.mensagem, criadoEm: e.criadoEm.toISOString(), usuario: e.usuario?.nome ?? null })),
  };
}
export type DetalheNota = NonNullable<Awaited<ReturnType<typeof detalheNota>>>;
