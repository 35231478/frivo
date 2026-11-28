/**
 * A LISTA DE OS (/ordens) — o carregamento do servidor, em DUAS ondas de consultas.
 *
 * Antes, a página pedia as OS com `include` aninhados (cliente, unidade, responsável, atividades → técnico,
 * equipe → técnico, medições) e o Prisma busca cada relação numa consulta separada, UMA DEPOIS DA OUTRA:
 * eram 8 idas ao banco em fila só para montar as linhas, mais a contagem antes delas. Com o banco na
 * nuvem (Neon), cada ida custa a latência da rede — a soma é o "muito lento para entrar na tela de OS".
 *
 * Agora:
 *  1ª onda (em paralelo): a contagem, a página de OS (só os campos dela) e as opções dos filtros;
 *  2ª onda (em paralelo): as relações das OS da página, cada uma numa consulta PLANA (filtro por relação no
 *     `where`, que vira uma consulta só): clientes, unidades, responsáveis, atividades, equipes, técnicos e
 *     medições.
 * O resultado é o mesmo de antes (o teste no PostgreSQL compara linha a linha).
 */
import { osEmConferencia } from "@/lib/pedido-cliente/portal-server";
import { prisma } from "@/lib/prisma";
import type { QuemVe } from "@/lib/escopo/proprios";
import type { Prisma } from "@prisma/client";
import { periodoOrdens } from "@/lib/listas/filtros";
import { whereOrdensDaLista } from "@/lib/listas/filtros-server";
import { periodoTela } from "@/lib/periodo";
import { janela, lerPaginacao, paginaValida } from "@/lib/listagem";
import { comparaNatural } from "@/lib/utils";
import { atrasoJustificado, prazoEfetivo, rotuloMotivoAtraso, situacaoPrazoExecucao, temPrazoProprio } from "@/lib/os/prazo-execucao";
import { textoPrazo } from "@/lib/os/prazos";
import { resumoStatus } from "@/lib/os/status";
import { pedidoDasOs, resumoOsAguardando, usaPedidoCliente } from "@/lib/pedido-cliente/server";

export type SPOrdens = Record<string, string | undefined>;

export const SORT_ORDENS: Record<string, (dir: "asc" | "desc") => Prisma.OrdemServicoOrderByWithRelationInput> = {
  numero: (dir) => ({ numero: dir }),
  cliente: (dir) => ({ cliente: { nome: dir } }),
  criadoEm: (dir) => ({ criadoEm: dir }),
  previsaoConclusao: (dir) => ({ previsaoConclusao: dir }),
  status: (dir) => ({ status: dir }),
  prioridade: (dir) => ({ prioridade: dir }),
};

const porId = <T extends { id: string }>(xs: T[]) => new Map(xs.map((x) => [x.id, x]));

export async function carregarListaOs(empresaId: string, sp: SPOrdens, agora: Date = new Date(), quem?: QuemVe) {
  const sort = sp.sort && SORT_ORDENS[sp.sort] ? sp.sort : "criadoEm";
  const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
  const where = await whereOrdensDaLista(empresaId, sp, agora, quem);
  const periodo = periodoTela(periodoOrdens(sp, agora));
  const { pagina: pedida, porPagina } = lerPaginacao(sp);
  // `id` no fim: desempate estável (a paginação não repete nem pula OS)
  const orderBy = [SORT_ORDENS[sort](dir), { id: "asc" as const }];
  const daPagina = (p: number) => prisma.ordemServico.findMany({ where, orderBy, ...janela(p, porPagina) });

  // 1ª onda: a contagem e a página pedida juntas (não esperam uma pela outra), e as opções dos filtros
  const [total, paginaPedida, clientes, usuarios, tiposOs, contratos, resumoPedido] = await Promise.all([
    prisma.ordemServico.count({ where }),
    daPagina(pedida),
    prisma.cliente.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true, nomeFantasia: true }, orderBy: { nome: "asc" } }),
    prisma.usuario.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.tipoOs.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.contrato.findMany({ where: { empresaId }, select: { id: true, numero: true }, orderBy: { numero: "asc" } }),
    // Pedido do cliente (lib/pedido-cliente): a empresa usa? e o filtro rápido "Aguardando pedido" (contagem e R$)
    // + quantas OS têm pedido do portal para conferir (o filtro rápido "Pedido recebido — conferir")
    usaPedidoCliente(empresaId).then(async (u) => (u ? { ...(await resumoOsAguardando(where)), conferir: (await osEmConferencia(empresaId)).length } : null)),
  ]);
  const pagina = paginaValida(pedida, porPagina, total);
  // Página pedida além da última (filtro mudou o total): busca a página válida — o caso raro
  const ordens = pagina === pedida ? paginaPedida : await daPagina(pagina);

  // 2ª onda: as relações das OS da página, em paralelo e sem aninhar
  const ids = ordens.map((o) => o.id);
  const doIds = <T>(lista: (string | null)[], buscar: (ids: string[]) => Promise<T[]>) => {
    const unicos = [...new Set(lista.filter((x): x is string => !!x))];
    return unicos.length ? buscar(unicos) : Promise.resolve([] as T[]);
  };
  const [clientesOs, unidades, responsaveis, atividades, equipes, tecnicos, itensMedicao, medicoes, pedidos] = ids.length ? await Promise.all([
    doIds(ordens.map((o) => o.clienteId), (i) => prisma.cliente.findMany({ where: { id: { in: i } }, select: { id: true, nome: true, nomeFantasia: true, logo: true } })),
    doIds(ordens.map((o) => o.unidadeId), (i) => prisma.unidade.findMany({ where: { id: { in: i } }, select: { id: true, nome: true } })),
    doIds(ordens.map((o) => o.responsavelId), (i) => prisma.usuario.findMany({ where: { id: { in: i } }, select: { id: true, nome: true } })),
    prisma.atividadeOs.findMany({ where: { ordemServicoId: { in: ids } }, select: { id: true, ordemServicoId: true, status: true, dataAgendada: true, tecnicoId: true } }),
    prisma.atividadeTecnico.findMany({ where: { atividade: { ordemServicoId: { in: ids } } }, select: { atividadeId: true, tecnicoId: true } }),
    // os técnicos das atividades (responsáveis e membros das equipes), numa consulta só
    prisma.tecnico.findMany({
      where: { OR: [{ atividadesOs: { some: { ordemServicoId: { in: ids } } } }, { atividadesEquipe: { some: { atividade: { ordemServicoId: { in: ids } } } } }] },
      select: { id: true, nome: true, avatar: true },
    }),
    prisma.medicaoItem.findMany({ where: { ordemServicoId: { in: ids } }, select: { ordemServicoId: true, medicaoId: true } }),
    prisma.medicao.findMany({ where: { itens: { some: { ordemServicoId: { in: ids } } } }, select: { id: true, status: true } }),
    pedidoDasOs(empresaId, ids),
  ]) : [[], [], [], [], [], [], [], [], new Map()];

  // COM-1: o vendedor da OS (gravado ao gerar do orçamento) ou, na OS antiga, o do orçamento de origem
  const origens = ordens.filter((o) => !o.vendedorId && o.orcamentoOrigemId).map((o) => o.orcamentoOrigemId!);
  const vendasOrigem = origens.length ? await prisma.orcamento.findMany({ where: { id: { in: origens }, empresaId }, select: { id: true, vendedorId: true } }) : [];
  const vendedorDaOrigem = new Map(vendasOrigem.map((v) => [v.id, v.vendedorId]));
  const vendedorDa = (o: (typeof ordens)[number]) => o.vendedorId ?? (o.orcamentoOrigemId ? vendedorDaOrigem.get(o.orcamentoOrigemId) ?? null : null);
  const idsVendedores = [...new Set(ordens.map(vendedorDa).filter((x): x is string => !!x))];
  const vendedores = porId(idsVendedores.length ? await prisma.usuario.findMany({ where: { id: { in: idsVendedores } }, select: { id: true, nome: true } }) : []);
  const cliente = porId(clientesOs), unidade = porId(unidades), responsavel = porId(responsaveis), tecnico = porId(tecnicos);
  const medicao = porId(medicoes);
  const equipeDa = new Map<string, string[]>();
  for (const e of equipes) equipeDa.set(e.atividadeId, [...(equipeDa.get(e.atividadeId) ?? []), e.tecnicoId]);
  const atividadesDa = new Map<string, typeof atividades>();
  for (const a of atividades) atividadesDa.set(a.ordemServicoId, [...(atividadesDa.get(a.ordemServicoId) ?? []), a]);
  const medicoesDa = new Map<string, { status: string }[]>();
  for (const i of itensMedicao) {
    const m = medicao.get(i.medicaoId);
    if (m && i.ordemServicoId) medicoesDa.set(i.ordemServicoId, [...(medicoesDa.get(i.ordemServicoId) ?? []), { status: m.status }]);
  }

  const linhas = ordens.map((o) => {
    const ats = atividadesDa.get(o.id) ?? [];
    // Técnicos das atividades (responsáveis + membros das equipes), deduplicados por id e ordenados por nome (pt-BR)
    const ids = ats.flatMap((a) => [a.tecnicoId, ...(equipeDa.get(a.id) ?? [])]).filter((x): x is string => !!x);
    const tecnicosOs = [...new Set(ids)].map((id) => tecnico.get(id)).filter((t): t is NonNullable<typeof t> => !!t)
      .sort((a, b) => comparaNatural(a.nome, b.nome));
    const situacao = situacaoPrazoExecucao(o, agora);
    const cli = cliente.get(o.clienteId);
    return {
      id: o.id,
      numero: o.numero,
      chamadoNumero: o.chamadoNumero,
      origem: o.origem,
      cliente: cli ? cli.nomeFantasia ?? cli.nome : "",
      clienteLogo: cli?.logo ?? null,
      unidade: (o.unidadeId && unidade.get(o.unidadeId)?.nome) || null,
      responsavel: (o.responsavelId && responsavel.get(o.responsavelId)?.nome) || null,
      vendedor: (vendedorDa(o) && vendedores.get(vendedorDa(o)!)?.nome) || null,
      atividades: ats.length,
      tecnicos: tecnicosOs.map((t) => ({ id: t.id, nome: t.nome, avatar: t.avatar ?? null })),
      status: o.status,
      // O ESTÁGIO (o mesmo da barra de andamento da OS): Aberta › Agendada › Em execução › Concluída › Faturada, ou Cancelada
      estagio: resumoStatus({ status: o.status, statusManual: o.statusManual, previsaoConclusao: o.previsaoConclusao, atividades: ats, medicoes: (medicoesDa.get(o.id) ?? []) as never }).exibido,
      prioridade: o.prioridade,
      criadoEm: o.criadoEm.toISOString(),
      previsaoConclusao: o.previsaoConclusao ? o.previsaoConclusao.toISOString() : null,
      // O PRAZO de execução (o próprio ou, sem ele, o dia previsto) e a situação dele hoje — a regra única
      prazo: prazoEfetivo(o)?.toISOString() ?? null,
      prazoProprio: temPrazoProprio(o),
      prazoSituacao: situacao.situacao,
      prazoTexto: textoPrazo(situacao, true),
      atrasoJustificado: atrasoJustificado(o) ? rotuloMotivoAtraso(o.atrasoJustificadoMotivo) || "Justificado" : null,
      // A etiqueta do pedido do cliente (null = o cliente não exige)
      pedidoCliente: pedidos.get(o.id) ?? null,
    };
  });

  return {
    total, pagina, porPagina, periodo, linhas,
    // O filtro rápido "Aguardando pedido": só para a empresa que tem cliente que exige o pedido
    resumoPedido,
    opcoes: {
      clientes: clientes.map((c) => ({ value: c.id, label: c.nomeFantasia ?? c.nome })),
      usuarios: usuarios.map((u) => ({ value: u.id, label: u.nome })),
      tiposOs: tiposOs.map((t) => ({ value: t.id, label: t.nome })),
      contratos: contratos.map((c) => ({ value: c.id, label: c.numero })),
    },
  };
}
