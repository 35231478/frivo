/**
 * Previsão do CONTRATO — regras puras (sem banco), usadas pela geração das previsões, pela
 * sincronização ao editar o contrato, pelo encerramento e pelo "Gerar medições do mês".
 *
 * D1 (PR3-A): a cobrança sai a cada N meses pela PERIODICIDADE do contrato (mensal, bimestral,
 * trimestral, semestral, anual), pelo valor cadastrado (o de CADA cobrança, sem multiplicar). Uma
 * previsão por competência = o 1º mês do período. A vigência conta pela regra do aniversário (CO4).
 */
import { formatarData, formatarMoeda } from "@/lib/utils";
import { hojeDiaCivil } from "@/lib/fuso";

export function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() + n); return x; }
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function diaDoMes(ano: number, mes0: number, dia: number): Date {
  const ultimo = new Date(ano, mes0 + 1, 0).getDate();
  return new Date(ano, mes0, Math.min(dia, ultimo));
}
/** Ajusta uma data que cai no fim de semana conforme o tratamento escolhido. */
export function ajustarFimDeSemana(d: Date, modo: string | null | undefined): Date {
  const wd = d.getDay(); // 0=dom, 6=sáb
  if (modo === "ADIANTAR") { if (wd === 6) return addDays(d, -1); if (wd === 0) return addDays(d, -2); }
  else if (modo === "POSTERGAR") { if (wd === 6) return addDays(d, 2); if (wd === 0) return addDays(d, 1); }
  return d;
}

/** D1: de quantos em quantos meses o contrato cobra. Semanal/quinzenal (da recorrência de OS) valem como mensal. */
export const MESES_POR_PERIODICIDADE: Record<string, number> = { MENSAL: 1, BIMESTRAL: 2, TRIMESTRAL: 3, SEMESTRAL: 6, ANUAL: 12 };
/** As periodicidades que o seletor de COBRANÇA oferece */
export const PERIODICIDADES_COBRANCA = ["MENSAL", "BIMESTRAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"] as const;
export const passoCobranca = (periodicidade: string | null | undefined) => MESES_POR_PERIODICIDADE[periodicidade ?? ""] ?? 1;

/** "por mês" · "a cada 3 meses" · "por ano" */
export function textoFrequencia(passo: number): string {
  if (passo <= 1) return "por mês";
  if (passo === 12) return "por ano";
  return `a cada ${passo} meses`;
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** Soma meses a uma competência (mes 1–12) */
export function somarMeses(ano: number, mes: number, n: number): { ano: number; mes: number } {
  const t = ano * 12 + (mes - 1) + n;
  return { ano: Math.floor(t / 12), mes: (t % 12) + 1 }; // t ≥ 0 para qualquer ano real
}
/**
 * O período que a cobrança cobre: mensal "11/2026"; a cada N meses "jan–mar/2026" (ou
 * "nov/2026–jan/2027" quando vira o ano). D5: a referência ANTERIOR descreve o período de antes.
 */
export function rotuloReferencia(ano: number, mes: number, passo = 1, referencia: string | null | undefined = "CORRENTE"): string {
  const ini = referencia === "ANTERIOR" ? somarMeses(ano, mes, -Math.max(1, passo)) : { ano, mes };
  if (passo <= 1) return `${String(ini.mes).padStart(2, "0")}/${ini.ano}`;
  const fim = somarMeses(ini.ano, ini.mes, passo - 1);
  return ini.ano === fim.ano
    ? `${MESES_CURTOS[ini.mes - 1]}–${MESES_CURTOS[fim.mes - 1]}/${fim.ano}`
    : `${MESES_CURTOS[ini.mes - 1]}/${ini.ano}–${MESES_CURTOS[fim.mes - 1]}/${fim.ano}`;
}

/**
 * CO4: competências (mês/ano) cobradas pela vigência. A regra é a do aniversário:
 * um mês de referência conta enquanto o aniversário do início naquele mês for ANTERIOR
 * ao fim — assim "01/01 a 01/01 do ano seguinte" e "01/01 a 31/12" são ambos 12 meses.
 * Vigência indeterminada: 12 meses a partir de hoje.
 */
export function competenciasDoContrato(dataInicio: Date, dataFim: Date | null, hoje: Date = hojeDiaCivil(), passo = 1): { ano: number; mes: number }[] {
  const inicio = new Date(dataInicio);
  // sem fim: ~12 meses à frente (13 > 12 = o maior passo: o anual sempre tem a próxima cobrança)
  const fim = dataFim ? new Date(dataFim) : addMonths(hoje, 13);
  const out: { ano: number; mes: number }[] = [];
  // PR4: até o fim (ou a janela de ~12 meses), por mais antigo que seja o contrato (antes: no máximo 120
  // meses a partir do início — contrato indeterminado com mais de 10 anos parava de gerar previsão)
  const limite = (fim.getFullYear() - inicio.getFullYear()) * 12 + (fim.getMonth() - inicio.getMonth()) + 1;
  for (let k = 0; k <= limite; k += Math.max(1, passo)) {
    const ref = addMonths(inicio, k); // dia 1 do mês de referência
    const aniversario = diaDoMes(ref.getFullYear(), ref.getMonth(), inicio.getDate());
    if (aniversario >= fim) break;
    out.push({ ano: ref.getFullYear(), mes: ref.getMonth() + 1 });
  }
  return out;
}

/**
 * CO4 para UMA competência (mes 1–12), sem limite de anos: a mesma regra do aniversário de
 * `competenciasDoContrato`. Não cobra o mês antes do início nem o mês cujo aniversário já
 * está no fim (ou depois dele). Sem fim: cobra todo mês a partir do início.
 */
export function contratoCobraNaCompetencia(dataInicio: Date, dataFim: Date | null, ano: number, mes: number, passo = 1): boolean {
  const inicio = new Date(dataInicio);
  const k = (ano - inicio.getFullYear()) * 12 + (mes - 1 - inicio.getMonth());
  if (k < 0) return false;
  if (k % Math.max(1, passo) !== 0) return false; // D1: só o 1º mês de cada período cobra
  if (!dataFim) return true;
  return diaDoMes(ano, mes - 1, inicio.getDate()) < new Date(dataFim);
}

/** Os campos do contrato que formam a cobrança */
export type CobrancaContrato = {
  numero: string;
  periodicidade?: string | null;
  nfseReferencia?: string | null;
  dataInicio: Date;
  dataFim: Date | null;
  valorMensal: unknown;
  diaFaturamento: number | null;
  diaFixoMes: number | null;
  diaVencimento: number | null;
  tipoVencimento: string | null;
  diasAposVencimento: number | null;
  ajusteFinsDeSemana: string | null;
};

export const valorMensalDe = (c: Pick<CobrancaContrato, "valorMensal">) => (c.valorMensal == null ? 0 : Number(c.valorMensal));

/** D2: o dia de faturamento é o do contrato; sem ele, o do cliente; sem nenhum, dia 1 */
export const diaFaturamentoDe = (c: Pick<CobrancaContrato, "diaFaturamento" | "diaFixoMes" | "diaVencimento">, diaCliente?: number | null) =>
  c.diaFaturamento ?? c.diaFixoMes ?? c.diaVencimento ?? diaCliente ?? 1;

/** Vencimento da previsão de uma competência (mes 1–12): dia de faturamento + regra de vencimento + fim de semana */
export function vencimentoDaCompetencia(
  c: Omit<CobrancaContrato, "numero" | "dataInicio" | "dataFim" | "valorMensal" | "periodicidade">, ano: number, mes: number, diaCliente?: number | null,
): Date {
  const mes0 = mes - 1;
  const diaFat = diaFaturamentoDe(c, diaCliente);
  const venc = c.tipoVencimento === "DIA_FIXO_MES" && c.diaFixoMes
    ? diaDoMes(ano, mes0, c.diaFixoMes)
    : addDays(diaDoMes(ano, mes0, diaFat), c.diasAposVencimento ?? 0);
  return ajustarFimDeSemana(venc, c.ajusteFinsDeSemana);
}

/** O que mudou na cobrança do contrato entre duas versões */
export function mudancasDaCobranca(antes: CobrancaContrato, depois: CobrancaContrato) {
  const dia = (d: Date | null) => (d ? new Date(d).getTime() : null);
  return {
    valor: valorMensalDe(antes) !== valorMensalDe(depois),
    vencimento: (["diaFaturamento", "diaFixoMes", "diaVencimento", "tipoVencimento", "diasAposVencimento", "ajusteFinsDeSemana"] as const)
      .some((k) => (antes[k] ?? null) !== (depois[k] ?? null)),
    vigencia: dia(antes.dataInicio) !== dia(depois.dataInicio) || dia(antes.dataFim) !== dia(depois.dataFim)
      || passoCobranca(antes.periodicidade) !== passoCobranca(depois.periodicidade),
  };
}

/**
 * Marca dos eventos que o CONTRATO escreve nas previsões. É por ela (e não pelo motivo, que a
 * pessoa digita no cancelamento manual) que a reativação sabe que a previsão cancelada é do
 * contrato e pode voltar — a cancelada à mão continua cancelada.
 */
export const PREFIXO_EVENTO_CONTRATO = "Pelo contrato: ";
export const eventoDoContrato = (detalhe: string | null | undefined) => !!detalhe?.startsWith(PREFIXO_EVENTO_CONTRATO);

export const motivoForaDaVigencia = (c: Pick<CobrancaContrato, "numero" | "dataInicio" | "dataFim">) =>
  `Fora da vigência do contrato ${c.numero} (${formatarData(c.dataInicio)} a ${c.dataFim ? formatarData(c.dataFim) : "sem fim"})`;
export const motivoSemValor = (numero: string) => `Contrato ${numero} sem valor mensal`;
/** A descrição da previsão/conta do contrato: "<descrição da NFS-e ou Contrato N> — Ref. <período>" */
export const descricaoDaCobranca = (c: { numero: string; descricaoNFSe?: string | null; periodicidade?: string | null; nfseReferencia?: string | null }, ano: number, mes: number) =>
  `${c.descricaoNFSe?.trim() || `Contrato ${c.numero}`} — Ref. ${rotuloReferencia(ano, mes, passoCobranca(c.periodicidade), c.nfseReferencia)}`;
/**
 * O item do contrato na medição (e na discriminação da NFS-e). Mensal com a referência corrente:
 * "Contrato N — mensalidade" (como sempre foi). A cada N meses: "Contrato N — cobrança Ref. jan–mar/2026".
 * D5 (referência anterior): o período de antes, também no mensal ("mensalidade Ref. 10/2026").
 */
export function descricaoItemContrato(c: { numero: string; periodicidade?: string | null; nfseReferencia?: string | null }, ano: number, mes: number): string {
  const passo = passoCobranca(c.periodicidade);
  if (passo <= 1 && c.nfseReferencia !== "ANTERIOR") return `Contrato ${c.numero} — mensalidade`;
  return `Contrato ${c.numero} — ${passo <= 1 ? "mensalidade" : "cobrança"} Ref. ${rotuloReferencia(ano, mes, passo, c.nfseReferencia)}`;
}
export const motivoForaDoPeriodo = (numero: string, passo: number) => `Contrato ${numero} cobra ${textoFrequencia(passo)}: esta competência não tem cobrança`;
export const detalheCancelamento = (motivo: string) => `${PREFIXO_EVENTO_CONTRATO}${motivo}. A previsão sai do Contas a Receber.`;
export const detalheReaberta = (numero: string) => `${PREFIXO_EVENTO_CONTRATO}contrato ${numero} vale de novo nesta competência. A previsão volta.`;

const chaveDia = (d: Date | string | null | undefined) => (d ? formatarData(d, "yyyy-MM-dd") : "");
const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100);

export type PrevisaoAberta = { id: string; refAno: number | null; refMes: number | null; valor: unknown; dataVencimento: Date | string | null };
export type PlanoSincronizacao = {
  atualizar: { id: string; valor?: number; dataVencimento?: Date; detalhe: string }[];
  cancelar: { id: string; motivo: string }[];
};

/**
 * Ao editar o contrato: o que fazer com as previsões AINDA ABERTAS (PREVISTO, sem medição, sem
 * boleto — o servidor só entrega estas). Fora da vigência (ou contrato sem valor) → cancela.
 * Da competência corrente em diante → acompanha o valor e/ou o vencimento novos, só no que
 * mudou no contrato (o ajuste feito à mão numa previsão não é desfeito por outra edição).
 * Competências passadas ainda abertas ficam como estão (o mês antigo não é reprecificado).
 */
export function planoSincronizacao(
  previsoes: PrevisaoAberta[],
  contrato: CobrancaContrato,
  mudou: { valor: boolean; vencimento: boolean },
  hoje: { ano: number; mes: number },
  diaCliente?: number | null,
): PlanoSincronizacao {
  const plano: PlanoSincronizacao = { atualizar: [], cancelar: [] };
  const valor = valorMensalDe(contrato);
  for (const p of previsoes) {
    if (p.refAno == null || p.refMes == null) continue; // conta antiga sem competência: não é nossa
    if (valor <= 0) { plano.cancelar.push({ id: p.id, motivo: motivoSemValor(contrato.numero) }); continue; }
    if (!contratoCobraNaCompetencia(contrato.dataInicio, contrato.dataFim, p.refAno, p.refMes)) {
      plano.cancelar.push({ id: p.id, motivo: motivoForaDaVigencia(contrato) });
      continue;
    }
    const passo = passoCobranca(contrato.periodicidade);
    if (!contratoCobraNaCompetencia(contrato.dataInicio, contrato.dataFim, p.refAno, p.refMes, passo)) {
      plano.cancelar.push({ id: p.id, motivo: motivoForaDoPeriodo(contrato.numero, passo) });
      continue;
    }
    if (p.refAno * 12 + p.refMes < hoje.ano * 12 + hoje.mes) continue;
    const partes: string[] = [];
    const item: PlanoSincronizacao["atualizar"][number] = { id: p.id, detalhe: "" };
    if (mudou.valor && centavos(p.valor) !== centavos(valor)) {
      item.valor = valor;
      partes.push(`valor ${formatarMoeda(Number(p.valor))} → ${formatarMoeda(valor)}`);
    }
    if (mudou.vencimento) {
      const venc = vencimentoDaCompetencia(contrato, p.refAno, p.refMes, diaCliente);
      if (chaveDia(p.dataVencimento) !== chaveDia(venc)) {
        item.dataVencimento = venc;
        partes.push(`vencimento ${formatarData(p.dataVencimento)} → ${formatarData(venc)}`);
      }
    }
    if (!partes.length) continue;
    item.detalhe = `${PREFIXO_EVENTO_CONTRATO}contrato ${contrato.numero} alterado — ${partes.join(" · ")}.`;
    plano.atualizar.push(item);
  }
  return plano;
}
