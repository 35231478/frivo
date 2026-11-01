/**
 * Rotina diária de faturamento automático dos contratos: medição → aprovação (PR3-A) → NFS-e → boleto
 * com o e-mail ao cliente (PR3-B).
 * Uma EXECUÇÃO por contrato × competência (único no banco) guarda a etapa, a situação, o erro e as
 * tentativas; a rodada seguinte retoma de onde parou. Travas:
 * - execução única por competência (createMany skipDuplicates sobre o índice único);
 * - "posse" da execução (processando_ate): duas rodadas ao mesmo tempo não processam a mesma;
 * - a medição sai pelo núcleo único (contrato trancado + competência conferida lá dentro);
 * - a NFS-e sai pela emissão de sempre (medição trancada; nota viva não deixa sair outra);
 * - o boleto sai pelo núcleo da conta (conta trancada; conta com boleto ou que não pode receber fica de fora).
 */
import { prisma } from "@/lib/prisma";
import { partesBR } from "@/lib/fuso";
import { enviarBoleto, enviarMedicao } from "@/lib/email";
import { cobrancaDoContrato, gerarMedicaoDeContratos } from "@/lib/faturamento/medicao-contrato-server";
import { aprovarMedicao, marcarEnviada } from "@/lib/faturamento/aprovar-medicao-server";
import {
  aposFalha, competenciaDevida, emailDesligado, etapaAposAprovacao, etapaAposNf, LEASE_MS, medicaoComNf, medicaoJaAprovada,
  mensagemDeErro, textoPendenciaNfse,
} from "@/lib/faturamento/rotina-contratos";
import { emitirNotas, ErroEmissao, previaEmissao } from "@/lib/nfse/emissao-server";
import { statusVivo } from "@/lib/nfse/nota";
import { emitirBoletoDaConta, ErroBoleto, motivoSemBoleto } from "@/lib/financeiro/boleto-server";
import { cobrancasDaMedicao } from "@/lib/financeiro/parcelas-server";

const ABERTAS = ["PENDENTE", "AGUARDANDO", "PENDENCIA"] as const;
const execucaoCompleta = { contrato: { include: { cliente: true } }, medicao: { select: { id: true, numero: true, status: true } } } as const;

type Execucao = NonNullable<Awaited<ReturnType<typeof carregar>>>;
const carregar = (id: string) => prisma.faturamentoContratoExecucao.findUnique({ where: { id }, include: execucaoCompleta });

async function gravar(id: string, data: Parameters<typeof prisma.faturamentoContratoExecucao.update>[0]["data"]) {
  await prisma.faturamentoContratoExecucao.update({ where: { id }, data });
}
/** Fim da linha: CONCLUIDA (etapa também) ou CANCELADA (com o motivo) */
const encerrar = (id: string, situacao: "CONCLUIDA" | "CANCELADA", erro: string | null = null) =>
  gravar(id, { situacao, erro, proximaTentativa: null, concluidaEm: new Date(), ...(situacao === "CONCLUIDA" ? { etapa: "CONCLUIDA" } : {}) });

/** Um passo da máquina. true = avançou e dá para seguir na mesma rodada */
async function avancar(ex: Execucao): Promise<boolean> {
  const ct = ex.contrato;
  const { refAno: ano, refMes: mes } = ex;

  if (ex.etapa === "MEDICAO") {
    const ja = await cobrancaDoContrato(prisma, ct.id, ano, mes);
    let medicaoId: string;
    if (ja) {
      // Alguém já cobrou à mão: a medição só deste contrato a rotina adota; a consolidada com outros contratos, não
      if (ja.contratoId !== ct.id) {
        await encerrar(ex.id, "CANCELADA", `Cobrado à mão na medição ${ja.numero}, junto com outros contratos do cliente.`);
        return false;
      }
      medicaoId = ja.id;
    } else {
      if (ct.status !== "ATIVO" || !ct.faturamentoAutomatico) {
        await encerrar(ex.id, "CANCELADA", ct.status !== "ATIVO" ? `O contrato não está ativo (${ct.status}).` : "O faturamento automático foi desligado no contrato.");
        return false;
      }
      const r = await gerarMedicaoDeContratos({ empresaId: ct.empresaId, cliente: ct.cliente, contratos: [ct], ano, mes, porContrato: true });
      if (r.status === "sem-itens") { await encerrar(ex.id, "CANCELADA", "O contrato está sem valor de cobrança."); return false; }
      if (r.status === "item-faturado") throw new Error("Uma OS do contrato entrou em outra medição enquanto esta era montada.");
      if (r.status === "ja-cobrado" && r.medicao.contratoId !== ct.id) {
        await encerrar(ex.id, "CANCELADA", `Cobrado à mão na medição ${r.medicao.numero}, junto com outros contratos do cliente.`);
        return false;
      }
      medicaoId = r.medicao.id;
    }
    await gravar(ex.id, { medicaoId, etapa: "APROVACAO", situacao: "PENDENTE", tentativas: 0, erro: null, proximaTentativa: null });
    return true;
  }

  if (ex.etapa === "APROVACAO") {
    const m = ex.medicao;
    if (!m || m.status === "CANCELADA") {
      await encerrar(ex.id, "CANCELADA", m ? `A medição ${m.numero} foi cancelada.` : "A medição foi apagada.");
      return false;
    }
    if (medicaoJaAprovada(m.status)) {
      const proxima = etapaAposAprovacao(ct);
      if (proxima === "CONCLUIDA") { await encerrar(ex.id, "CONCLUIDA"); return false; }
      await gravar(ex.id, { etapa: proxima, situacao: "PENDENTE", tentativas: 0, erro: null, proximaTentativa: null });
      return true;
    }
    if (ct.aprovacaoAutomatica) {
      // D4: o contrato aprova sozinho (sem esperar o cliente)
      if (m.status === "RASCUNHO") await marcarEnviada(m.id);
      const r = await aprovarMedicao(m.id);
      if (!r) {
        const agora = await prisma.medicao.findUnique({ where: { id: m.id }, select: { status: true } });
        if (!agora || !medicaoJaAprovada(agora.status)) throw new Error(`A medição ${m.numero} não pôde ser aprovada (está como ${agora?.status ?? "apagada"}).`);
      }
      return true;
    }
    // Aprovação do cliente: envia (D6: por e-mail) e espera; cada rodada confere de novo. Envia de novo
    // quando a execução volta para a fila ("Tentar de novo" na pendência do e-mail, ou medição adotada já enviada à mão)
    if (m.status === "RASCUNHO" || (m.status === "AGUARDANDO_APROVACAO" && ex.situacao === "PENDENTE")) {
      await marcarEnviada(m.id);
      const email = await enviarMedicao(m.id).catch((e) => ({ ok: false, erro: (e as Error)?.message ?? "erro no envio" }));
      await gravar(ex.id, email.ok
        ? { situacao: "AGUARDANDO", erro: null, tentativas: 0, proximaTentativa: null }
        : { situacao: "PENDENCIA", erro: `Enviada para o cliente aprovar, mas o e-mail não saiu: ${email.erro ?? "motivo desconhecido"} Mande o link pela medição.`, tentativas: 0, proximaTentativa: null });
      return false;
    }
    if (ex.situacao === "PENDENTE") await gravar(ex.id, { situacao: "AGUARDANDO", erro: null, tentativas: 0, proximaTentativa: null });
    return false;
  }

  if (ex.etapa === "NFSE") return etapaNfse(ex);
  if (ex.etapa === "BOLETO") return etapaBoleto(ex);
  return false;
}

/** Esperando alguém de fora (a prefeitura, o pedido de compra, a NF feita à mão): sem tentativa, sem sino */
async function aguardar(ex: Execucao) {
  if (ex.situacao !== "AGUARDANDO" || ex.erro) await gravar(ex.id, { situacao: "AGUARDANDO", erro: null, tentativas: 0, proximaTentativa: null });
}
const pendencia = (ex: Execucao, erro: string) => gravar(ex.id, { situacao: "PENDENCIA", erro, tentativas: 0, proximaTentativa: null });
/** Medição cancelada no meio do caminho: encerra com o motivo. true = encerrou */
async function medicaoCancelada(ex: Execucao) {
  const m = ex.medicao;
  if (m && m.status !== "CANCELADA") return false;
  await encerrar(ex.id, "CANCELADA", m ? `A medição ${m.numero} foi cancelada.` : "A medição foi apagada.");
  return true;
}

/**
 * Etapa C — NFS-e (chave "Emitir a NFS-e sozinha"). Emite "pelo sistema" com a empresa do contrato,
 * pelo mesmo caminho da tela (pré-validação, ambiente da empresa: Homologação enquanto a Produção não
 * for liberada). Com pendência não emite: vira pendência com o texto e vai pro sino. Nota viva = não
 * emite outra; espera a prefeitura (o aviso do PlugNotas ou a reconciliação trazem a resposta).
 */
async function etapaNfse(ex: Execucao): Promise<boolean> {
  if (await medicaoCancelada(ex)) return false;
  const m = ex.medicao!;
  const ct = ex.contrato;
  if (medicaoComNf(m.status)) {
    const proxima = etapaAposNf(ct);
    if (proxima === "CONCLUIDA") { await encerrar(ex.id, "CONCLUIDA"); return false; }
    await gravar(ex.id, { etapa: proxima, situacao: "PENDENTE", tentativas: 0, erro: null, proximaTentativa: null });
    return true;
  }
  // Aprovada, mas o cliente exige o pedido de compra antes da NF: espera o PC
  if (m.status === "AGUARDANDO_PC") { await aguardar(ex); return false; }

  const notas = await prisma.notaFiscal.findMany({ where: { medicaoId: m.id }, select: { status: true, motivo: true }, orderBy: { criadoEm: "desc" } });
  if (notas.some((n) => statusVivo(n.status) && n.status !== "CONCLUIDO")) { await aguardar(ex); return false; }
  const recusada = notas.find((n) => n.status === "REJEITADO" || n.status === "INTERROMPIDO");
  // Não aceita: não insiste sozinha (sairia recusada de novo); emite outra no "Tentar de novo", depois de corrigir
  if (recusada && ex.situacao !== "PENDENTE") {
    await pendencia(ex, `A prefeitura não aceitou a NFS-e: ${recusada.motivo ?? "sem motivo informado"}. Corrija e use "Tentar de novo".`);
    return false;
  }
  const previa = await previaEmissao(ct.empresaId, m.id);
  if (previa.pendencias.length) { await pendencia(ex, textoPendenciaNfse(previa.pendencias)); return false; }
  if (!previa.grupos.length) {
    await pendencia(ex, `Nada a emitir na NFS-e da medição ${m.numero}: confira os serviços (e o valor) dos itens.`);
    return false;
  }
  try {
    await emitirNotas({ id: null, empresaId: ct.empresaId }, m.id, { origem: "MEDICAO" });
  } catch (e) {
    if (!(e instanceof ErroEmissao)) throw e;
    if (e.pendencias?.length) { await pendencia(ex, textoPendenciaNfse(e.pendencias)); return false; }
    // Outra emissão desta medição começou agora (a tela, outra rodada): não emite outra, espera
    if (e.status === 409) { await aguardar(ex); return false; }
    throw e;
  }
  await gravar(ex.id, { situacao: "AGUARDANDO", erro: null, tentativas: 0, proximaTentativa: null });
  return true; // confere já: recusa imediata vira pendência
}

/** O e-mail deste boleto já saiu? (o registro de envio da conta depois da emissão) */
async function emailDoBoletoSaiu(c: { id: string; empresaId: string; boletoEmitidoEm: Date | null }) {
  return !!(await prisma.emailLog.findFirst({
    where: { empresaId: c.empresaId, referenciaId: c.id, referenciaTipo: "ContaReceber", status: "ENVIADO", ...(c.boletoEmitidoEm ? { enviadoEm: { gte: c.boletoEmitidoEm } } : {}) },
    select: { id: true },
  }));
}

/**
 * Etapa D — boleto (chave "Emitir e enviar o boleto sozinho"). Depois da NF (a da rotina, a da tela
 * ou a registrada à mão): emite o boleto Inter de cada cobrança da medição que pode receber boleto
 * (A receber/atrasada, sem boleto) e manda ao cliente por e-mail (D6). Já tem boleto = não emite outro.
 */
async function etapaBoleto(ex: Execucao): Promise<boolean> {
  if (await medicaoCancelada(ex)) return false;
  const m = ex.medicao!;
  const ct = ex.contrato;
  if (!medicaoComNf(m.status)) { await aguardar(ex); return false; } // a conta só libera com a NF

  const cobrancas = await prisma.contaReceber.findMany({
    where: { ...cobrancasDaMedicao(m.id), empresaId: ct.empresaId, excluidaEm: null, status: { in: ["A_RECEBER", "ATRASADO"] } },
    select: { id: true, numero: true, status: true, boletoId: true, boletoStatus: true },
    orderBy: [{ parcelaNumero: "asc" }, { criadoEm: "asc" }],
  });
  const naoSaiu: string[] = [];
  const emitidas = new Set<string>();
  for (const c of cobrancas.filter((c) => !motivoSemBoleto(c))) {
    try {
      const r = await emitirBoletoDaConta(ct.empresaId, c.id, { usuarioId: null });
      emitidas.add(c.id);
      if (!r.email.ok && !emailDesligado(r.email.erro)) naoSaiu.push(`${c.numero}: ${r.email.erro ?? "motivo desconhecido"}`);
    } catch (e) {
      if (!(e instanceof ErroBoleto)) throw e;
      if (e.message.startsWith("Integração com o Banco Inter")) { await pendencia(ex, "O Banco Inter não está configurado/ativo: o boleto não sai. Configure em Configurações › Integrações e use \"Tentar de novo\"."); return false; }
      if (e.message.startsWith("Já existe um boleto")) continue; // a tela emitiu no meio: não emite outro
      throw e;
    }
  }
  // "Tentar de novo" depois de um e-mail que não saiu: manda de novo o que ficou sem e-mail
  if (ex.situacao === "PENDENTE") {
    const comBoleto = await prisma.contaReceber.findMany({
      where: { id: { in: cobrancas.map((c) => c.id).filter((id) => !emitidas.has(id)) }, boletoStatus: "EMITIDO" },
      select: { id: true, numero: true, empresaId: true, boletoEmitidoEm: true },
    });
    for (const c of comBoleto) {
      if (await emailDoBoletoSaiu(c)) continue;
      const r = await enviarBoleto(c.id).catch((e) => ({ ok: false, erro: (e as Error)?.message ?? "erro no envio" }));
      if (!r.ok && !emailDesligado(r.erro)) naoSaiu.push(`${c.numero}: ${r.erro ?? "motivo desconhecido"}`);
    }
  }
  if (naoSaiu.length) {
    await pendencia(ex, `Boleto emitido, mas o e-mail não saiu (${naoSaiu.join("; ")}). Mande pela conta a receber ou use "Tentar de novo".`);
    return false;
  }
  await encerrar(ex.id, "CONCLUIDA");
  return false;
}

/**
 * A nota da medição mudou (autorizada ou não aceita — pelo aviso do PlugNotas, pela reconciliação ou
 * pela tela): a execução do contrato segue na hora, sem esperar a rodada do dia seguinte.
 */
export async function avancarPelaMedicao(medicaoId: string, agora = new Date()) {
  const ex = await prisma.faturamentoContratoExecucao.findFirst({
    where: { medicaoId, etapa: { in: ["NFSE", "BOLETO"] }, situacao: { in: [...ABERTAS] } },
    select: { id: true },
  });
  return ex ? processarExecucao(ex.id, agora) : null;
}

/**
 * Processa UMA execução até onde der hoje. Pega a posse antes (outra rodada simultânea pula) e
 * solta no fim. Erro → conta a tentativa (D7: na 3ª, FALHA e sino).
 */
export async function processarExecucao(id: string, agora = new Date()): Promise<"ocupada" | "ok" | "falhou"> {
  const posse = await prisma.faturamentoContratoExecucao.updateMany({
    where: { id, situacao: { in: [...ABERTAS] }, OR: [{ processandoAte: null }, { processandoAte: { lt: agora } }] },
    data: { processandoAte: new Date(agora.getTime() + LEASE_MS) },
  });
  if (!posse.count) return "ocupada";
  let resultado: "ok" | "falhou" = "ok";
  try {
    for (let i = 0; i < 6; i++) {
      const ex = await carregar(id);
      if (!ex || !(ABERTAS as readonly string[]).includes(ex.situacao)) break;
      try {
        if (!(await avancar(ex))) break;
      } catch (e) {
        resultado = "falhou";
        await gravar(id, { ...aposFalha(ex.tentativas, agora), erro: mensagemDeErro(e) });
        break;
      }
    }
  } finally {
    await prisma.faturamentoContratoExecucao.updateMany({ where: { id }, data: { processandoAte: null } });
  }
  return resultado;
}

export type ResumoRotina = { contratos: number; novas: number; processadas: number; falhas: number; ocupadas: number };

/**
 * A rodada do dia (cron): 1) abre a execução da competência devida de cada contrato com faturamento
 * automático; 2) processa toda execução aberta cuja hora de tentar chegou.
 */
export async function rodarFaturamentoContratos(o: { agora?: Date; empresaId?: string } = {}): Promise<ResumoRotina> {
  const agora = o.agora ?? new Date();
  const p = partesBR(agora);
  const hoje = { ano: p.ano, mes: p.mes + 1, dia: p.dia };
  const filtroEmpresa = o.empresaId ? { empresaId: o.empresaId } : {};

  const contratos = await prisma.contrato.findMany({
    where: { ...filtroEmpresa, status: "ATIVO", faturamentoAutomatico: true },
    select: {
      id: true, empresaId: true, dataInicio: true, dataFim: true, periodicidade: true, diaFaturamento: true, diaFixoMes: true, diaVencimento: true,
      cliente: { select: { diaFaturamento: true } },
    },
  });
  const devidas = contratos
    .map((c) => ({ c, comp: competenciaDevida(c, hoje, c.cliente.diaFaturamento) }))
    .filter((x): x is { c: typeof x.c; comp: { ano: number; mes: number } } => !!x.comp);
  const criadas = devidas.length
    ? await prisma.faturamentoContratoExecucao.createMany({
        data: devidas.map(({ c, comp }) => ({ empresaId: c.empresaId, contratoId: c.id, refAno: comp.ano, refMes: comp.mes })),
        skipDuplicates: true,
      })
    : { count: 0 };

  const abertas = await prisma.faturamentoContratoExecucao.findMany({
    where: { ...filtroEmpresa, situacao: { in: [...ABERTAS] }, OR: [{ proximaTentativa: null }, { proximaTentativa: { lte: agora } }] },
    select: { id: true },
    orderBy: { criadoEm: "asc" },
  });
  const resumo: ResumoRotina = { contratos: contratos.length, novas: criadas.count, processadas: 0, falhas: 0, ocupadas: 0 };
  for (const e of abertas) {
    const r = await processarExecucao(e.id, agora).catch((err) => { console.error("[faturamento-contratos]", e.id, (err as Error)?.message); return "falhou" as const; });
    if (r === "ocupada") resumo.ocupadas++;
    else { resumo.processadas++; if (r === "falhou") resumo.falhas++; }
  }
  return resumo;
}

/** "Tentar de novo": zera as tentativas e processa agora. null = não é desta empresa ou não está num estado que retenta */
export async function retentarExecucao(empresaId: string, id: string, agora = new Date()) {
  const r = await prisma.faturamentoContratoExecucao.updateMany({
    where: { id, empresaId, situacao: { in: ["FALHA", "PENDENCIA", "PENDENTE", "AGUARDANDO"] } },
    data: { situacao: "PENDENTE", tentativas: 0, erro: null, proximaTentativa: null },
  });
  if (!r.count) return null;
  await processarExecucao(id, agora);
  return prisma.faturamentoContratoExecucao.findUnique({ where: { id }, select: { id: true, etapa: true, situacao: true, erro: true, tentativas: true, medicaoId: true } });
}
