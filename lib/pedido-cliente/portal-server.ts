/**
 * PEDIDO DO CLIENTE NO PORTAL (PC-2) — servidor. A regra pura está em ./lembretes e ./regra.
 *  - o que espera o pedido de um cliente (o portal mostra; o lembrete lista; o escritório vê o "último lembrete");
 *  - o comprador anexa o "Pedido de compra" (fica "Pedido recebido — conferir"; nada é liberado ainda);
 *  - os pedidos em conferência (o sino e a etiqueta do escritório).
 * Isolamento: tudo filtra pela empresa E pelo cliente da sessão do portal; um id de outro cliente é recusado.
 */
import { prisma } from "@/lib/prisma";
import { agendarPush, notificarPedidoRecebido } from "@/lib/push/eventos";
import { whereOrcamentoAguardando, whereOsAguardando } from "@/lib/pedido-cliente/where";
import { lerDadosPedido, valoresDasOs, type DadosPedido } from "@/lib/pedido-cliente/server";
import { diasEsperando, inicioDaEspera, modoEfetivo, reais } from "@/lib/pedido-cliente/regra";
import { ACAO_TRILHA_RESOLVIDO, podePedidoNoPortal, resolvidoPorOutroMeio, type TipoItemPedido } from "@/lib/pedido-cliente/lembretes";

const num = (v: unknown) => Number(v ?? 0) || 0;

/** O que espera o pedido, como o portal e o lembrete mostram */
export interface ItemPendente {
  tipo: TipoItemPedido;
  id: string;
  numero: string;
  /** Conclusão da OS (ou aprovação do orçamento) */
  concluidoEm: Date | null;
  valor: number;
  /** null = a espera ainda não começou (OS de "para faturar" ainda em execução) */
  diasEsperando: number | null;
  unidade: string | null;
  /** O relatório da OS (PDF) ou o orçamento, pelo link público */
  documento: string | null;
  /** Coberto por um pedido de compra do portal que o escritório ainda não conferiu */
  emConferencia: { pedidoId: string; numero: string } | null;
  ultimoLembrete: Date | null;
}

/**
 * O contato vê "Pedido de compra" no portal? Ele é o comprador (a permissão, ou o "Contato de compras" da ficha) E
 * o cliente (ou alguma unidade dele) exige o pedido. Devolve também o cliente, para a página.
 */
export async function acessoPedidoNoPortal(user: { empresaId: string; clienteId: string; email?: string | null; permissoes?: Record<string, boolean> | null }) {
  const cliente = await prisma.cliente.findFirst({
    where: { id: user.clienteId, empresaId: user.empresaId },
    select: { nome: true, nomeFantasia: true, comprasEmail: true, comprasNome: true, exigePcAntesNf: true, unidades: { where: { exigePedido: { in: ["FATURAR", "EXECUTAR"] } }, select: { id: true }, take: 1 } },
  });
  if (!cliente) return { pode: false as const, cliente: null };
  const exige = cliente.exigePcAntesNf || cliente.unidades.length > 0;
  return { pode: exige && podePedidoNoPortal(user, cliente.comprasEmail), cliente };
}

/**
 * Os pedidos do portal em conferência deste cliente (ou da empresa toda): item → pedido. Só contam os itens que AINDA
 * esperam o pedido: se a OS/orçamento se resolveu por outro caminho (pedido informado em massa ou na fatura, liberado,
 * cancelado, faturado), o pedido do portal não fica "em conferência" para sempre no sino, no filtro e na etiqueta.
 *
 * Leva I.2 — e o pedido que NADA mais espera encerra aqui, como RESOLVIDO ("Resolvido por outro meio"), com a trilha
 * nas OS. Um ponto só, na leitura: todo caminho que resolve um item (registrar, liberar, cancelar a OS, recusar o
 * orçamento, faturar, mudar a exigência do cliente) passa a valer na próxima vez que o sino, o portal, a lista ou o
 * lembrete olham — sem depender de cada um desses caminhos lembrar de encerrar. A troca é condicional
 * (`situacao: "CONFERIR"`): duas leituras ao mesmo tempo, ou a conferência do escritório no meio, encerram uma vez só.
 */
async function emConferencia(empresaId: string, clienteId?: string) {
  const todos = await prisma.pedidoCliente.findMany({
    where: { empresaId, ...(clienteId ? { clienteId } : {}), situacao: "CONFERIR" },
    select: { id: true, numero: true, clienteId: true, osPropostas: true, orcamentosPropostos: true, criadoEm: true },
    orderBy: { criadoEm: "desc" }, take: 500,
  });
  const idsOs = [...new Set(todos.flatMap((p) => p.osPropostas))];
  const idsOrc = [...new Set(todos.flatMap((p) => p.orcamentosPropostos))];
  const [osVivas, orcVivos] = await Promise.all([
    idsOs.length ? prisma.ordemServico.findMany({ where: { AND: [{ id: { in: idsOs }, empresaId }, whereOsAguardando()] }, select: { id: true } }) : [],
    idsOrc.length ? prisma.orcamento.findMany({ where: { AND: [{ id: { in: idsOrc }, empresaId }, whereOrcamentoAguardando()] }, select: { id: true } }) : [],
  ]);
  const vivaOs = new Set(osVivas.map((o) => o.id));
  const vivoOrc = new Set(orcVivos.map((o) => o.id));
  const resolvidos = todos.filter((p) => resolvidoPorOutroMeio({ situacao: "CONFERIR", ...p }, { os: vivaOs, orc: vivoOrc }));
  if (resolvidos.length) await encerrarResolvidos(empresaId, resolvidos);
  const ps = todos
    .map((p) => ({ ...p, osPropostas: p.osPropostas.filter((id) => vivaOs.has(id)), orcamentosPropostos: p.orcamentosPropostos.filter((id) => vivoOrc.has(id)) }))
    .filter((p) => p.osPropostas.length || p.orcamentosPropostos.length);
  const os = new Map<string, { pedidoId: string; numero: string }>();
  const orc = new Map<string, { pedidoId: string; numero: string }>();
  for (const p of ps) {
    for (const id of p.osPropostas) if (!os.has(id)) os.set(id, { pedidoId: p.id, numero: p.numero });
    for (const id of p.orcamentosPropostos) if (!orc.has(id)) orc.set(id, { pedidoId: p.id, numero: p.numero });
  }
  return { pedidos: ps, os, orc };
}

/** Leva I.2 — encerra os pedidos do portal que nada mais espera (RESOLVIDO), com a trilha nas OS do próprio cliente */
async function encerrarResolvidos(empresaId: string, pedidos: { id: string; numero: string; clienteId: string; osPropostas: string[] }[]) {
  const autor = await autorDoSistema(empresaId);
  for (const p of pedidos) {
    await prisma.$transaction(async (tx) => {
      const r = await tx.pedidoCliente.updateMany({ where: { id: p.id, empresaId, situacao: "CONFERIR" }, data: { situacao: "RESOLVIDO", conferidoEm: new Date(), conferidoPorId: null } });
      if (!r.count || !autor || !p.osPropostas.length) return;
      const oss = await tx.ordemServico.findMany({ where: { id: { in: p.osPropostas }, empresaId, clienteId: p.clienteId }, select: { id: true } });
      if (oss.length) await tx.osHistorico.createMany({ data: oss.map((o) => ({ ordemServicoId: o.id, usuarioId: autor, acao: ACAO_TRILHA_RESOLVIDO, detalhes: `nº ${p.numero}` })) });
    }).catch((e: unknown) => console.error("[pedido do portal] encerrar resolvido", p.id, (e as Error)?.message));
  }
}

/** O último lembrete de cada item (o escritório mostra "Último lembrete em …") */
export async function ultimosLembretes(empresaId: string, osIds: string[], orcamentoIds: string[] = []) {
  const [o, c] = await Promise.all([
    osIds.length ? prisma.pedidoClienteLembrete.groupBy({ by: ["ordemServicoId"], where: { empresaId, ordemServicoId: { in: osIds } }, _max: { enviadoEm: true } }) : [],
    orcamentoIds.length ? prisma.pedidoClienteLembrete.groupBy({ by: ["orcamentoId"], where: { empresaId, orcamentoId: { in: orcamentoIds } }, _max: { enviadoEm: true } }) : [],
  ]);
  return {
    os: new Map(o.map((x) => [x.ordemServicoId as string, x._max.enviadoEm as Date])),
    orc: new Map(c.map((x) => [x.orcamentoId as string, x._max.enviadoEm as Date])),
  };
}

/**
 * Tudo o que espera o pedido de UM cliente: as OS e os orçamentos aprovados (o orçamento cuja OS gerada já está na
 * lista não aparece duas vezes: a OS o representa). Em ordem de espera (o mais antigo primeiro).
 */
export async function pendentesDoCliente(empresaId: string, clienteId: string, agora: Date = new Date()): Promise<ItemPendente[]> {
  const [oss, orcs, conf] = await Promise.all([
    prisma.ordemServico.findMany({
      where: { empresaId, clienteId, ...whereOsAguardando() },
      select: {
        id: true, numero: true, criadoEm: true, dataConclusao: true, cliente: { select: { exigePcAntesNf: true, exigePedidoExecutar: true } },
        unidade: { select: { nome: true, exigePedido: true } },
        orcamentoOrigem: { select: { assinadoEm: true } },
        relatorios: { where: { escopo: "GERAL" }, select: { tokenPublico: true }, orderBy: { criadoEm: "desc" }, take: 1 },
      },
      orderBy: { criadoEm: "asc" }, take: 500,
    }),
    prisma.orcamento.findMany({
      where: { empresaId, clienteId, ...whereOrcamentoAguardando() },
      select: {
        id: true, codigo: true, assinadoEm: true, atualizadoEm: true, totalGeral: true, tokenPublico: true,
        cliente: { select: { exigePcAntesNf: true, exigePedidoExecutar: true } }, unidade: { select: { nome: true, exigePedido: true } },
        osGerada: { select: { id: true } },
      },
      orderBy: { criadoEm: "asc" }, take: 500,
    }),
    emConferencia(empresaId, clienteId),
  ]);
  const idsOs = new Set(oss.map((o) => o.id));
  const orcsSoltos = orcs.filter((o) => !(o.osGerada && idsOs.has(o.osGerada.id)));
  const [valores, lembretes] = await Promise.all([valoresDasOs([...idsOs]), ultimosLembretes(empresaId, [...idsOs], orcsSoltos.map((o) => o.id))]);

  const itens: ItemPendente[] = [
    ...oss.map((o) => {
      const modo = modoEfetivo(o.cliente, o.unidade);
      const inicio = inicioDaEspera({ modo, aprovadoEm: o.orcamentoOrigem?.assinadoEm ?? null, criadoEm: o.criadoEm, concluidoEm: o.dataConclusao });
      return {
        tipo: "os" as const, id: o.id, numero: o.numero, concluidoEm: o.dataConclusao, valor: valores.get(o.id) ?? 0,
        diasEsperando: inicio ? diasEsperando(inicio, agora) : null, unidade: o.unidade?.nome ?? null,
        documento: o.relatorios[0] ? `/relatorio/os/${o.relatorios[0].tokenPublico}` : null,
        emConferencia: conf.os.get(o.id) ?? null, ultimoLembrete: lembretes.os.get(o.id) ?? null,
      };
    }),
    ...orcsSoltos.map((o) => {
      const aprovado = o.assinadoEm ?? o.atualizadoEm;
      return {
        tipo: "orcamento" as const, id: o.id, numero: o.codigo, concluidoEm: aprovado, valor: num(o.totalGeral),
        diasEsperando: diasEsperando(aprovado, agora), unidade: o.unidade?.nome ?? null,
        documento: `/orcamento/${o.tokenPublico}`,
        emConferencia: conf.orc.get(o.id) ?? null, ultimoLembrete: lembretes.orc.get(o.id) ?? null,
      };
    }),
  ];
  return itens.sort((a, b) => (b.diasEsperando ?? -1) - (a.diasEsperando ?? -1));
}

/** Os pedidos de compra que o cliente enviou pelo portal (os mais recentes), com a situação e o motivo da recusa */
export async function pedidosEnviadosPeloPortal(empresaId: string, clienteId: string) {
  // Leva I.2: o que se resolveu por outro caminho já aparece como "Resolvido por outro meio"
  await emConferencia(empresaId, clienteId);
  const ps = await prisma.pedidoCliente.findMany({
    where: { empresaId, clienteId, origem: "PORTAL" },
    select: {
      id: true, numero: true, data: true, valor: true, situacao: true, motivoRecusa: true, criadoEm: true, conferidoEm: true, anexoNome: true,
      osPropostas: true, orcamentosPropostos: true,
    },
    orderBy: { criadoEm: "desc" }, take: 30,
  });
  const idsOs = [...new Set(ps.flatMap((p) => p.osPropostas))];
  const idsOrc = [...new Set(ps.flatMap((p) => p.orcamentosPropostos))];
  const [oss, orcs] = await Promise.all([
    idsOs.length ? prisma.ordemServico.findMany({ where: { id: { in: idsOs }, empresaId, clienteId }, select: { id: true, numero: true } }) : [],
    idsOrc.length ? prisma.orcamento.findMany({ where: { id: { in: idsOrc }, empresaId, clienteId }, select: { id: true, codigo: true } }) : [],
  ]);
  const nome = new Map<string, string>([...oss.map((o) => [o.id, o.numero] as const), ...orcs.map((o) => [o.id, `Orçamento ${o.codigo}`] as const)]);
  return ps.map((p) => ({
    id: p.id, numero: p.numero, data: p.data, valor: p.valor == null ? null : Number(p.valor), situacao: p.situacao,
    motivoRecusa: p.situacao === "RECUSADO" ? p.motivoRecusa : null, enviadoEm: p.criadoEm, conferidoEm: p.conferidoEm, anexoNome: p.anexoNome,
    itens: [...p.osPropostas, ...p.orcamentosPropostos].map((id) => nome.get(id)).filter((n): n is string => !!n),
    // As chaves "os:id" / "orcamento:id" (o portal só repete o aviso da recusa enquanto algum item ainda espera)
    chaves: [...p.osPropostas.map((id) => `os:${id}`), ...p.orcamentosPropostos.map((id) => `orcamento:${id}`)],
  }));
}

/** Quem assina o que o sistema grava na trilha da OS (o histórico exige um usuário): o gestor mais antigo */
export async function autorDoSistema(empresaId: string): Promise<string | null> {
  const u = await prisma.usuario.findFirst({ where: { empresaId, ativo: true, role: { in: ["ADMIN", "GERENTE"] } }, select: { id: true }, orderBy: { criadoEm: "asc" } })
    ?? await prisma.usuario.findFirst({ where: { empresaId, ativo: true }, select: { id: true }, orderBy: { criadoEm: "asc" } });
  return u?.id ?? null;
}

type Falha = { ok: false; status: number; erro: string };
const falha = (status: number, erro: string): Falha => ({ ok: false, status, erro });
export const MSG_ITENS_PORTAL = "Escolha ao menos um serviço que aguarda o pedido de compra.";
export const MSG_ITEM_INVALIDO = "Algum serviço escolhido não aguarda mais o pedido de compra (ou já tem um pedido em conferência). Atualize a página.";

/**
 * O comprador anexa o pedido de compra no portal. Os itens precisam ser do PRÓPRIO cliente, estar aguardando o
 * pedido e fora de outra conferência. O pedido nasce "CONFERIR": nenhuma OS é ligada e o faturamento continua
 * travado até o escritório confirmar. A trilha da OS registra o envio; o escritório recebe o push.
 */
export async function enviarPedidoPeloPortal(
  contato: { id: string; nome: string | null | undefined; empresaId: string; clienteId: string },
  dados: DadosPedido, ligar: { osIds?: string[]; orcamentoIds?: string[] },
): Promise<Falha | { ok: true; pedidoId: string }> {
  const lido = lerDadosPedido(dados);
  if ("ok" in lido) return lido;
  if (!lido.anexo) return falha(400, "Anexe o pedido de compra (PDF ou foto).");
  const osIds = [...new Set(ligar.osIds ?? [])].slice(0, 200);
  const orcamentoIds = [...new Set(ligar.orcamentoIds ?? [])].slice(0, 200);
  if (!osIds.length && !orcamentoIds.length) return falha(400, MSG_ITENS_PORTAL);
  const pendentes = await pendentesDoCliente(contato.empresaId, contato.clienteId);
  const livre = (tipo: TipoItemPedido, id: string) => pendentes.some((i) => i.tipo === tipo && i.id === id && !i.emConferencia);
  if (!osIds.every((id) => livre("os", id)) || !orcamentoIds.every((id) => livre("orcamento", id))) return falha(400, MSG_ITEM_INVALIDO);
  const autor = await autorDoSistema(contato.empresaId);
  const quem = (contato.nome ?? "").trim() || "o cliente";
  const detalhe = `nº ${lido.numero}${lido.valor != null ? ` · ${reais(lido.valor)}` : ""} · por ${quem} (o escritório confere)`;

  const pedido = await prisma.$transaction(async (tx) => {
    const p = await tx.pedidoCliente.create({
      data: {
        empresaId: contato.empresaId, clienteId: contato.clienteId, numero: lido.numero, data: lido.data, valor: lido.valor, observacao: lido.observacao,
        anexo: lido.anexo!.conteudo, anexoNome: lido.anexo!.nome, anexoTipo: lido.anexo!.tipo, criadoPorId: null,
        origem: "PORTAL", situacao: "CONFERIR", osPropostas: osIds, orcamentosPropostos: orcamentoIds, enviadoPorContatoId: contato.id,
      },
      select: { id: true },
    });
    if (autor && osIds.length) await tx.osHistorico.createMany({ data: osIds.map((id) => ({ ordemServicoId: id, usuarioId: autor, acao: "Pedido de compra recebido pelo portal", detalhes: detalhe })) });
    // no orçamento, o evento sem usuário é "o cliente"
    if (orcamentoIds.length) await tx.orcamentoEvento.createMany({ data: orcamentoIds.map((id) => ({ empresaId: contato.empresaId, orcamentoId: id, tipo: "PEDIDO_CLIENTE", detalhe: `Pedido de compra recebido pelo portal ${detalhe}`, usuarioId: null })) });
    return p;
  });
  agendarPush(() => notificarPedidoRecebido(contato.empresaId, pedido.id));
  return { ok: true, pedidoId: pedido.id };
}

/* ───────── o escritório: o que está em conferência ───────── */

/**
 * O sino: quantos pedidos do portal esperam a conferência (com algum item ainda esperando) e o mais recente. Um só:
 * o link vai direto à OS dele — ou ao orçamento, quando o pedido cobre só orçamentos (a lista de OS não o mostraria).
 */
export async function contarPedidosConferir(empresaId: string) {
  const { pedidos } = await emConferencia(empresaId);
  const ultimo = pedidos[0];
  const um = pedidos.length === 1 ? ultimo : null;
  return {
    pedidosConferir: pedidos.length, pedidoConferirId: ultimo?.id ?? null,
    pedidoConferirOsId: um?.osPropostas[0] ?? null,
    pedidoConferirOrcamentoId: um && !um.osPropostas.length ? um.orcamentosPropostos[0] ?? null : null,
  };
}

/** As OS cobertas por pedidos em conferência (o filtro `?pedido=conferir` da lista de OS) */
export async function osEmConferencia(empresaId: string): Promise<string[]> {
  return [...(await emConferencia(empresaId)).os.keys()];
}

/** Para a etiqueta: o pedido em conferência que cobre cada OS / orçamento */
export async function conferenciaDosItens(empresaId: string) {
  const c = await emConferencia(empresaId);
  return { os: c.os, orc: c.orc };
}
