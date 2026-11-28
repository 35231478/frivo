/**
 * Leva H — busca o HISTÓRICO AUTOMÁTICO do cliente no banco (as regras de montar/filtrar/agrupar estão em
 * ./historico). Tudo filtrado pela empresa E pelo cliente. Cada fonte traz no máximo `porFonte` registros (os mais
 * recentes); a linha do tempo final é cortada em `limite`.
 *
 * O financeiro (faturas, pagamentos, cobranças) só entra para quem vê o financeiro (`comFinanceiro`).
 * Com o "Ver só os próprios" da COM-1 (`escopo`), OS, orçamentos, aceites, e-mails das OS, pedidos do cliente e os
 * lembretes deles ficam só os da pessoa: nada que revele o trabalho (ou o volume) dos outros vendedores.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { comEscopo } from "@/lib/escopo/proprios";
import { formatarMoeda } from "@/lib/utils";
import { montarHistorico, ROTULO_NOTA, type EventoCliente } from "./historico";

export interface OpcoesHistorico {
  comFinanceiro: boolean; porFonte?: number; limite?: number;
  /** "Ver só os próprios" (lib/escopo/proprios: filtroOrdens / filtroOrcamentos); vazio = sem limite */
  escopo?: { ordens?: Prisma.OrdemServicoWhereInput; orcamentos?: Prisma.OrcamentoWhereInput };
}

const ROTULO_ORCAMENTO: Record<string, string> = {
  ENVIADO: "enviado ao cliente", ENVIADO_EMAIL: "enviado por e-mail", ENVIADO_WHATSAPP: "enviado por WhatsApp",
  APROVADO: "aprovado", RECUSADO: "recusado",
};
const ROTULO_DOC_CLIENTE: Record<string, string> = { ACESSO: "Cliente abriu a documentação da equipe", DOWNLOAD: "Cliente baixou um documento da equipe", DOWNLOAD_ZIP: "Cliente baixou a documentação da equipe (zip)" };

export async function carregarHistoricoCliente(empresaId: string, clienteId: string, o: OpcoesHistorico): Promise<EventoCliente[]> {
  const take = o.porFonte ?? 100;
  const doCliente = { empresaId, clienteId };
  const desc = { criadoEm: "desc" as const };
  const eo = o.escopo?.ordens ?? {};
  const eorc = o.escopo?.orcamentos ?? {};
  const limitado = Object.keys(eo).length > 0 || Object.keys(eorc).length > 0;
  // Com o escopo, o pedido do cliente só aparece se cobre alguma OS ou orçamento da pessoa; os lembretes, idem
  const pedidoNoEscopo: Prisma.PedidoClienteWhereInput = limitado ? { OR: [{ ordens: { some: eo } }, { orcamentos: { some: eorc } }] } : {};
  const [osDaPessoa, orcDaPessoa] = limitado
    ? await Promise.all([
        prisma.ordemServico.findMany({ where: comEscopo<Prisma.OrdemServicoWhereInput>(doCliente, eo), select: { id: true } }),
        prisma.orcamento.findMany({ where: comEscopo<Prisma.OrcamentoWhereInput>(doCliente, eorc), select: { id: true } }),
      ])
    : [[], []];
  const lembreteNoEscopo: Prisma.PedidoClienteLembreteWhereInput = limitado
    ? { OR: [{ ordemServicoId: { in: osDaPessoa.map((x) => x.id) } }, { orcamentoId: { in: orcDaPessoa.map((x) => x.id) } }] }
    : {};

  const [oss, aceites, orcs, eventosOrc, pedidos, lembretes, contratos, statusContrato, envios, notas, medicoes, recebimentos, cobrancas] = await Promise.all([
    prisma.ordemServico.findMany({ where: comEscopo<Prisma.OrdemServicoWhereInput>(doCliente, eo), orderBy: desc, take, select: { id: true, numero: true, criadoEm: true, dataConclusao: true, origem: true, descricao: true, criadoPor: { select: { nome: true } } } }),
    prisma.osAceite.findMany({ where: { empresaId, ordemServico: comEscopo<Prisma.OrdemServicoWhereInput>({ clienteId }, eo), confirmadoEm: { not: null } }, orderBy: { confirmadoEm: "desc" }, take, select: { id: true, confirmadoEm: true, avaliacao: true, ordemServico: { select: { id: true, numero: true } } } }),
    prisma.orcamento.findMany({ where: comEscopo<Prisma.OrcamentoWhereInput>(doCliente, eorc), orderBy: desc, take, select: { id: true, codigo: true, nome: true, criadoEm: true, criadoPor: { select: { nome: true } } } }),
    prisma.orcamentoEvento.findMany({
      where: { empresaId, orcamento: comEscopo<Prisma.OrcamentoWhereInput>({ clienteId }, eorc), tipo: { in: ["ENVIADO", "ENVIADO_EMAIL", "ENVIADO_WHATSAPP", "APROVADO", "RECUSADO", "VISUALIZADO"] } },
      orderBy: desc, take: take * 2, select: { id: true, tipo: true, detalhe: true, criadoEm: true, usuario: { select: { nome: true } }, orcamento: { select: { id: true, codigo: true } } },
    }),
    prisma.pedidoCliente.findMany({ where: comEscopo<Prisma.PedidoClienteWhereInput>(doCliente, pedidoNoEscopo), orderBy: desc, take, select: { id: true, numero: true, criadoEm: true, origem: true, situacao: true, conferidoEm: true, motivoRecusa: true } }),
    prisma.pedidoClienteLembrete.findMany({ where: comEscopo<Prisma.PedidoClienteLembreteWhereInput>(doCliente, lembreteNoEscopo), orderBy: { enviadoEm: "desc" }, take, select: { id: true, para: true, enviadoEm: true, etapa: true } }),
    prisma.contrato.findMany({ where: doCliente, orderBy: desc, take, select: { id: true, numero: true, criadoEm: true } }),
    prisma.contratoHistoricoStatus.findMany({ where: { empresaId, contrato: { clienteId } }, orderBy: { createdAt: "desc" }, take, select: { id: true, statusNovo: true, createdAt: true, usuario: { select: { nome: true } }, contrato: { select: { id: true, numero: true } } } }),
    prisma.documentacaoEnvioEvento.findMany({
      where: { envio: { empresaId, clienteId }, OR: [{ tipo: "EMAIL_ENVIADO" }, { tipo: { in: ["ACESSO", "DOWNLOAD", "DOWNLOAD_ZIP"] }, usuarioId: null }] },
      orderBy: desc, take, select: { id: true, tipo: true, criadoEm: true, envioId: true },
    }),
    prisma.interacaoCliente.findMany({ where: doCliente, orderBy: desc, take, select: { id: true, tipo: true, descricao: true, criadoEm: true, usuario: { select: { nome: true } } } }),
    o.comFinanceiro ? prisma.medicao.findMany({ where: doCliente, orderBy: desc, take, select: { id: true, numero: true, criadoEm: true, dataEnvio: true, dataPagamento: true, valorLiquido: true, status: true } }) : [],
    o.comFinanceiro ? prisma.contaReceberRecebimento.findMany({ where: { empresaId, contaReceber: { clienteId } }, orderBy: { data: "desc" }, take, select: { id: true, valor: true, data: true, estornadoEm: true, contaReceber: { select: { descricao: true } } } }) : [],
    o.comFinanceiro ? prisma.contaReceberEvento.findMany({ where: { empresaId, contaReceber: { clienteId }, tipo: "COBRANCA_ENVIADA" }, orderBy: desc, take, select: { id: true, criadoEm: true, detalhe: true, contaReceber: { select: { descricao: true } } } }) : [],
  ]);

  // E-mails do sistema ligados às OS deste cliente (o envio do orçamento já vem pelos eventos do orçamento)
  const idsOs = oss.map((x) => x.id);
  const emails = idsOs.length
    ? await prisma.emailLog.findMany({ where: { empresaId, referenciaTipo: "OrdemServico", referenciaId: { in: idsOs } }, orderBy: { enviadoEm: "desc" }, take, select: { id: true, assunto: true, para: true, status: true, enviadoEm: true } })
    : [];

  const ev: EventoCliente[] = [];
  for (const x of oss) {
    const href = `/ordens/${x.id}`;
    ev.push(x.origem === "PORTAL_CLIENTE"
      ? { id: `os-criada-${x.id}`, tipo: "portal", titulo: `Cliente abriu a OS ${x.numero} pelo portal`, detalhe: x.descricao, quando: x.criadoEm, href }
      : { id: `os-criada-${x.id}`, tipo: "os", titulo: `OS ${x.numero} criada`, detalhe: x.descricao, quando: x.criadoEm, href, autor: x.criadoPor?.nome });
    if (x.dataConclusao) ev.push({ id: `os-concluida-${x.id}`, tipo: "os", titulo: `OS ${x.numero} concluída`, quando: x.dataConclusao, href });
  }
  for (const a of aceites) {
    ev.push({ id: `os-aceite-${a.id}`, tipo: "portal", titulo: `Cliente confirmou o serviço da OS ${a.ordemServico.numero}`, detalhe: a.avaliacao ? `Avaliação: ${a.avaliacao} de 5` : null, quando: a.confirmadoEm!, href: `/ordens/${a.ordemServico.id}` });
  }
  for (const x of orcs) ev.push({ id: `orc-criado-${x.id}`, tipo: "orcamento", titulo: `Orçamento ${x.codigo} criado`, detalhe: x.nome, quando: x.criadoEm, href: `/orcamentos/${x.id}`, autor: x.criadoPor?.nome });
  for (const e of eventosOrc) {
    const href = `/orcamentos/${e.orcamento.id}`;
    if (e.tipo === "VISUALIZADO") ev.push({ id: `orc-ev-${e.id}`, tipo: "portal", titulo: `Cliente abriu o orçamento ${e.orcamento.codigo}`, quando: e.criadoEm, href });
    else ev.push({ id: `orc-ev-${e.id}`, tipo: "orcamento", titulo: `Orçamento ${e.orcamento.codigo} ${ROTULO_ORCAMENTO[e.tipo]}`, detalhe: e.detalhe, quando: e.criadoEm, href, autor: e.usuario?.nome });
  }
  for (const p of pedidos) {
    ev.push(p.origem === "PORTAL"
      ? { id: `pedido-${p.id}`, tipo: "portal", titulo: `Cliente enviou o pedido ${p.numero} pelo portal`, quando: p.criadoEm }
      : { id: `pedido-${p.id}`, tipo: "pedido", titulo: `Pedido do cliente ${p.numero} registrado`, quando: p.criadoEm });
    if (p.conferidoEm) ev.push({ id: `pedido-conf-${p.id}`, tipo: "pedido", titulo: p.situacao === "RECUSADO" ? `Pedido ${p.numero} recusado na conferência` : `Pedido ${p.numero} conferido`, detalhe: p.situacao === "RECUSADO" ? p.motivoRecusa : null, quando: p.conferidoEm });
  }
  for (const l of lembretes) ev.push({ id: `lembrete-${l.id}`, tipo: "comunicacao", titulo: "Lembrete do pedido de compra enviado", detalhe: l.para, quando: l.enviadoEm });
  for (const c of contratos) ev.push({ id: `contrato-${c.id}`, tipo: "contrato", titulo: `Contrato ${c.numero} cadastrado`, quando: c.criadoEm, href: `/contratos/${c.id}` });
  for (const h of statusContrato) ev.push({ id: `contrato-st-${h.id}`, tipo: "contrato", titulo: `Contrato ${h.contrato.numero}: ${h.statusNovo.toLowerCase().replace(/_/g, " ")}`, quando: h.createdAt, href: `/contratos/${h.contrato.id}`, autor: h.usuario?.nome });
  for (const d of envios) {
    ev.push(d.tipo === "EMAIL_ENVIADO"
      ? { id: `doc-${d.id}`, tipo: "comunicacao", titulo: "Documentação da equipe enviada por e-mail", quando: d.criadoEm }
      : { id: `doc-${d.id}`, tipo: "portal", titulo: ROTULO_DOC_CLIENTE[d.tipo] ?? "Cliente acessou a documentação da equipe", quando: d.criadoEm });
  }
  for (const n of notas) ev.push({ id: `nota-${n.id}`, tipo: "nota", titulo: ROTULO_NOTA[n.tipo] ?? "Nota", detalhe: n.descricao, quando: n.criadoEm, autor: n.usuario?.nome });
  for (const m of medicoes) {
    const href = `/financeiro/medicoes/${m.id}`;
    const valor = formatarMoeda(Number(m.valorLiquido));
    ev.push({ id: `fatura-${m.id}`, tipo: "financeiro", titulo: `Fatura ${m.numero} criada`, detalhe: valor, quando: m.criadoEm, href });
    if (m.dataEnvio) ev.push({ id: `fatura-env-${m.id}`, tipo: "comunicacao", titulo: `Fatura ${m.numero} enviada ao cliente`, quando: m.dataEnvio, href });
    if (m.dataPagamento) ev.push({ id: `fatura-pag-${m.id}`, tipo: "financeiro", titulo: `Fatura ${m.numero} paga`, detalhe: valor, quando: m.dataPagamento, href });
  }
  for (const r of recebimentos) {
    ev.push({ id: `receb-${r.id}`, tipo: "financeiro", titulo: `Pagamento recebido · ${formatarMoeda(Number(r.valor))}`, detalhe: r.contaReceber.descricao, quando: r.data });
    if (r.estornadoEm) ev.push({ id: `receb-est-${r.id}`, tipo: "financeiro", titulo: `Pagamento estornado · ${formatarMoeda(Number(r.valor))}`, detalhe: r.contaReceber.descricao, quando: r.estornadoEm });
  }
  for (const c of cobrancas) ev.push({ id: `cobranca-${c.id}`, tipo: "comunicacao", titulo: "Cobrança enviada", detalhe: c.detalhe ?? c.contaReceber.descricao, quando: c.criadoEm });
  for (const e of emails) ev.push({ id: `email-${e.id}`, tipo: "comunicacao", titulo: e.status === "ERRO" ? `E-mail não entregue: ${e.assunto}` : `E-mail enviado: ${e.assunto}`, detalhe: e.para, quando: e.enviadoEm });

  return montarHistorico(ev, o.limite ?? 300);
}
