/**
 * DESPESAS DE CAMPO — lado do banco. Regras puras em lib/tecnico/despesas.ts.
 *  - app (fila offline): `lancarDespesa` (idempotente pelo clientId; com ou sem OS; só o próprio colaborador);
 *    `despesasDoColaborador` e `fotoDaDespesa` (só as dele);
 *  - escritório (Financeiro › Despesas de campo): `listarDespesas`, `aprovarDespesa` (do bolso → conta a pagar de
 *    reembolso ao colaborador, na mesma transação; pela empresa → só registra), `recusarDespesa` (motivo obrigatório),
 *    o mapa de categorias e as despesas de uma OS (o custo fica na OS);
 *  - sino: as pendentes.
 */
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { escopoDaSessao } from "@/lib/tecnico/escopo";
import { prisma } from "@/lib/prisma";
import { TIPOS_IMAGEM } from "@/lib/anexos";
import { validarDataUrl } from "@/lib/anexos-server";
import { chaveHojeBR, diaCivilDeChave, chaveDiaCivil } from "@/lib/fuso";
import { proximoNumeroContaPagar } from "@/lib/financeiro-server";
import { tecnicoDoUsuario } from "@/lib/tecnico/escopo";
import { agendarPush, notificarDespesa, URL_DESPESAS_APP, URL_DESPESAS_ESCRITORIO } from "@/lib/push/eventos";
import type { Ator, ContextoExecucao } from "@/lib/execucao/contexto";
import {
  categoriaFinanceiraDe, dataDespesaValida, descricaoReembolso, lerMapa, MSG_DESPESA_DECIDIDA_CORRIGIR, MSG_DESPESA_DE_OUTRO, MSG_DESPESA_EXCLUIDA,
  MSG_DESPESAS_DESLIGADAS, MSG_JA_DECIDIDA, MSG_SEM_COLABORADOR, mudancasDaDespesa, NOME_CATEGORIA, resumoDaDespesa,
  situacaoDespesa, type CategoriaDespesa, type DadosDespesa, type DespesaTela, type EdicaoDespesa, type MapaCategorias, type Pagamento, type StatusDespesa,
} from "@/lib/tecnico/despesas";

type Resultado<T> = { ok: true; status: number; dados: T } | { ok: false; status: number; erro: string };
const erro = (status: number, mensagem: string): Resultado<never> => ({ ok: false, status, erro: mensagem });
const TAMANHO_MAX_CUPOM = 5 * 1024 * 1024;

/** O colaborador de quem lança: o da sessão; ligado depois do login, pelo e-mail. */
async function colaboradorDoAtor(ator: Ator): Promise<string | null> {
  if (ator.escopo.tecnicoId) {
    const t = await prisma.tecnico.findFirst({ where: { id: ator.escopo.tecnicoId, empresaId: ator.empresaId, ativo: true }, select: { id: true } });
    if (t) return t.id;
  }
  const u = await prisma.usuario.findFirst({ where: { id: ator.usuarioId, empresaId: ator.empresaId }, select: { email: true } });
  return (await tecnicoDoUsuario(ator.empresaId, u?.email))?.id ?? null;
}

/** O app lança a despesa (com ou sem OS). A mesma gravação reenviada não duplica. */
export async function lancarDespesa(ator: Ator, d: DadosDespesa, ctx: ContextoExecucao | null, hoje: string = chaveHojeBR()): Promise<Resultado<{ id: string; repetida?: boolean }>> {
  const cfg = await prisma.configuracao.findUnique({ where: { empresaId: ator.empresaId }, select: { appLancarDespesas: true } });
  if (cfg && !cfg.appLancarDespesas) return erro(403, MSG_DESPESAS_DESLIGADAS);
  const tecnicoId = await colaboradorDoAtor(ator);
  if (!tecnicoId) return erro(403, MSG_SEM_COLABORADOR);
  const ja = await prisma.despesaCampo.findUnique({ where: { empresaId_clientId: { empresaId: ator.empresaId, clientId: d.clientId } }, select: { id: true, tecnicoId: true } });
  if (ja) return ja.tecnicoId === tecnicoId ? { ok: true, status: 200, dados: { id: ja.id, repetida: true } } : erro(409, "Identificador de despesa já usado.");
  // D7: a excluída pelo colaborador não volta por um reenvio atrasado da fila
  const excluida = await prisma.despesaCampoHistorico.findFirst({ where: { empresaId: ator.empresaId, clientId: d.clientId, acao: "EXCLUIDA" }, select: { despesaId: true, tecnicoId: true } });
  if (excluida) return excluida.tecnicoId === tecnicoId ? { ok: true, status: 200, dados: { id: excluida.despesaId, repetida: true } } : erro(409, "Identificador de despesa já usado.");
  const invalida = dataDespesaValida(d.data, hoje);
  if (invalida) return erro(422, invalida);
  const v = validarDataUrl(d.foto, "cupom.jpg", { tipos: TIPOS_IMAGEM, tamanhoMax: TAMANHO_MAX_CUPOM, mensagemTipo: "Envie a foto do cupom (JPG, PNG, WEBP ou HEIC)." });
  if (!v.ok) return erro(400, v.erro);
  try {
    const criada = await prisma.despesaCampo.create({
      data: {
        empresaId: ator.empresaId, tecnicoId, usuarioId: ator.usuarioId,
        ordemServicoId: ctx?.atividade.ordemServico.id ?? null, atividadeId: ctx?.atividade.id ?? null,
        categoria: d.categoria, valor: d.valor, data: diaCivilDeChave(d.data)!, pagamento: d.pagamento,
        descricao: (d.descricao ?? "").trim() || null, clientId: d.clientId,
        foto: { create: { conteudo: d.foto } },
      },
      select: { id: true },
    });
    // Push "Despesa para aprovar": o escritório que aprova (Financeiro › Fluxo de caixa), menos quem lançou
    agendarPush(() => notificarDespesa({
      empresaId: ator.empresaId, despesaId: criada.id, situacao: "ENVIADA", autorUsuarioId: ator.usuarioId,
      descricao: (d.descricao ?? "").trim() || NOME_CATEGORIA[d.categoria], valor: d.valor, url: URL_DESPESAS_ESCRITORIO,
    }));
    return { ok: true, status: 201, dados: { id: criada.id } };
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") {
      const r = await prisma.despesaCampo.findUnique({ where: { empresaId_clientId: { empresaId: ator.empresaId, clientId: d.clientId } }, select: { id: true } });
      if (r) return { ok: true, status: 200, dados: { id: r.id, repetida: true } };
    }
    throw e;
  }
}

/* ───────── D7: o colaborador corrige ou exclui (enquanto o escritório não decidiu) ───────── */

const SELECT_COMPARAR = { id: true, tecnicoId: true, status: true, categoria: true, valor: true, data: true, pagamento: true, descricao: true } as const;
type LinhaComparar = Prisma.DespesaCampoGetPayload<{ select: typeof SELECT_COMPARAR }>;
const comparavel = (d: LinhaComparar) => ({ categoria: d.categoria as CategoriaDespesa, valor: Number(d.valor), data: chaveDiaCivil(d.data), pagamento: d.pagamento as Pagamento, descricao: d.descricao });

/** A despesa do colaborador da sessão pelo clientId (ou o motivo de não poder mexer nela). */
async function despesaParaCorrigir(ator: Ator, clientId: string): Promise<{ ok: true; d: LinhaComparar; tecnicoId: string } | { ok: false; r: Resultado<never> } | { ok: "excluida" }> {
  const tecnicoId = await colaboradorDoAtor(ator);
  if (!tecnicoId) return { ok: false, r: erro(403, MSG_SEM_COLABORADOR) };
  const d = await prisma.despesaCampo.findUnique({ where: { empresaId_clientId: { empresaId: ator.empresaId, clientId } }, select: SELECT_COMPARAR });
  if (!d) {
    const ex = await prisma.despesaCampoHistorico.findFirst({ where: { empresaId: ator.empresaId, clientId, acao: "EXCLUIDA", tecnicoId }, select: { id: true } });
    return ex ? { ok: "excluida" } : { ok: false, r: erro(404, "Despesa não encontrada.") };
  }
  if (d.tecnicoId !== tecnicoId) return { ok: false, r: erro(403, MSG_DESPESA_DE_OUTRO) };
  if (d.status !== "PENDENTE") return { ok: false, r: erro(409, MSG_DESPESA_DECIDIDA_CORRIGIR) };
  return { ok: true, d, tecnicoId };
}

/**
 * Corrige a despesa (os mesmos campos do lançamento; a foto só se trocou). Só a do colaborador da sessão e só enquanto o
 * escritório não decidiu — a trava é a mesma da aprovação (a linha PENDENTE): quem chega primeiro vale. A trilha guarda
 * o que mudou. Reenviada (nada mudou): ok, sem trilha nova.
 */
export async function editarDespesa(ator: Ator, d: EdicaoDespesa, hoje: string = chaveHojeBR()): Promise<Resultado<{ id: string; mudou: boolean }>> {
  const achou = await despesaParaCorrigir(ator, d.clientId);
  if (achou.ok === "excluida") return erro(404, MSG_DESPESA_EXCLUIDA);
  if (!achou.ok) return achou.r;
  const { d: atual, tecnicoId } = achou;
  const invalida = dataDespesaValida(d.data, hoje);
  // Corrigir não pode mover a despesa para fora da janela; o dia que já estava (antigo) continua valendo
  if (invalida && d.data !== chaveDiaCivil(atual.data)) return erro(422, invalida);
  if (d.foto) {
    const v = validarDataUrl(d.foto, "cupom.jpg", { tipos: TIPOS_IMAGEM, tamanhoMax: TAMANHO_MAX_CUPOM, mensagemTipo: "Envie a foto do cupom (JPG, PNG, WEBP ou HEIC)." });
    if (!v.ok) return erro(400, v.erro);
  }
  const depois = { categoria: d.categoria, valor: d.valor, data: d.data, pagamento: d.pagamento, descricao: (d.descricao ?? "").trim() || null };
  const fotoAtual = d.foto ? (await prisma.despesaCampoFoto.findUnique({ where: { despesaId: atual.id }, select: { conteudo: true } }))?.conteudo ?? null : null;
  const mudancas = mudancasDaDespesa(comparavel(atual), depois, !!d.foto && d.foto !== fotoAtual);
  if (!mudancas.length) return { ok: true, status: 200, dados: { id: atual.id, mudou: false } };
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.despesaCampo.updateMany({
      where: { id: atual.id, empresaId: ator.empresaId, status: "PENDENTE" },
      data: { categoria: depois.categoria, valor: depois.valor, data: diaCivilDeChave(depois.data)!, pagamento: depois.pagamento, descricao: depois.descricao },
    });
    if (!count) return erro(409, MSG_DESPESA_DECIDIDA_CORRIGIR);
    if (d.foto && d.foto !== fotoAtual) await tx.despesaCampoFoto.upsert({ where: { despesaId: atual.id }, create: { despesaId: atual.id, conteudo: d.foto }, update: { conteudo: d.foto } });
    await tx.despesaCampoHistorico.create({ data: { empresaId: ator.empresaId, despesaId: atual.id, clientId: d.clientId, tecnicoId, usuarioId: ator.usuarioId, acao: "EDITADA", detalhes: mudancas.join(" · ") } });
    return { ok: true as const, status: 200, dados: { id: atual.id, mudou: true } };
  });
}

/** Exclui a despesa (a do colaborador, ainda não decidida). Reenviada: ok. A trilha guarda o que ela era. */
export async function excluirDespesa(ator: Ator, clientId: string): Promise<Resultado<{ excluida: true }>> {
  const achou = await despesaParaCorrigir(ator, clientId);
  if (achou.ok === "excluida") return { ok: true, status: 200, dados: { excluida: true } };
  if (!achou.ok) return achou.r;
  const { d, tecnicoId } = achou;
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.despesaCampo.deleteMany({ where: { id: d.id, empresaId: ator.empresaId, status: "PENDENTE" } });
    if (!count) return erro(409, MSG_DESPESA_DECIDIDA_CORRIGIR);
    await tx.despesaCampoHistorico.create({ data: { empresaId: ator.empresaId, despesaId: d.id, clientId, tecnicoId, usuarioId: ator.usuarioId, acao: "EXCLUIDA", detalhes: resumoDaDespesa(comparavel(d)) } });
    return { ok: true as const, status: 200, dados: { excluida: true as const } };
  });
}

const SELECT_TELA = {
  id: true, clientId: true, categoria: true, valor: true, data: true, pagamento: true, descricao: true, status: true, motivoRecusa: true,
  ordemServico: { select: { numero: true, chamadoNumero: true } }, contaPagar: { select: { status: true } },
} as const;
type LinhaTela = Prisma.DespesaCampoGetPayload<{ select: typeof SELECT_TELA }>;
const paraTela = (d: LinhaTela): DespesaTela => ({
  id: d.id, clientId: d.clientId, categoria: d.categoria as CategoriaDespesa, valor: Number(d.valor), data: chaveDiaCivil(d.data), pagamento: d.pagamento as Pagamento,
  descricao: d.descricao, osNumero: d.ordemServico ? d.ordemServico.chamadoNumero ?? d.ordemServico.numero : null,
  situacao: situacaoDespesa({ status: d.status, pagamento: d.pagamento, contaPaga: d.contaPagar?.status === "PAGO_TOTAL" }), motivoRecusa: d.motivoRecusa,
});

/** "Minhas despesas" (últimos 90 dias): só as do colaborador da sessão. */
export async function despesasDoColaborador(ator: Ator): Promise<DespesaTela[] | null> {
  const tecnicoId = await colaboradorDoAtor(ator);
  if (!tecnicoId) return null;
  const desde = new Date(Date.now() - 90 * 86_400_000);
  const l = await prisma.despesaCampo.findMany({ where: { empresaId: ator.empresaId, tecnicoId, data: { gte: desde } }, orderBy: [{ data: "desc" }, { criadoEm: "desc" }], take: 200, select: SELECT_TELA });
  return l.map(paraTela);
}

/** A foto do cupom: o escritório (qualquer despesa da empresa) ou o próprio colaborador. */
export async function fotoDaDespesa(empresaId: string, id: string, op: { ator?: Ator } = {}): Promise<string | null> {
  const d = await prisma.despesaCampo.findFirst({ where: { id, empresaId }, select: { tecnicoId: true, foto: { select: { conteudo: true } } } });
  if (!d) return null;
  if (op.ator && d.tecnicoId !== (await colaboradorDoAtor(op.ator))) return null;
  return d.foto?.conteudo ?? null;
}

/* ───────── escritório ───────── */

/** As rotas do escritório não servem ao modo técnico (nem com Financeiro liberado): o técnico só vê as próprias, pelo app. */
export function soEscritorio(session: Parameters<typeof escopoDaSessao>[0]): NextResponse | null {
  return escopoDaSessao(session).restrito ? NextResponse.json({ erro: "O técnico vê as próprias despesas pelo app." }, { status: 403 }) : null;
}

export interface DespesaEscritorio {
  id: string; colaborador: string; categoria: CategoriaDespesa; categoriaNome: string; valor: number; data: string; pagamento: Pagamento;
  descricao: string | null; os: { id: string; numero: string } | null; status: StatusDespesa; motivoRecusa: string | null;
  decididoPor: string | null; decididoEm: string | null; contaPagar: { id: string; numero: string; status: string } | null; criadoEm: string;
  /** D7 — o que o colaborador corrigiu pelo app antes da decisão (a mais recente primeiro) */
  correcoes: { em: string; detalhes: string }[];
}
/** D7 — a despesa que o colaborador excluiu pelo app antes da decisão (o que ela era) */
export interface DespesaExcluida { id: string; colaborador: string; em: string; detalhes: string }

export async function listarDespesas(empresaId: string, f: { status?: StatusDespesa | "TODAS"; osId?: string } = {}): Promise<DespesaEscritorio[]> {
  const l = await prisma.despesaCampo.findMany({
    where: { empresaId, ...(f.status && f.status !== "TODAS" && { status: f.status }), ...(f.osId && { ordemServicoId: f.osId }) },
    orderBy: [{ data: "desc" }, { criadoEm: "desc" }], take: 500,
    select: {
      id: true, categoria: true, valor: true, data: true, pagamento: true, descricao: true, status: true, motivoRecusa: true, decididoPorId: true, decididoEm: true, criadoEm: true,
      tecnico: { select: { nome: true } }, ordemServico: { select: { id: true, numero: true, chamadoNumero: true } }, contaPagar: { select: { id: true, numero: true, status: true } },
    },
  });
  const ids = [...new Set(l.map((d) => d.decididoPorId).filter((x): x is string => !!x))];
  const [nomes, trilha] = await Promise.all([
    ids.length ? prisma.usuario.findMany({ where: { id: { in: ids }, empresaId }, select: { id: true, nome: true } }).then((us) => new Map(us.map((u) => [u.id, u.nome]))) : new Map<string, string>(),
    l.length ? prisma.despesaCampoHistorico.findMany({ where: { empresaId, acao: "EDITADA", despesaId: { in: l.map((d) => d.id) } }, orderBy: { criadoEm: "desc" }, select: { despesaId: true, criadoEm: true, detalhes: true } }) : [],
  ]);
  const correcoes = new Map<string, { em: string; detalhes: string }[]>();
  for (const t of trilha) (correcoes.get(t.despesaId) ?? correcoes.set(t.despesaId, []).get(t.despesaId)!).push({ em: t.criadoEm.toISOString(), detalhes: t.detalhes });
  return l.map((d) => ({
    id: d.id, colaborador: d.tecnico.nome, categoria: d.categoria as CategoriaDespesa, categoriaNome: NOME_CATEGORIA[d.categoria as CategoriaDespesa] ?? d.categoria,
    valor: Number(d.valor), data: chaveDiaCivil(d.data), pagamento: d.pagamento as Pagamento, descricao: d.descricao,
    os: d.ordemServico ? { id: d.ordemServico.id, numero: d.ordemServico.chamadoNumero ?? d.ordemServico.numero } : null,
    status: d.status as StatusDespesa, motivoRecusa: d.motivoRecusa, decididoPor: d.decididoPorId ? nomes.get(d.decididoPorId) ?? null : null,
    decididoEm: d.decididoEm?.toISOString() ?? null, contaPagar: d.contaPagar, criadoEm: d.criadoEm.toISOString(),
    correcoes: correcoes.get(d.id) ?? [],
  }));
}

/** D7 — as excluídas pelo colaborador nos últimos 90 dias (a trilha), da mais recente */
export async function despesasExcluidas(empresaId: string): Promise<DespesaExcluida[]> {
  const desde = new Date(Date.now() - 90 * 86_400_000);
  const l = await prisma.despesaCampoHistorico.findMany({ where: { empresaId, acao: "EXCLUIDA", criadoEm: { gte: desde } }, orderBy: { criadoEm: "desc" }, take: 100, select: { despesaId: true, tecnicoId: true, criadoEm: true, detalhes: true } });
  const tecs = [...new Set(l.map((x) => x.tecnicoId))];
  const nomes = new Map((tecs.length ? await prisma.tecnico.findMany({ where: { id: { in: tecs }, empresaId }, select: { id: true, nome: true } }) : []).map((t) => [t.id, t.nome]));
  return l.map((x) => ({ id: x.despesaId, colaborador: nomes.get(x.tecnicoId) ?? "Colaborador", em: x.criadoEm.toISOString(), detalhes: x.detalhes }));
}

async function mapaDaEmpresa(empresaId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<MapaCategorias> {
  const c = await db.configuracao.findUnique({ where: { empresaId }, select: { despesasCampoCategorias: true } });
  return lerMapa(c?.despesasCampoCategorias);
}

/** Aprova. Do próprio bolso: cria a conta a pagar de reembolso ao colaborador (uma só, mesmo com dois cliques). */
export async function aprovarDespesa(empresaId: string, id: string, usuarioId: string, op: { vencimento?: string; categoriaId?: string } = {}): Promise<Resultado<{ contaPagarId: string | null }>> {
  const d = await prisma.despesaCampo.findFirst({
    where: { id, empresaId },
    select: { id: true, status: true, pagamento: true, categoria: true, valor: true, data: true, descricao: true, tecnicoId: true, usuarioId: true, tecnico: { select: { nome: true } }, ordemServico: { select: { numero: true, chamadoNumero: true } } },
  });
  if (!d) return erro(404, "Despesa não encontrada.");
  if (d.status !== "PENDENTE") return erro(409, MSG_JA_DECIDIDA);
  const doBolso = d.pagamento === "PROPRIO";
  if (doBolso && !op.vencimento) return erro(400, "Informe o vencimento do reembolso.");
  // Push "Despesa aprovada" para quem lançou, depois da resposta (relê a situação: transação desfeita não avisa)
  agendarPush(() => notificarDespesa({
    empresaId, despesaId: id, situacao: "APROVADA", autorUsuarioId: d.usuarioId,
    descricao: d.descricao || NOME_CATEGORIA[d.categoria as CategoriaDespesa], valor: Number(d.valor), url: URL_DESPESAS_APP,
  }));
  return prisma.$transaction(async (tx): Promise<Resultado<{ contaPagarId: string | null }>> => {
    // Trava: só a primeira aprovação passa (dois cliques ou duas pessoas ao mesmo tempo não geram duas contas)
    const { count } = await tx.despesaCampo.updateMany({ where: { id, empresaId, status: "PENDENTE" }, data: { status: "APROVADA", decididoPorId: usuarioId, decididoEm: new Date() } });
    if (!count) return erro(409, MSG_JA_DECIDIDA);
    // D7: o colaborador pode ter corrigido entre a tela e o clique — a conta usa o que está gravado AGORA (a linha já
    // está travada pela aprovação: nenhuma correção entra depois daqui)
    const agora = await tx.despesaCampo.findUniqueOrThrow({ where: { id }, select: { pagamento: true, categoria: true, valor: true, data: true, descricao: true } });
    Object.assign(d, agora);
    if (agora.pagamento === "PROPRIO" && !op.vencimento) throw new ErroCorrigidaNaHora();
    if (agora.pagamento !== "PROPRIO") return { ok: true as const, status: 200, dados: { contaPagarId: null } };
    const categoria = d.categoria as CategoriaDespesa;
    const ativas = await tx.categoriaFinanceira.findMany({ where: { empresaId, ativo: true }, select: { id: true, nome: true } });
    let categoriaId = categoriaFinanceiraDe(categoria, { escolhida: op.categoriaId, mapa: await mapaDaEmpresa(empresaId, tx), ativas });
    // Nenhuma ligada nem de mesmo nome: cria a de mesmo nome (o padrão que a empresa pode trocar depois)
    if (!categoriaId) categoriaId = (await tx.categoriaFinanceira.create({ data: { empresaId, nome: NOME_CATEGORIA[categoria] }, select: { id: true } })).id;
    const numero = await proximoNumeroContaPagar(empresaId, tx);
    const conta = await tx.contaPagar.create({
      data: {
        empresaId, numero, fornecedor: d.tecnico.nome, tecnicoId: d.tecnicoId,
        descricao: descricaoReembolso({ categoria, data: chaveDiaCivil(d.data), osNumero: d.ordemServico ? d.ordemServico.chamadoNumero ?? d.ordemServico.numero : null, descricao: d.descricao }),
        valorTotal: d.valor, valorPago: 0, saldoRestante: d.valor, status: "PENDENTE", dataVencimento: diaCivilDeChave(op.vencimento!), categoriaId,
      },
      select: { id: true },
    });
    await tx.despesaCampo.update({ where: { id }, data: { contaPagarId: conta.id } });
    return { ok: true as const, status: 200, dados: { contaPagarId: conta.id } };
  }).catch((e) => { if (e instanceof ErroCorrigidaNaHora) return erro(409, MSG_CORRIGIDA_NA_HORA); throw e; });
}

/** D7 — a despesa virou "do bolso" por uma correção do colaborador entre a tela e o clique (a aprovação é desfeita) */
class ErroCorrigidaNaHora extends Error {}
export const MSG_CORRIGIDA_NA_HORA = "O colaborador acabou de corrigir esta despesa (agora é do bolso dele). Confira e aprove de novo, com o vencimento do reembolso.";

export async function recusarDespesa(empresaId: string, id: string, usuarioId: string, motivo: string): Promise<Resultado<{ recusada: true }>> {
  const d = await prisma.despesaCampo.findFirst({ where: { id, empresaId }, select: { status: true, usuarioId: true, categoria: true, descricao: true, valor: true } });
  if (!d) return erro(404, "Despesa não encontrada.");
  const { count } = await prisma.despesaCampo.updateMany({ where: { id, empresaId, status: "PENDENTE" }, data: { status: "RECUSADA", motivoRecusa: motivo.trim(), decididoPorId: usuarioId, decididoEm: new Date() } });
  if (!count) return erro(409, MSG_JA_DECIDIDA);
  // Push "Despesa recusada" (com o motivo) para quem lançou, depois da resposta
  agendarPush(() => notificarDespesa({
    empresaId, despesaId: id, situacao: "RECUSADA", autorUsuarioId: d.usuarioId, motivo: motivo.trim(),
    descricao: d.descricao || NOME_CATEGORIA[d.categoria as CategoriaDespesa], valor: Number(d.valor), url: URL_DESPESAS_APP,
  }));
  return { ok: true, status: 200, dados: { recusada: true } };
}

/** O mapa de categorias como a tela mostra: a ligada (ou a de mesmo nome) de cada categoria fixa. */
export async function categoriasParaTela(empresaId: string) {
  const [mapa, ativas] = await Promise.all([mapaDaEmpresa(empresaId), prisma.categoriaFinanceira.findMany({ where: { empresaId, ativo: true }, orderBy: { nome: "asc" }, select: { id: true, nome: true } })]);
  return { mapa, ativas, efetivas: Object.fromEntries(Object.keys(NOME_CATEGORIA).map((c) => [c, categoriaFinanceiraDe(c as CategoriaDespesa, { mapa, ativas })])) as Record<CategoriaDespesa, string | null> };
}

export async function salvarMapa(empresaId: string, mapa: MapaCategorias): Promise<Resultado<{ mapa: MapaCategorias }>> {
  const ids = [...new Set(Object.values(mapa))];
  const validas = await prisma.categoriaFinanceira.count({ where: { empresaId, id: { in: ids } } });
  if (validas !== ids.length) return erro(400, "Categoria financeira inválida.");
  await prisma.configuracao.upsert({ where: { empresaId }, create: { empresaId, despesasCampoCategorias: mapa }, update: { despesasCampoCategorias: mapa } });
  return { ok: true, status: 200, dados: { mapa } };
}

export const contarDespesasPendentes = (empresaId: string) => prisma.despesaCampo.count({ where: { empresaId, status: "PENDENTE" } });
