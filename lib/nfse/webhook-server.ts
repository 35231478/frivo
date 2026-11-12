/**
 * NFS-e PR3 (B) — aviso automático (webhook) do PlugNotas, reconciliação das notas paradas e o
 * aviso no sino. Regras puras em lib/nfse/webhook.ts.
 *
 * Segurança (o mesmo padrão do webhook do Inter):
 *   - a URL leva um segredo PRÓPRIO da empresa (32 bytes aleatórios), nunca o token do PlugNotas;
 *     no banco fica só o hash; a URL aparece uma vez na tela, quando é gerada (girar = a antiga morre);
 *   - o segredo identifica a empresa: o aviso só alcança notas DELA;
 *   - o corpo do aviso nunca muda a nota: ele só diz quais notas consultar, e a situação que vale é
 *     a que o PlugNotas devolve na consulta (com o nosso token, no servidor).
 */
import { prisma } from "@/lib/prisma";
import { aguardandoResposta } from "@/lib/nfse/nota";
import { cadastrarWebhookNfse, ErroPlugNotas } from "@/lib/nfse/plugnotas";
import { consultarNota, ErroEmissao, registrar } from "@/lib/nfse/emissao-server";
import type { Ambiente } from "@/lib/nfse/regras";
import {
  ATRASO_AVISO_MS, gerarSegredoWebhook, hashSegredo, IDADE_MIN_RECONCILIAR_MS, LOTE_RECONCILIAR, MAX_REFS_AVISO, precisaReconciliar,
  referenciasDoAviso, STATUS_AVISO_OK, STATUS_AVISO_PROBLEMA, STATUS_FINAIS, urlWebhook,
} from "@/lib/nfse/webhook";

export class ErroWebhook extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const AGUARDANDO = ["ENVIANDO", "PROCESSANDO"];
/** O aviso consulta mesmo logo depois da tela; só não repete a mesma nota no mesmo segundo */
const INTERVALO_AVISO_MS = 1_000;

type FiscalWebhook = {
  emitenteCnpj: string | null; emitenteAmbiente: string | null; webhookTokenHash: string | null; webhookGeradoEm: Date | null;
  webhookAmbiente: string | null; webhookRegistradoEm: Date | null; webhookErro: string | null; webhookRecebidoEm: Date | null;
} | null;

/** O que a tela "Dados fiscais" mostra do aviso automático (nunca o segredo nem o hash) */
export function situacaoWebhook(f: FiscalWebhook) {
  return {
    ativo: !!f?.webhookTokenHash,
    podeGerar: !!f?.emitenteCnpj && !!f?.emitenteAmbiente,
    geradoEm: f?.webhookGeradoEm?.toISOString() ?? null,
    ambiente: (f?.webhookAmbiente as Ambiente | null) ?? null,
    registradoEm: f?.webhookRegistradoEm?.toISOString() ?? null,
    erro: f?.webhookErro ?? null,
    recebidoEm: f?.webhookRecebidoEm?.toISOString() ?? null,
    /** O emitente mudou de ambiente depois da URL: precisa gerar de novo */
    desatualizado: !!f?.webhookTokenHash && !!f?.emitenteAmbiente && f.webhookAmbiente !== f.emitenteAmbiente,
  };
}
export type SituacaoWebhook = ReturnType<typeof situacaoWebhook>;

const SELECT_FISCAL = {
  emitenteCnpj: true, emitenteAmbiente: true, webhookTokenHash: true, webhookGeradoEm: true, webhookAmbiente: true,
  webhookRegistradoEm: true, webhookErro: true, webhookRecebidoEm: true,
} as const;

/**
 * Gera (ou gira) a URL do aviso e tenta cadastrá-la no PlugNotas, no ambiente do emitente.
 * A URL volta UMA vez. Se o cadastro lá falhar, a URL continua valendo do nosso lado e o motivo
 * fica na tela (dá para colar a URL no painel do PlugNotas ou tentar de novo).
 */
export async function gerarWebhook(empresaId: string, usuarioId: string, base: string, agora = new Date()) {
  const fiscal = await prisma.empresaFiscal.findUnique({ where: { empresaId }, select: SELECT_FISCAL });
  if (!fiscal?.emitenteCnpj || !fiscal.emitenteAmbiente) {
    throw new ErroWebhook("Cadastre a empresa no PlugNotas (salve os Dados fiscais) antes de ligar o aviso automático.", 409);
  }
  const ambiente = fiscal.emitenteAmbiente as Ambiente;
  const segredo = gerarSegredoWebhook();
  const url = urlWebhook(base, segredo);
  await prisma.empresaFiscal.update({
    where: { empresaId },
    data: { webhookTokenHash: hashSegredo(segredo), webhookGeradoEm: agora, webhookAmbiente: ambiente, webhookRegistradoEm: null, webhookErro: null, atualizadoPorId: usuarioId },
  });
  let erro: string | null = null;
  try {
    await cadastrarWebhookNfse(ambiente, fiscal.emitenteCnpj, url, segredo);
  } catch (e) {
    if (!(e instanceof ErroPlugNotas)) throw e;
    erro = e.message;
  }
  const atual = await prisma.empresaFiscal.update({
    where: { empresaId },
    data: erro ? { webhookErro: erro } : { webhookRegistradoEm: new Date() },
    select: SELECT_FISCAL,
  });
  return { url, registrado: !erro, erro, webhook: situacaoWebhook(atual) };
}

/**
 * Aviso que chegou do PlugNotas. `null` = segredo desconhecido (401). As notas apontadas (só da
 * empresa do segredo) são CONSULTADAS no PlugNotas; aviso sem nenhuma referência reconhecível
 * confere as notas da empresa que esperam resposta. `falhas` > 0 = o PlugNotas não respondeu a
 * consulta: a rota devolve erro para ele mandar o aviso de novo.
 */
export async function receberAviso(segredo: string, corpo: unknown, agora = new Date()) {
  const fiscal = await prisma.empresaFiscal.findUnique({ where: { webhookTokenHash: hashSegredo(segredo) }, select: { empresaId: true } });
  if (!fiscal) return null;
  const { empresaId } = fiscal;
  await prisma.empresaFiscal.update({ where: { empresaId }, data: { webhookRecebidoEm: agora } });

  const refs = referenciasDoAviso(corpo);
  const ids = refs.map((r) => r.id).filter(Boolean) as string[];
  const nossos = refs.map((r) => r.idIntegracao).filter(Boolean) as string[];
  const notas = refs.length
    ? await prisma.notaFiscal.findMany({
        where: { empresaId, OR: [{ plugnotasId: { in: ids } }, { id: { in: [...nossos, ...ids] } }] },
        select: { id: true, status: true }, take: MAX_REFS_AVISO,
      })
    : await prisma.notaFiscal.findMany({
        where: { empresaId, status: { in: AGUARDANDO } }, select: { id: true, status: true }, orderBy: { criadoEm: "asc" }, take: LOTE_RECONCILIAR,
      });

  let consultadas = 0;
  let falhas = 0;
  for (const n of notas) {
    if (!aguardandoResposta(n.status)) continue; // já tem resultado: nada a fazer
    await registrar(n.id, "CONSULTA", { status: n.status, mensagem: "Aviso automático do PlugNotas recebido: consultando a situação." });
    try {
      await consultarNota({ id: null, empresaId }, n.id, agora, { intervaloMs: INTERVALO_AVISO_MS });
      consultadas++;
    } catch (e) {
      if (!(e instanceof ErroEmissao)) throw e;
      if (e.status >= 500) falhas++;
    }
  }
  return { empresaId, consultadas, falhas, encontradas: notas.length };
}

/**
 * Reconciliação: consulta as notas que esperam resposta há mais de 2 min sem aviso, cada vez mais
 * espaçado (1 min, 10 min, 1 h). Sem `empresaId` = todas as empresas (cron). Erros não param o lote.
 */
export async function reconciliarNotas(filtro: { empresaId?: string } = {}, agora = new Date(), limite = LOTE_RECONCILIAR) {
  const candidatas = await prisma.notaFiscal.findMany({
    where: { ...(filtro.empresaId ? { empresaId: filtro.empresaId } : {}), status: { in: AGUARDANDO }, criadoEm: { lte: new Date(agora.getTime() - IDADE_MIN_RECONCILIAR_MS) } },
    select: { id: true, empresaId: true, status: true, criadoEm: true, ultimaConsultaEm: true },
    orderBy: [{ ultimaConsultaEm: { sort: "asc", nulls: "first" } }, { criadoEm: "asc" }],
    take: limite * 3,
  });
  const vez = candidatas.filter((n) => precisaReconciliar(n, agora)).slice(0, limite);
  let consultadas = 0;
  let falhas = 0;
  for (const n of vez) {
    try {
      await consultarNota({ id: null, empresaId: n.empresaId }, n.id, agora);
      consultadas++;
    } catch (e) {
      if (!(e instanceof ErroEmissao)) throw e;
      falhas++;
    }
  }
  return { consultadas, falhas };
}

/** Reconciliação puxada pelo sino (a cada 2 min por usuário): no máximo uma rodada por minuto por empresa */
const ultimaRodada = new Map<string, number>();
export const INTERVALO_RODADA_EMPRESA_MS = 60_000;
export async function reconciliarEmpresa(empresaId: string, agora = new Date()) {
  const ultima = ultimaRodada.get(empresaId);
  if (ultima && agora.getTime() - ultima < INTERVALO_RODADA_EMPRESA_MS) return null;
  ultimaRodada.set(empresaId, agora.getTime());
  return reconciliarNotas({ empresaId }, agora);
}
/** Só para os testes: esquece as rodadas (a trava é por processo) */
export const esquecerRodadas = () => ultimaRodada.clear();

/* ───────── Sino ───────── */
const ultimaDe = (empresaId: string, where: object) =>
  prisma.notaFiscal.findFirst({ where: { empresaId, ...where }, orderBy: { atualizadoEm: "desc" }, select: { medicaoId: true } });

/** O que o sino mostra da NFS-e (quem tem Financeiro › Fiscal): resultado não visto e nota parada há 30 min */
export async function avisosNfse(empresaId: string, agora = new Date()) {
  const autorizadas = { avisoVistoEm: null, status: { in: [...STATUS_AVISO_OK] } };
  const problemas = { avisoVistoEm: null, status: { in: [...STATUS_AVISO_PROBLEMA] } };
  const aguardando = { status: { in: AGUARDANDO }, criadoEm: { lte: new Date(agora.getTime() - ATRASO_AVISO_MS) } };
  const [nAut, nProb, nAg, uAut, uProb, uAg] = await Promise.all([
    prisma.notaFiscal.count({ where: { empresaId, ...autorizadas } }),
    prisma.notaFiscal.count({ where: { empresaId, ...problemas } }),
    prisma.notaFiscal.count({ where: { empresaId, ...aguardando } }),
    ultimaDe(empresaId, autorizadas), ultimaDe(empresaId, problemas), ultimaDe(empresaId, aguardando),
  ]);
  return {
    nfseAutorizadas: nAut, nfseAutorizadaMedicaoId: uAut?.medicaoId ?? null,
    nfseRejeitadas: nProb, nfseRejeitadaMedicaoId: uProb?.medicaoId ?? null,
    nfseAguardando: nAg, nfseAguardandoMedicaoId: uAg?.medicaoId ?? null,
  };
}

/** Quem tem Fiscal abriu as notas: o resultado (autorizada/rejeitada) sai do sino */
export async function marcarAvisosVistos(empresaId: string, notaIds: string[], agora = new Date()) {
  if (!notaIds.length) return 0;
  const { count } = await prisma.notaFiscal.updateMany({
    where: { empresaId, id: { in: notaIds }, avisoVistoEm: null, status: { in: [...STATUS_FINAIS] } },
    data: { avisoVistoEm: agora },
  });
  return count;
}
