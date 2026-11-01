/**
 * Rotina diária de faturamento automático dos contratos (PR3-A: medição → aprovação).
 * Uma EXECUÇÃO por contrato × competência (único no banco) guarda a etapa, a situação, o erro e as
 * tentativas; a rodada seguinte retoma de onde parou. Travas:
 * - execução única por competência (createMany skipDuplicates sobre o índice único);
 * - "posse" da execução (processando_ate): duas rodadas ao mesmo tempo não processam a mesma;
 * - a medição sai pelo núcleo único (contrato trancado + competência conferida lá dentro).
 */
import { prisma } from "@/lib/prisma";
import { partesBR } from "@/lib/fuso";
import { enviarMedicao } from "@/lib/email";
import { cobrancaDoContrato, gerarMedicaoDeContratos } from "@/lib/faturamento/medicao-contrato-server";
import { aprovarMedicao, marcarEnviada } from "@/lib/faturamento/aprovar-medicao-server";
import { aposFalha, competenciaDevida, LEASE_MS, medicaoJaAprovada, mensagemDeErro } from "@/lib/faturamento/rotina-contratos";

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
      if (ct.emitirNfseAuto) {
        await gravar(ex.id, { etapa: "NFSE", situacao: "AGUARDANDO", tentativas: 0, erro: null, proximaTentativa: null });
        return false;
      }
      await encerrar(ex.id, "CONCLUIDA");
      return false;
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
    // Aprovação do cliente: envia uma vez (D6: por e-mail) e espera; cada rodada confere de novo
    if (m.status === "RASCUNHO") {
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

  // NFSE / BOLETO: emissão automática (próxima etapa do plano). Fica aguardando sem consumir tentativa.
  if (ex.situacao !== "AGUARDANDO") await gravar(ex.id, { situacao: "AGUARDANDO", proximaTentativa: null });
  return false;
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
