/**
 * Checklist de veículo obrigatório no app (o "porteiro") — o lado do SERVIDOR. Regras em lib/checklist-diario/regras.
 *
 * - O checklist feito no porteiro é gravado como QUALQUER checklist de veículo (checklist_preenchidos + itens), com
 *   o colaborador e o veículo padrão dele; o registro do dia (checklist_diario) aponta para ele.
 * - "Com alertas" é decidido aqui, pelas respostas e pelos itens do modelo (nunca o que veio do aparelho).
 * - Idempotente: o client_id do aparelho e a chave colaborador+dia; uma trava por colaborador+dia evita corrida.
 * - Módulo Frota desligado: o porteiro não existe; um envio que já estava no aparelho é aceito sem gravar (a fila
 *   esvazia) — nunca 403 para o app.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { temModulo } from "@/lib/modulos/servidor";
import { diaCivilDeChave } from "@/lib/fuso";
import { itemGeraAlerta, statusPelosAlertas, type ItemDoModelo } from "@/lib/veiculos/checklist";
import {
  colaboradorObrigado, correcaoNoPrazo, decidirGravacao, diaAceito, hojeBR, horarioDoToque, linhasDoHistorico, MSG_CORRECAO_FORA_DO_DIA, MSG_CORRECAO_INATIVADO,
  mudancasDoChecklist, normalizarConfigDiario, veiculoEmUso,
  type ConfigChecklistDiario, type LinhaHistorico, type ResumoPorteiro, type SituacaoDiario,
} from "@/lib/checklist-diario/regras";
import type { EnvioDiario, RespostaEnvioDiario } from "@/lib/checklist-diario/envio";

type Db = Prisma.TransactionClient | typeof prisma;

export const SELECT_CONFIG_DIARIO = {
  checklistDiarioAtivo: true, checklistDiarioDias: true, checklistDiarioTemplateId: true, checklistDiarioTodos: true, checklistDiarioTecnicos: true,
} as const satisfies Prisma.ConfiguracaoSelect;

export const chaveDoDia = (d: Date) => d.toISOString().slice(0, 10);

export async function carregarConfigDiario(empresaId: string, db: Db = prisma): Promise<ConfigChecklistDiario> {
  return normalizarConfigDiario(await db.configuracao.findUnique({ where: { empresaId }, select: SELECT_CONFIG_DIARIO }));
}

const SELECT_ITEM = { id: true, categoria: true, descricao: true, tipo: true, opcoes: true, obrigatorio: true, ordem: true } as const;

/**
 * O resumo do porteiro para a página do app (vai junto da cópia guardada no aparelho). null = este colaborador não
 * tem porteiro: Frota desligada, opção desligada, sem modelo ativo com itens, sem veículo padrão em uso, ou não é
 * obrigado. O resumo vem mesmo num dia sem checklist: o app decide o dia (o aparelho pode ficar dias sem sinal).
 */
export async function resumoPorteiro(empresaId: string, tecnicoId: string | null | undefined, agora: Date = new Date()): Promise<ResumoPorteiro | null> {
  if (!tecnicoId) return null;
  if (!(await temModulo(empresaId, "veiculos"))) return null;
  const config = await carregarConfigDiario(empresaId);
  if (!config.ativo || !config.templateId || !colaboradorObrigado(config, tecnicoId)) return null;
  const [tecnico, modelo] = await Promise.all([
    prisma.tecnico.findFirst({
      where: { id: tecnicoId, empresaId, ativo: true },
      select: { veiculoPadrao: { select: { id: true, placa: true, modelo: true, status: true, empresaId: true } } },
    }),
    prisma.checklistTemplate.findFirst({
      where: { id: config.templateId, empresaId, ativo: true },
      select: { id: true, nome: true, itens: { where: { ativo: true }, orderBy: { ordem: "asc" }, select: SELECT_ITEM } },
    }),
  ]);
  const v = tecnico?.veiculoPadrao;
  if (!v || v.empresaId !== empresaId || !veiculoEmUso(v) || !modelo || !modelo.itens.length) return null;
  const hoje = hojeBR(agora);
  const registro = await prisma.checklistDiario.findUnique({
    where: { tecnicoId_dia: { tecnicoId, dia: diaCivilDeChave(hoje)! } },
    // D13: o checklist feito hoje vai junto (as respostas; a foto só "tem" — não pesa na página), para corrigir até o fim do dia
    select: { situacao: true, checklist: { select: { inativadoEm: true, observacaoGeral: true, itens: { select: { itemTemplateId: true, valor: true, foto: true } } } } },
  });
  const feito = registro?.situacao === "FEITO" && registro.checklist && !registro.checklist.inativadoEm ? registro.checklist : null;
  return {
    dias: config.dias,
    diaServidor: hoje,
    veiculo: { id: v.id, placa: v.placa, modelo: v.modelo },
    modelo: { id: modelo.id, nome: modelo.nome, itens: modelo.itens as ItemDoModelo[] },
    registro: registro ? { dia: hoje, situacao: registro.situacao } : null,
    feitoHoje: feito ? { itens: feito.itens.map((i) => ({ itemTemplateId: i.itemTemplateId, valor: i.valor, temFoto: !!i.foto })), observacaoGeral: feito.observacaoGeral } : null,
  };
}

/** Erro de validação do envio: o aparelho descarta (não adianta reenviar) e avisa o técnico */
export class ErroEnvioDiario extends Error {}

/**
 * Grava o envio do aparelho: o checklist feito (com o checklist preenchido) ou o "não vou usar". Um por colaborador
 * por dia; o mesmo envio de novo não duplica; "não vou usar" → "feito" troca e guarda o rastro.
 */
export async function registrarEnvioDiario(
  p: { empresaId: string; usuarioId: string; tecnicoId: string; envio: EnvioDiario; agora?: Date },
): Promise<RespostaEnvioDiario> {
  const { empresaId, usuarioId, tecnicoId, envio } = p;
  if (!(await temModulo(empresaId, "veiculos"))) return { ok: true, acao: "ignorado", registro: null };
  const recebidoEm = p.agora ?? new Date();
  if (!diaAceito(envio.dia, hojeBR(recebidoEm))) throw new ErroEnvioDiario("Dia do checklist inválido.");
  const tecnico = await prisma.tecnico.findFirst({ where: { id: tecnicoId, empresaId }, select: { id: true } });
  if (!tecnico) throw new ErroEnvioDiario("Colaborador não encontrado.");
  const veiculo = await prisma.veiculo.findFirst({ where: { id: envio.veiculoId, empresaId }, select: { id: true } });
  if (!veiculo) throw new ErroEnvioDiario("Veículo não encontrado.");
  const { feitoEm, offline } = horarioDoToque(envio.feitoEm, recebidoEm);
  const dia = diaCivilDeChave(envio.dia)!;

  return prisma.$transaction(async (tx): Promise<RespostaEnvioDiario> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checklist-diario:${tecnicoId}:${envio.dia}`}))`;
    // client_id é único no banco inteiro: o mesmo envio (mesmo colaborador) é repetido; de outro colaborador, recusa
    const porCliente = await tx.checklistDiario.findUnique({ where: { clientId: envio.clientId }, select: { tecnicoId: true, dia: true, situacao: true } });
    if (porCliente && porCliente.tecnicoId !== tecnicoId) throw new ErroEnvioDiario("Envio inválido.");
    const existente = await tx.checklistDiario.findUnique({ where: { tecnicoId_dia: { tecnicoId, dia } }, select: { id: true, situacao: true, clientId: true, checklistId: true } });
    // D13: a correção já aplicada (o mesmo envio de novo) não aplica outra vez
    const correcaoJa = !porCliente && existente ? await tx.checklistCorrecao.findUnique({ where: { clientId: envio.clientId }, select: { id: true } }) : null;
    const decisao = (porCliente && existente) || correcaoJa ? "repetido"
      : decidirGravacao(existente, { situacao: envio.situacao, clientId: envio.clientId, correcao: envio.situacao === "FEITO" && !!envio.correcao });
    if (decisao === "repetido" || decisao === "manter") {
      return { ok: true, acao: decisao, registro: { dia: envio.dia, situacao: (existente?.situacao ?? porCliente!.situacao) as SituacaoDiario } };
    }
    if (decisao === "corrigir" && envio.situacao === "FEITO") {
      if (!correcaoNoPrazo(envio.dia, hojeBR(feitoEm))) throw new ErroEnvioDiario(MSG_CORRECAO_FORA_DO_DIA);
      if (!existente!.checklistId) throw new ErroEnvioDiario("Checklist não encontrado.");
      await corrigirChecklist(tx, { empresaId, usuarioId, checklistId: existente!.checklistId, veiculoId: veiculo.id, envio, feitoEm });
      await tx.checklistDiario.update({ where: { id: existente!.id }, data: { veiculoId: veiculo.id } });
      return { ok: true, acao: "corrigir", registro: { dia: envio.dia, situacao: "FEITO" } };
    }

    let checklistId: string | null = null;
    if (envio.situacao === "FEITO") checklistId = await gravarChecklist(tx, { empresaId, tecnicoId, veiculoId: veiculo.id, envio, feitoEm });

    if (decisao === "trocar") {
      await tx.checklistDiario.update({
        where: { id: existente!.id },
        data: {
          situacao: "FEITO", situacaoAnterior: "NAO_VAI_USAR", trocadoEm: feitoEm, feitoEm, checklistId, veiculoId: veiculo.id,
          clientId: envio.clientId, usuarioId, enviadoOffline: offline,
        },
      });
      return { ok: true, acao: "trocar", registro: { dia: envio.dia, situacao: "FEITO" } };
    }
    await tx.checklistDiario.create({
      data: {
        empresaId, tecnicoId, usuarioId, dia, veiculoId: veiculo.id, situacao: envio.situacao, checklistId,
        motivo: envio.situacao === "NAO_VAI_USAR" ? envio.motivo?.trim() || null : null,
        feitoEm, recebidoEm, enviadoOffline: offline, clientId: envio.clientId,
      },
    });
    return { ok: true, acao: "criar", registro: { dia: envio.dia, situacao: envio.situacao } };
  });
}

/** O checklist preenchido do porteiro, como qualquer outro: itens do modelo, alerta decidido aqui */
async function gravarChecklist(
  tx: Prisma.TransactionClient,
  p: { empresaId: string; tecnicoId: string; veiculoId: string; envio: Extract<EnvioDiario, { situacao: "FEITO" }>; feitoEm: Date },
): Promise<string> {
  const { envio } = p;
  const modelo = await tx.checklistTemplate.findFirst({
    where: { id: envio.templateId, empresaId: p.empresaId },
    // Itens inativos também: o aparelho pode ter preenchido sem sinal antes de o modelo mudar
    select: { id: true, itens: { select: { id: true, tipo: true, opcoes: true } } },
  });
  if (!modelo) throw new ErroEnvioDiario("Modelo de checklist não encontrado.");
  const doModelo = new Map(modelo.itens.map((i) => [i.id, i]));
  const vistos = new Set<string>();
  const itens = envio.itens.filter((i) => doModelo.has(i.itemTemplateId) && !vistos.has(i.itemTemplateId) && vistos.add(i.itemTemplateId)).map((i) => ({
    itemTemplateId: i.itemTemplateId, valor: i.valor?.trim() || null, foto: i.foto || null,
    alerta: itemGeraAlerta(doModelo.get(i.itemTemplateId)!, i.valor ?? null),
  }));
  if (itens.length !== envio.itens.length) throw new ErroEnvioDiario("Item de checklist inválido.");
  const c = await tx.checklistPreenchido.create({
    data: {
      empresaId: p.empresaId, veiculoId: p.veiculoId, templateId: modelo.id, colaboradorId: p.tecnicoId,
      status: statusPelosAlertas(itens.map((i) => i.alerta)), observacaoGeral: envio.observacaoGeral?.trim() || null,
      criadoEm: p.feitoEm, itens: { create: itens },
    },
    select: { id: true },
  });
  return c.id;
}

/**
 * D13 — a correção do colaborador: as respostas novas no MESMO checklist (o alerta e o status decididos aqui, de novo);
 * o item sem foto nova mantém a foto que já tinha; o item que ficou sem resposta sai. Guarda o que mudou (trilha) e
 * quem/quando editou. Checklist excluído pelo escritório: não corrige.
 */
async function corrigirChecklist(
  tx: Prisma.TransactionClient,
  p: { empresaId: string; usuarioId: string; checklistId: string; veiculoId: string; envio: Extract<EnvioDiario, { situacao: "FEITO" }>; feitoEm: Date },
): Promise<void> {
  const { envio } = p;
  const atual = await tx.checklistPreenchido.findFirst({
    where: { id: p.checklistId, empresaId: p.empresaId },
    select: { id: true, templateId: true, inativadoEm: true, observacaoGeral: true, itens: { select: { id: true, itemTemplateId: true, valor: true, foto: true } } },
  });
  if (!atual) throw new ErroEnvioDiario("Checklist não encontrado.");
  if (atual.inativadoEm) throw new ErroEnvioDiario(MSG_CORRECAO_INATIVADO);
  const modelo = await tx.checklistTemplate.findFirst({
    where: { id: atual.templateId, empresaId: p.empresaId },
    select: { itens: { orderBy: { ordem: "asc" }, select: { id: true, descricao: true, tipo: true, opcoes: true } } },
  });
  if (!modelo) throw new ErroEnvioDiario("Modelo de checklist não encontrado.");
  const doModelo = new Map(modelo.itens.map((i) => [i.id, i]));
  if (envio.itens.some((i) => !doModelo.has(i.itemTemplateId)) || new Set(envio.itens.map((i) => i.itemTemplateId)).size !== envio.itens.length) {
    throw new ErroEnvioDiario("Item de checklist inválido.");
  }
  const antes = new Map(atual.itens.map((i) => [i.itemTemplateId, i]));
  const novos = envio.itens.map((i) => {
    const velho = antes.get(i.itemTemplateId);
    return {
      itemTemplateId: i.itemTemplateId, valor: i.valor?.trim() || null, foto: i.foto || velho?.foto || null, fotoNova: !!i.foto && i.foto !== velho?.foto,
      alerta: itemGeraAlerta(doModelo.get(i.itemTemplateId)!, i.valor ?? null),
    };
  });
  const mudancas = mudancasDoChecklist(
    modelo.itens,
    { itens: Object.fromEntries(atual.itens.map((i) => [i.itemTemplateId, { valor: i.valor, temFoto: !!i.foto }])), observacao: atual.observacaoGeral },
    { itens: Object.fromEntries(novos.map((i) => [i.itemTemplateId, { valor: i.valor, fotoNova: i.fotoNova }])), observacao: envio.observacaoGeral ?? null },
  );
  // A correção fica registrada mesmo sem mudança (o mesmo envio de novo é barrado pelo client_id)
  await tx.checklistCorrecao.create({
    data: { empresaId: p.empresaId, checklistId: atual.id, clientId: envio.clientId, usuarioId: p.usuarioId, feitoEm: p.feitoEm, detalhes: mudancas.join(" · ") || "Sem mudança nas respostas." },
  });
  if (!mudancas.length) return;
  await tx.checklistItemPreenchido.deleteMany({ where: { checklistId: atual.id } });
  await tx.checklistPreenchido.update({
    where: { id: atual.id },
    data: {
      veiculoId: p.veiculoId, status: statusPelosAlertas(novos.map((i) => i.alerta)), observacaoGeral: envio.observacaoGeral?.trim() || null,
      editadoEm: new Date(), editadoPorId: p.usuarioId,
      itens: { create: novos.map(({ fotoNova: _f, ...i }) => i) },
    },
  });
}

/** "Não vai usar o veículo" que o escritório ainda não viu (sino), dos últimos 7 dias */
export async function contarNaoVaiUsar(empresaId: string, agora: Date = new Date()): Promise<number> {
  const desde = diaCivilDeChave(hojeBR(new Date(agora.getTime() - 7 * 864e5)))!;
  return prisma.checklistDiario.count({ where: { empresaId, situacao: "NAO_VAI_USAR", vistoEm: null, dia: { gte: desde } } });
}

/**
 * Histórico do gestor no período (dias civis AAAA-MM-DD): os registros e, para quem é obrigado hoje, os dias de
 * checklist sem registro ("Sem registro" no passado; "Ainda não fez" hoje). Abrir o histórico dá ciência dos
 * "não vai usar" do período (saem do sino).
 */
export async function historicoDiario(empresaId: string, de: string, ate: string, opcoes: { marcarVistos?: boolean; agora?: Date } = {}) {
  const hoje = hojeBR(opcoes.agora ?? new Date());
  const config = await carregarConfigDiario(empresaId);
  const [registros, tecnicos] = await Promise.all([
    prisma.checklistDiario.findMany({
      where: { empresaId, dia: { gte: diaCivilDeChave(de)!, lte: diaCivilDeChave(ate)! } },
      select: {
        id: true, tecnicoId: true, dia: true, situacao: true, feitoEm: true, enviadoOffline: true, motivo: true, checklistId: true,
        situacaoAnterior: true, trocadoEm: true, vistoEm: true,
        tecnico: { select: { nome: true } }, veiculo: { select: { placa: true } }, checklist: { select: { status: true } },
      },
    }),
    config.ativo
      ? prisma.tecnico.findMany({ where: { empresaId, ativo: true, veiculoId: { not: null } }, select: { id: true, nome: true, veiculoPadrao: { select: { placa: true, status: true } } } })
      : Promise.resolve([]),
  ]);
  const obrigados = tecnicos.filter((t) => veiculoEmUso(t.veiculoPadrao) && colaboradorObrigado(config, t.id))
    .map((t) => ({ tecnicoId: t.id, nome: t.nome, veiculo: t.veiculoPadrao?.placa ?? null }));
  const linhas: LinhaHistorico[] = linhasDoHistorico({
    config, obrigados, de, ate, hoje,
    registros: registros.map((r) => ({
      id: r.id, tecnicoId: r.tecnicoId, nome: r.tecnico.nome, dia: chaveDoDia(r.dia), situacao: r.situacao, comAlertas: r.checklist?.status === "COM_ALERTAS",
      veiculo: r.veiculo?.placa ?? null, feitoEm: r.feitoEm.toISOString(), enviadoOffline: r.enviadoOffline, motivo: r.motivo, checklistId: r.checklistId,
      situacaoAnterior: r.situacaoAnterior, trocadoEm: r.trocadoEm?.toISOString() ?? null,
    })),
  });
  if (opcoes.marcarVistos) {
    const ids = registros.filter((r) => r.situacao === "NAO_VAI_USAR" && !r.vistoEm).map((r) => r.id);
    if (ids.length) await prisma.checklistDiario.updateMany({ where: { id: { in: ids }, empresaId }, data: { vistoEm: new Date() } });
  }
  return { config, hoje, linhas };
}

/** Salva a configuração da empresa: modelo e colaboradores precisam ser dela; ligar exige modelo ativo */
export async function salvarConfigDiario(empresaId: string, c: ConfigChecklistDiario): Promise<ConfigChecklistDiario> {
  if (c.templateId && !(await prisma.checklistTemplate.count({ where: { id: c.templateId, empresaId, ativo: true } }))) {
    throw new ErroEnvioDiario("Modelo de checklist inválido.");
  }
  if (c.ativo && !c.templateId) throw new ErroEnvioDiario("Escolha o modelo de checklist para ligar o checklist obrigatório.");
  if (c.ativo && !c.dias.length) throw new ErroEnvioDiario("Escolha ao menos um dia da semana.");
  const tecnicos = c.tecnicos.length ? (await prisma.tecnico.findMany({ where: { id: { in: c.tecnicos }, empresaId }, select: { id: true } })).map((t) => t.id) : [];
  if (tecnicos.length !== c.tecnicos.length) throw new ErroEnvioDiario("Colaborador inválido.");
  if (c.ativo && !c.todos && !tecnicos.length) throw new ErroEnvioDiario("Escolha ao menos um colaborador (ou marque todos com veículo padrão).");
  const data = {
    checklistDiarioAtivo: c.ativo, checklistDiarioDias: c.dias, checklistDiarioTemplateId: c.templateId,
    checklistDiarioTodos: c.todos, checklistDiarioTecnicos: tecnicos,
  };
  const row = await prisma.configuracao.upsert({ where: { empresaId }, create: { empresaId, ...data }, update: data, select: SELECT_CONFIG_DIARIO });
  return normalizarConfigDiario(row);
}
