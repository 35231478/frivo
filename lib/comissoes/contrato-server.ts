/**
 * COM-1.2 — COMISSÃO SOBRE CONTRATO no servidor: gerar (quando o contrato é fechado ou, se a empresa quiser, renovado),
 * sincronizar (liberar e estornar pelo que entrou de cada mensalidade) e trocar o vendedor do contrato. Por empresa.
 *
 * Como a COM-1, a liberação é RECALCULADA a partir do estado real (o que entrou de cada mensalidade, o status do
 * contrato) sempre que alguém olha — o fechamento do mês e o extrato —, criando só a diferença.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cobrancaDoContrato } from "@/lib/faturamento/medicao-contrato-server";
import { passoCobranca } from "@/lib/financeiro/contrato-previsao";
import { descricaoDaRegra, entradasDaFatura, movimentoNecessario, round2, type RegraComissao } from "./regras";
import {
  ITEM_FIXO, MOTIVO_ESTORNO_MENSALIDADE, MOTIVO_MENSALIDADE, MOTIVO_TROCA_CONTRATO, alvoDaParte, chaveDoContrato, competencia, competenciaDe,
  competenciasDaJanela, descricaoDaParte, ehFechamento, ehRenovacao, inicioDoCiclo, lerCompetencia, mensalidadeCoberta, mesesDaRegra, naJanela,
  regraDoContrato, valorDaMensalidade, type BaseContrato,
} from "./contrato";
import { PAPEL_SUBSTITUIDO, colaboradorDoUsuario, msgComissaoPaga, recebidoDasMedicoes, regrasAtivas, MSG_VENDEDOR_INVALIDO } from "./servidor";

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const valendo = { papel: { not: PAPEL_SUBSTITUIDO } } as const;

const travarEmpresa = (tx: Tx, empresaId: string) => tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`comissoes:${empresaId}`}))`;

/* ───────── a mensalidade: quanto vale e quanto já entrou ───────── */

export interface Mensalidade {
  /** O valor da mensalidade (a parte do contrato na fatura dela; sem fatura, o da previsão ou o valor mensal) */
  valor: number;
  /** O que já entrou dela (recebimentos não estornados, na proporção do que é do contrato na fatura) */
  recebido: number;
  /** A data da última entrada (o dia que conta para o fechamento do mês) */
  ultimaData: Date | null;
  /** Existe cobrança (fatura viva ou previsão) desta mensalidade */
  cobrada: boolean;
}

/**
 * A mensalidade do contrato na competência: a fatura (medição) viva que a cobra e, nela, a parte do contrato (o valor
 * da previsão sobre o total da fatura: a fatura única do cliente e os adicionais consolidados não contam); o que entrou
 * dela. Fatura cancelada some (a mensalidade volta a zero: estorna). Sem fatura, a previsão recebida direto também vale.
 */
export async function mensalidadeDoContrato(db: Db, empresaId: string, contrato: { id: string; valorMensal: unknown }, comp: string): Promise<Mensalidade> {
  const { ano, mes } = lerCompetencia(comp);
  const [cobranca, previsao] = await Promise.all([
    cobrancaDoContrato(db, contrato.id, ano, mes),
    db.contaReceber.findFirst({
      where: { empresaId, contratoId: contrato.id, refAno: ano, refMes: mes },
      select: { valor: true, status: true, medicaoId: true, excluidaEm: true, dataRecebimento: true, recebimentos: { where: { estornadoEm: null }, select: { valor: true, data: true } } },
    }),
  ]);
  const doContrato = previsao ? num(previsao.valor) : num(contrato.valorMensal);
  if (cobranca) {
    const med = await db.medicao.findFirst({ where: { id: cobranca.id, empresaId }, select: { id: true, valorTotal: true, valorLiquido: true } });
    if (!med) return { valor: doContrato, recebido: 0, ultimaData: null, cobrada: false };
    const total = num(med.valorTotal);
    const parte = total > 0 && doContrato > 0 ? Math.min(1, doContrato / total) : 1;
    const { porMed, brutas } = await recebidoDasMedicoes(db, empresaId, [med.id]);
    const r = porMed.get(med.id) ?? { aCobrar: 0, recebido: 0 };
    const f = { daVenda: round2(num(med.valorLiquido) * parte), aCobrar: round2(r.aCobrar), recebido: round2(r.recebido) };
    const entradas = entradasDaFatura(f, brutas.get(med.id) ?? []);
    return { valor: f.daVenda, recebido: round2(entradas.reduce((s, e) => s + e.valor, 0)), ultimaData: entradas[entradas.length - 1]?.data ?? null, cobrada: true };
  }
  // Sem fatura viva: a previsão recebida direto (sem medição) vale; cancelada/excluída, nada
  if (previsao && !previsao.medicaoId && !previsao.excluidaEm && previsao.status !== "CANCELADO") {
    const entradas = previsao.recebimentos.map((x) => ({ data: x.data, valor: num(x.valor) }));
    if (previsao.status === "RECEBIDO" && !entradas.length && previsao.dataRecebimento) entradas.push({ data: previsao.dataRecebimento, valor: num(previsao.valor) });
    entradas.sort((a, b) => a.data.getTime() - b.data.getTime());
    const recebido = Math.min(num(previsao.valor), entradas.reduce((s, e) => s + e.valor, 0));
    return { valor: num(previsao.valor), recebido: round2(recebido), ultimaData: entradas[entradas.length - 1]?.data ?? null, cobrada: true };
  }
  return { valor: doContrato, recebido: 0, ultimaData: null, cobrada: false };
}

/** As competências que o contrato já cobra (previsões e faturas mensais) — a janela "enquanto ativo" cresce por elas */
async function competenciasCobradas(db: Db, empresaId: string, contratoId: string): Promise<string[]> {
  const [prev, meds] = await Promise.all([
    db.contaReceber.findMany({ where: { empresaId, contratoId, refAno: { not: null }, refMes: { not: null }, status: { not: "CANCELADO" }, excluidaEm: null }, select: { refAno: true, refMes: true } }),
    db.medicao.findMany({ where: { empresaId, contratoId, tipo: { in: ["MENSAL_FIXO", "FATURA_UNICA"] }, status: { not: "CANCELADA" }, ano: { not: null }, mes: { not: null } }, select: { ano: true, mes: true } }),
  ]);
  return [...new Set([...prev.map((p) => competencia(p.refAno!, p.refMes!)), ...meds.map((m) => competencia(m.ano!, m.mes!))])].sort();
}

/** O mês em que o contrato saiu de ATIVO pela última vez (null = está ativo; sem histórico, o mês da última mudança) */
async function paradoDesde(db: Db, c: { id: string; status: string; atualizadoEm: Date }): Promise<string | null> {
  if (c.status === "ATIVO") return null;
  const saida = await db.contratoHistoricoStatus.findFirst({
    where: { contratoId: c.id, statusAnterior: "ATIVO", statusNovo: { not: "ATIVO" } }, orderBy: { createdAt: "desc" }, select: { createdAt: true },
  });
  return competenciaDe(saida?.createdAt ?? c.atualizadoEm);
}

/* ───────── gerar ───────── */

const SELECT_CONTRATO = {
  id: true, status: true, tipo: true, vendedorId: true, dataInicio: true, dataFim: true, periodicidade: true, valorMensal: true, atualizadoEm: true,
} as const;

/**
 * GERA as comissões do contrato para o vendedor dele, no ciclo que começa agora (fechamento) ou na renovação: uma por
 * mensalidade da janela ("% das mensalidades recebidas"; na janela "enquanto ativo", as que o contrato já cobra) e uma
 * do "valor fixo no fechamento". Congela a regra (taxa, janela, descrição). Idempotente pela chave (contrato × ciclo ×
 * parte × pessoa). Sem vendedor (contrato de antes da COM-1.2), sem regra de contrato ou fora de ATIVO, não gera nada.
 */
export async function gerarComissoesDoContrato(
  empresaId: string, contratoId: string,
  /** `manterParado` (troca de vendedor): gera mesmo com o contrato fora de ATIVO — o que entrou antes de ele parar continua devido */
  o: { renovacao?: boolean; agora?: Date; tx?: Tx; cicloInicio?: string; manterParado?: boolean } = {},
): Promise<number> {
  const agora = o.agora ?? new Date();
  const db: Db = o.tx ?? prisma;
  const c = await db.contrato.findFirst({ where: { id: contratoId, empresaId }, select: SELECT_CONTRATO });
  if (!c || (c.status !== "ATIVO" && !o.manterParado) || !c.vendedorId) return 0;
  const regras = (await regrasAtivas(empresaId, db)).filter((r) => r.sobreTipo === "CONTRATOS");
  if (!regras.length) return 0;
  const pessoa = await colaboradorDoUsuario(empresaId, c.vendedorId, db);
  if (!pessoa) return 0;
  const benef = { usuarioId: pessoa.usuarioId, cargoId: pessoa.cargoId };
  const perc = regraDoContrato(regras, benef, c.tipo, "PERC_MENSALIDADE");
  const fixo = regraDoContrato(regras, benef, c.tipo, "FIXO_CONTRATO");
  if (!perc && !fixo) return 0;
  const cicloInicio = o.cicloInicio ?? inicioDoCiclo({ renovacao: !!o.renovacao, dataInicio: c.dataInicio, agora });
  const nomes = await nomesDasRegras(db, empresaId, [perc, fixo]);

  const linhas: Prisma.ComissaoCreateManyInput[] = [];
  const base = (r: RegraComissao) => ({
    empresaId, contratoId: c.id, cicloInicio, usuarioId: pessoa.usuarioId, beneficiarioNome: pessoa.nome, papel: "VENDEDOR", quantidade: 1,
    regraId: r.id, regraDescricao: descricaoDaRegra(r, nomes(r)), base: r.base, taxa: r.valor, quando: "RECEBIMENTO", liquidaImpostos: false, criadoEm: agora,
  });
  if (perc) {
    const meses = mesesDaRegra(perc);
    const janela = competenciasDaJanela({ cicloInicio, meses, passo: passoCobranca(c.periodicidade), ultimaVigente: c.dataFim ? competenciaDe(c.dataFim) : null })
      ?? (await competenciasCobradas(db, empresaId, c.id)).filter((x) => naJanela(x, cicloInicio, 0));
    for (const comp of janela) {
      const m = await mensalidadeDoContrato(db, empresaId, c, comp);
      linhas.push({
        ...base(perc), meses, competencia: comp, chave: chaveDoContrato(c.id, cicloInicio, comp, pessoa.usuarioId),
        itemTipo: "MENSALIDADE", itemId: comp, descricao: descricaoDaParte(comp), baseValor: m.valor, valor: valorDaMensalidade(perc.valor, m.valor),
      });
    }
  }
  if (fixo) {
    linhas.push({
      ...base(fixo), meses: null, competencia: cicloInicio, chave: chaveDoContrato(c.id, cicloInicio, ITEM_FIXO, pessoa.usuarioId),
      itemTipo: "FIXO", itemId: ITEM_FIXO, descricao: descricaoDaParte(ITEM_FIXO, !!o.renovacao), baseValor: 0, valor: round2(fixo.valor),
    });
  }
  if (!linhas.length) return 0;
  const gravar = async (tx: Tx) => {
    await tx.$queryRaw`SELECT 1 AS ok FROM pg_advisory_xact_lock(hashtext(${`comissao-ct:${contratoId}`}))`;
    return (await tx.comissao.createMany({ data: linhas, skipDuplicates: true })).count;
  };
  if (o.tx) {
    const n = await gravar(o.tx);
    if (n) await sincronizarContratosNaTransacao(o.tx, empresaId, { contratoIds: [contratoId] }, agora);
    return n;
  }
  const n = await prisma.$transaction(gravar);
  if (n) await sincronizarContratos(empresaId, { contratoIds: [contratoId] }, agora);
  return n;
}

/** Os nomes (pessoa, cargo) de cada regra, para a descrição congelada */
async function nomesDasRegras(db: Db, empresaId: string, regras: (RegraComissao | null)[]) {
  const rs = regras.filter(Boolean) as RegraComissao[];
  const [us, cs] = await Promise.all([
    db.usuario.findMany({ where: { empresaId, id: { in: rs.map((r) => r.usuarioId).filter(Boolean) as string[] } }, select: { id: true, nome: true } }),
    db.cargo.findMany({ where: { empresaId, id: { in: rs.map((r) => r.cargoId).filter(Boolean) as string[] } }, select: { id: true, nome: true } }),
  ]);
  return (r: RegraComissao) => ({ pessoa: us.find((u) => u.id === r.usuarioId)?.nome ?? null, cargo: cs.find((x) => x.id === r.cargoId)?.nome ?? null });
}

/* ───────── sincronizar: liberar e estornar ───────── */

export async function sincronizarContratos(empresaId: string, filtro: { contratoIds?: string[]; usuarioId?: string } = {}, agora: Date = new Date()): Promise<number> {
  return prisma.$transaction((tx) => sincronizarContratosNaTransacao(tx, empresaId, filtro, agora), { timeout: 60_000 });
}

/**
 * Leva cada comissão de contrato ao ALVO: a taxa sobre o que entrou da mensalidade (o fixo, a fração da 1ª mensalidade
 * do ciclo), só nas mensalidades que ainda contam (contrato parado não gera mais nada; estornar, estorna). Na janela
 * "enquanto ativo", as mensalidades novas que o contrato passou a cobrar ganham a sua comissão. Enquanto nada foi
 * liberado, o valor previsto acompanha a mensalidade (reajuste) e zera se o contrato parou antes dela.
 */
export async function sincronizarContratosNaTransacao(tx: Tx, empresaId: string, filtro: { contratoIds?: string[]; usuarioId?: string }, agora: Date): Promise<number> {
  await travarEmpresa(tx, empresaId);
  const where = { empresaId, contratoId: filtro.contratoIds ? { in: filtro.contratoIds } : { not: null }, ...(filtro.usuarioId ? { usuarioId: filtro.usuarioId } : {}) };
  const select = {
    id: true, contratoId: true, usuarioId: true, beneficiarioNome: true, papel: true, base: true, taxa: true, valor: true, competencia: true, cicloInicio: true, meses: true,
    regraId: true, regraDescricao: true, criadoEm: true, lancamentos: { select: { valor: true } },
  } as const;
  let comissoes = await tx.comissao.findMany({ where, select });
  if (!comissoes.length) return 0;
  const contratos = await tx.contrato.findMany({ where: { id: { in: [...new Set(comissoes.map((c) => c.contratoId!))] }, empresaId }, select: SELECT_CONTRATO });

  // A janela "enquanto ativo" cresce com as mensalidades que o contrato passa a cobrar (só com o contrato ativo)
  const novas: Prisma.ComissaoCreateManyInput[] = [];
  for (const ct of contratos) {
    if (ct.status !== "ATIVO") continue;
    const abertas = comissoes.filter((c) => c.contratoId === ct.id && c.base === "PERC_MENSALIDADE" && c.meses === 0 && c.papel !== PAPEL_SUBSTITUIDO);
    if (!abertas.length) continue;
    const cobradas = await competenciasCobradas(tx, empresaId, ct.id);
    const porCiclo = new Map<string, typeof abertas>();
    abertas.forEach((c) => porCiclo.set(`${c.cicloInicio}|${c.usuarioId}`, [...(porCiclo.get(`${c.cicloInicio}|${c.usuarioId}`) ?? []), c]));
    for (const grupo of porCiclo.values()) {
      const modelo = grupo[0];
      const tem = new Set(grupo.map((c) => c.competencia));
      for (const comp of cobradas.filter((x) => naJanela(x, modelo.cicloInicio!, 0) && !tem.has(x))) {
        const m = await mensalidadeDoContrato(tx, empresaId, ct, comp);
        novas.push({
          empresaId, contratoId: ct.id, competencia: comp, cicloInicio: modelo.cicloInicio, meses: 0, usuarioId: modelo.usuarioId, beneficiarioNome: modelo.beneficiarioNome,
          papel: "VENDEDOR", itemTipo: "MENSALIDADE", itemId: comp, descricao: descricaoDaParte(comp), quantidade: 1, regraId: modelo.regraId, regraDescricao: modelo.regraDescricao,
          base: "PERC_MENSALIDADE", baseValor: m.valor, taxa: modelo.taxa, valor: valorDaMensalidade(num(modelo.taxa), m.valor), quando: "RECEBIMENTO", liquidaImpostos: false,
          chave: chaveDoContrato(ct.id, modelo.cicloInicio!, comp, modelo.usuarioId!), criadoEm: agora,
        });
      }
    }
  }
  if (novas.length) {
    await tx.comissao.createMany({ data: novas, skipDuplicates: true });
    comissoes = await tx.comissao.findMany({ where, select });
  }

  const lancamentos: Prisma.ComissaoLancamentoCreateManyInput[] = [];
  for (const ct of contratos) {
    const parado = await paradoDesde(tx, ct);
    const estado = { ativo: ct.status === "ATIVO", paradoDesde: parado };
    const cache = new Map<string, Mensalidade>();
    const mensalidade = async (comp: string) => {
      if (!cache.has(comp)) cache.set(comp, await mensalidadeDoContrato(tx, empresaId, ct, comp));
      return cache.get(comp)!;
    };
    const cobradas = await competenciasCobradas(tx, empresaId, ct.id);
    for (const c of comissoes.filter((x) => x.contratoId === ct.id)) {
      const base = c.base as BaseContrato;
      // O fixo segue a 1ª mensalidade cobrada do ciclo (sem nenhuma ainda, a do 1º mês)
      const comp = base === "FIXO_CONTRATO" ? (cobradas.find((x) => x >= c.cicloInicio!) ?? c.cicloInicio!) : c.competencia!;
      const m = await mensalidade(comp);
      const coberta = mensalidadeCoberta(comp, estado);
      const ja = round2(c.lancamentos.reduce((s, l) => s + num(l.valor), 0));
      const substituida = c.papel === PAPEL_SUBSTITUIDO;
      // Nada liberado ainda: o previsto acompanha a mensalidade (reajuste) e zera se o contrato parou antes dela
      if (!substituida && !c.lancamentos.length && base === "PERC_MENSALIDADE") {
        const previsto = coberta ? valorDaMensalidade(num(c.taxa), m.valor) : 0;
        if (Math.abs(previsto - num(c.valor)) >= 0.01) await tx.comissao.update({ where: { id: c.id }, data: { valor: previsto, baseValor: m.valor } });
      }
      const alvo = substituida ? 0 : alvoDaParte({ base, taxa: num(c.taxa), valor: num(c.valor), recebido: m.recebido, mensalidade: m.valor, coberta, jaLiberado: ja });
      const mov = movimentoNecessario(alvo, ja);
      if (!mov) continue;
      lancamentos.push({
        empresaId, comissaoId: c.id, usuarioId: c.usuarioId, tipo: mov.tipo, valor: mov.valor,
        data: mov.tipo === "ESTORNO" ? agora : m.ultimaData ?? agora,
        motivo: substituida ? MOTIVO_TROCA_CONTRATO : mov.tipo === "ESTORNO" ? MOTIVO_ESTORNO_MENSALIDADE : MOTIVO_MENSALIDADE,
      });
    }
  }
  if (lancamentos.length) await tx.comissaoLancamento.createMany({ data: lancamentos });
  return lancamentos.length + novas.length;
}

/* ───────── os gatilhos: criar, mudar o status ───────── */

/**
 * Chamado depois de o contrato ser criado ou de o status mudar: FECHAMENTO (criado ativo, proposta convertida ou saiu
 * de "Aguardando assinatura") gera; RENOVAÇÃO (voltou de "Em renovação"/"Vencido") gera só com "Renovação também gera";
 * qualquer outra mudança só recalcula (parar/reativar). Nunca derruba o contrato: se falhar, fica no log.
 */
export async function comissoesDoContratoNoStatus(empresaId: string, contratoId: string, anterior: string | null, novo: string, agora: Date = new Date()): Promise<void> {
  try {
    const criado = anterior === null;
    if ((criado && novo === "ATIVO") || ehFechamento(anterior, novo)) {
      await gerarComissoesDoContrato(empresaId, contratoId, { agora });
      return;
    }
    if (ehRenovacao(anterior, novo)) {
      const cfg = await prisma.configuracao.findUnique({ where: { empresaId }, select: { comissaoRenovacaoGera: true } });
      if (cfg?.comissaoRenovacaoGera) await gerarComissoesDoContrato(empresaId, contratoId, { renovacao: true, agora });
    }
    if (await prisma.comissao.count({ where: { empresaId, contratoId } })) await sincronizarContratos(empresaId, { contratoIds: [contratoId] }, agora);
  } catch (e) {
    console.error("[comissoes] falha na comissão do contrato", contratoId, e);
  }
}

/* ───────── trocar o vendedor do contrato ───────── */

export const MSG_MESMO_VENDEDOR_CONTRATO = "Este já é o vendedor do contrato.";

/**
 * TROCA o vendedor do contrato (só quem tem "Trocar vendedor": a rota confere), com o motivo no histórico do contrato.
 * Como no orçamento (COM-1.1), na MESMA TRANSAÇÃO: o que foi liberado para o antigo é ESTORNADO, a comissão dele fica
 * "substituída" (histórico) e o novo ganha a dele nos mesmos ciclos (regras de hoje). Algo já pago (fechamento
 * FECHADO) recusa a troca. Contrato sem comissão (de antes da COM-1.2, por exemplo) só troca o vendedor.
 */
export async function trocarVendedorDoContrato(o: { empresaId: string; contratoId: string; vendedorId: string; motivo: string; quem: { id: string; nome: string } }):
  Promise<{ ok: true; vendedor: { id: string; nome: string } } | { ok: false; status: number; erro: string }> {
  const ct = await prisma.contrato.findFirst({ where: { id: o.contratoId, empresaId: o.empresaId }, select: { id: true, status: true, vendedorId: true, vendedor: { select: { nome: true } } } });
  if (!ct) return { ok: false, status: 404, erro: "Contrato não encontrado" };
  const novo = await prisma.usuario.findFirst({ where: { id: o.vendedorId, empresaId: o.empresaId, ativo: true }, select: { id: true, nome: true } });
  if (!novo) return { ok: false, status: 400, erro: MSG_VENDEDOR_INVALIDO };
  if (ct.vendedorId === novo.id) return { ok: false, status: 400, erro: MSG_MESMO_VENDEDOR_CONTRATO };
  const recusa = await prisma.$transaction(async (tx) => {
    await travarEmpresa(tx, o.empresaId);
    const pago = await tx.comissaoLancamento.findFirst({
      where: { empresaId: o.empresaId, comissao: { contratoId: ct.id, ...valendo }, fechamento: { situacao: "FECHADO" } },
      select: { fechamento: { select: { competencia: true } } },
    });
    if (pago?.fechamento) return msgComissaoPaga(pago.fechamento.competencia).replace("desta venda", "deste contrato");
    await tx.contrato.update({ where: { id: ct.id }, data: { vendedorId: novo.id } });
    // A trilha: o histórico do contrato (mesmo status antes e depois — a tela mostra como "Vendedor trocado")
    await tx.contratoHistoricoStatus.create({
      data: {
        empresaId: o.empresaId, contratoId: ct.id, statusAnterior: ct.status, statusNovo: ct.status, usuarioId: o.quem.id,
        motivo: `Vendedor: ${ct.vendedor?.nome ?? "sem vendedor"} → ${novo.nome}. Motivo: ${o.motivo.trim()}`.slice(0, 500),
      },
    });
    const antigas = await tx.comissao.findMany({ where: { empresaId: o.empresaId, contratoId: ct.id, ...valendo }, select: { id: true, usuarioId: true, cicloInicio: true, lancamentos: { select: { valor: true } } } });
    if (!antigas.length) return null;
    const agora = new Date();
    const comMovimento = antigas.filter((c) => c.lancamentos.length);
    await tx.comissao.deleteMany({ where: { id: { in: antigas.filter((c) => !c.lancamentos.length).map((c) => c.id) } } });
    const estornos = comMovimento
      .map((c) => ({ c, saldo: round2(c.lancamentos.reduce((s, l) => s + num(l.valor), 0)) }))
      .filter((x) => Math.abs(x.saldo) >= 0.01)
      .map((x) => ({ empresaId: o.empresaId, comissaoId: x.c.id, usuarioId: x.c.usuarioId, tipo: x.saldo > 0 ? "ESTORNO" : "LIBERACAO", valor: -x.saldo, data: agora, motivo: MOTIVO_TROCA_CONTRATO }));
    if (estornos.length) await tx.comissaoLancamento.createMany({ data: estornos });
    // A chave guarda a pessoa: a substituída sai da chave (null), para o novo poder ter a dele no mesmo ciclo
    if (comMovimento.length) await tx.comissao.updateMany({ where: { id: { in: comMovimento.map((c) => c.id) } }, data: { papel: PAPEL_SUBSTITUIDO, chave: null } });
    // O novo ganha a dele nos mesmos ciclos (contrato parado também: o que entrou antes de parar continua devido)
    for (const ciclo of [...new Set(antigas.map((c) => c.cicloInicio).filter(Boolean) as string[])]) {
      await gerarComissoesDoContrato(o.empresaId, ct.id, { tx, agora, cicloInicio: ciclo, manterParado: true });
    }
    return null;
  }, { timeout: 60_000 });
  if (recusa) return { ok: false, status: 409, erro: recusa };
  return { ok: true, vendedor: novo };
}
