/**
 * Ferramentas (somente leitura) do assistente Frivo IA.
 *
 * Regras de segurança — valem para TODAS as ferramentas:
 * 1. Empresa e permissões vêm do `ContextoIA`, montado no servidor a partir da sessão. A IA
 *    nunca informa empresa nem usuário: esses campos não existem nos schemas de entrada.
 * 2. Cada ferramenta declara a permissão exigida (a mesma das telas/APIs). A IA só recebe as
 *    ferramentas que o perfil pode usar, e `executarFerramenta` confere de novo antes de consultar.
 * 3. Toda consulta filtra por `empresaId`. Nenhuma ferramenta grava nada (só find/count/aggregate).
 * 4. O que volta do banco é dado, não instrução: textos são cortados e enviados como JSON.
 */
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { pode, type Acao, type Permissoes } from "@/lib/permissoes";
import { chaveDiaBR, horaBR, inicioHojeBR, inicioMesBR } from "@/lib/fuso";
import { dadosFinanceiro } from "@/lib/dashboard/dados";

export interface ContextoIA {
  empresaId: string;
  usuarioId: string;
  permissoes: Permissoes;
  role?: string;
  agora?: Date;
}

type Requisito = [modulo: string, acao: Acao];

interface Ferramenta<S extends z.ZodTypeAny = z.ZodTypeAny> {
  nome: string;
  descricao: string;
  entrada: S;
  /** JSON Schema enviado à API (espelha `entrada`). */
  schema: Record<string, unknown>;
  /** Todas as permissões exigidas (E lógico). */
  exige: Requisito[];
  executar: (input: z.infer<S>, ctx: ContextoIA) => Promise<unknown>;
}

const podeCtx = (ctx: ContextoIA, modulo: string, acao: Acao = "visualizar") => pode(ctx.permissoes, modulo, acao, ctx.role);
const verFinanceiro = (ctx: ContextoIA) => podeCtx(ctx, "financeiro", "visualizar");

/** Corta textos vindos do banco (o modelo recebe só o necessário; reduz superfície de injeção). */
const t = (s: string | null | undefined, max = 300) => (s == null ? null : s.length > max ? `${s.slice(0, max)}…` : s);
const nomeCli = (c: { nome: string; nomeFantasia: string | null } | null | undefined) => (c ? c.nomeFantasia || c.nome : null);
const dataBR = (d: Date | null | undefined) => {
  if (!d) return null;
  const [a, m, dia] = chaveDiaBR(d).split("-");
  return `${dia}/${m}/${a} ${horaBR(d)}`;
};
const num = (v: unknown) => (v == null ? null : Number(v));

const STATUS_OS = ["ABERTA", "AGUARDANDO_ATENDIMENTO", "AGENDADA", "EM_ANDAMENTO", "PAUSADA", "AGUARDANDO_PECA", "CONCLUIDA", "CANCELADA"] as const;
const ABERTAS = ["ABERTA", "AGUARDANDO_ATENDIMENTO", "AGENDADA", "EM_ANDAMENTO", "PAUSADA", "AGUARDANDO_PECA"] as const;

/** "OS-2026-0107", "0107" ou "107" → filtro pelo número da OS (ou do chamado), sempre na empresa. */
function filtroNumero(numero: string, empresaId: string) {
  const n = numero.trim().toUpperCase();
  if (/^\d{1,6}$/.test(n)) {
    const sufixo = `-${n.padStart(4, "0")}`;
    return { empresaId, OR: [{ numero: { endsWith: sufixo } }, { chamadoNumero: { endsWith: sufixo } }] };
  }
  return { empresaId, OR: [{ numero: n }, { chamadoNumero: n }] };
}

async function carregarOs(numero: string, ctx: ContextoIA, detalhado: boolean) {
  const os = await prisma.ordemServico.findFirst({
    where: filtroNumero(numero, ctx.empresaId),
    orderBy: { criadoEm: "desc" },
    select: {
      id: true, numero: true, chamadoNumero: true, status: true, prioridade: true, origem: true, descricao: true, observacoes: true,
      criadoEm: true, previsaoConclusao: true, dataInicio: true, dataConclusao: true,
      cliente: { select: { nome: true, nomeFantasia: true, cpfCnpj: true } },
      unidade: { select: { nome: true, logradouro: true, numero: true, bairro: true, cidade: true, estado: true } },
      contrato: { select: { numero: true, tipo: true } },
      responsavel: { select: { nome: true } },
      equipamento: { select: { marca: true, modelo: true, numeroSerie: true, setor: true, localizacao: true } },
      atividades: {
        orderBy: { dataAgendada: "asc" },
        select: {
          titulo: true, status: true, dataAgendada: true, duracaoMin: true, observacao: true, resumo: true,
          tipoOs: { select: { nome: true } },
          tecnico: { select: { nome: true } },
          equipe: { select: { nome: true } },
          veiculo: { select: { placa: true, modelo: true } },
          tecnicosEquipe: { select: { tecnico: { select: { nome: true } } } },
          equipamentos: {
            select: {
              feito: true, feitoEm: true,
              equipamento: { select: { marca: true, modelo: true, numeroSerie: true, setor: true, localizacao: true, capacidade: true, fluido: true } },
            },
          },
          ...(detalhado ? {
            respostas: { select: { resposta: true, arquivoUrl: true, campo: { select: { label: true, ordem: true } }, formulario: { select: { nome: true } } } },
            respostasEquipamento: {
              select: {
                resposta: true, arquivoUrl: true, campo: { select: { label: true, ordem: true } },
                equipamento: { select: { marca: true, modelo: true, numeroSerie: true } },
              },
            },
          } : {}),
        },
      },
      itensOrcamento: { select: { descricao: true, quantidade: true, valorUnitario: true, valorTotal: true, executado: true } },
      anexos: { select: { nome: true, tipo: true, criadoEm: true } },
      ...(verFinanceiro(ctx) ? { medicoes: { select: { numero: true, valorTotal: true, status: true, dataMedicao: true } } } : {}),
    },
  });
  if (!os) return { encontrada: false, mensagem: `Nenhuma OS com o número "${numero}" nesta empresa.` };

  const fin = verFinanceiro(ctx);
  const eqp = (e: { marca: string; modelo: string; numeroSerie: string | null; setor?: string | null; localizacao?: string | null } | null) =>
    e ? [e.marca, e.modelo, e.numeroSerie && `série ${e.numeroSerie}`, e.setor, e.localizacao].filter(Boolean).join(" · ") : null;
  const u = os.unidade;
  return {
    encontrada: true,
    numero: os.numero, chamado: os.chamadoNumero, status: os.status, prioridade: os.prioridade, origem: os.origem,
    descricao: t(os.descricao, detalhado ? 1500 : 500), observacoes: t(os.observacoes, 500),
    cliente: nomeCli(os.cliente), documentoCliente: os.cliente?.cpfCnpj ?? null,
    local: u ? { unidade: u.nome, endereco: [u.logradouro, u.numero, u.bairro, u.cidade, u.estado].filter(Boolean).join(", ") || null } : null,
    contrato: os.contrato ? `${os.contrato.numero} (${os.contrato.tipo})` : null,
    responsavel: os.responsavel?.nome ?? null,
    equipamentoPrincipal: eqp(os.equipamento),
    datas: { abertura: dataBR(os.criadoEm), inicio: dataBR(os.dataInicio), previsao: dataBR(os.previsaoConclusao), conclusao: dataBR(os.dataConclusao) },
    atividades: os.atividades.map((a: any) => ({
      titulo: t(a.titulo, 150), tipo: a.tipoOs?.nome ?? null, status: a.status, agendada: dataBR(a.dataAgendada), duracaoMin: a.duracaoMin,
      tecnico: a.tecnico?.nome ?? null, equipe: a.equipe?.nome ?? null,
      outrosTecnicos: a.tecnicosEquipe.map((x: any) => x.tecnico.nome),
      veiculo: a.veiculo ? `${a.veiculo.placa} ${a.veiculo.modelo}` : null,
      observacao: t(a.observacao, detalhado ? 1000 : 300), resumoExecucao: t(a.resumo, detalhado ? 1500 : 400),
      equipamentos: a.equipamentos.map((e: any) => ({ equipamento: eqp(e.equipamento), capacidade: e.equipamento.capacidade, fluido: e.equipamento.fluido, feito: e.feito, feitoEm: dataBR(e.feitoEm) })),
      ...(detalhado ? {
        checklist: [...a.respostas].sort((x: any, y: any) => x.campo.ordem - y.campo.ordem).map((r: any) => ({
          formulario: r.formulario.nome, campo: r.campo.label, resposta: t(r.resposta, 300), temFoto: !!r.arquivoUrl,
        })),
        checklistPorEquipamento: [...a.respostasEquipamento].sort((x: any, y: any) => x.campo.ordem - y.campo.ordem).map((r: any) => ({
          equipamento: eqp(r.equipamento), campo: r.campo.label, resposta: t(r.resposta, 300), temFoto: !!r.arquivoUrl,
        })),
      } : {}),
    })),
    pecasEServicos: os.itensOrcamento.map((i) => ({
      descricao: t(i.descricao, 200), quantidade: num(i.quantidade), executado: i.executado,
      ...(fin ? { valorUnitario: num(i.valorUnitario), valorTotal: num(i.valorTotal) } : {}),
    })),
    fotosEAnexos: { quantidade: os.anexos.length, arquivos: os.anexos.slice(0, 15).map((a) => ({ nome: t(a.nome, 100), tipo: a.tipo, enviadoEm: dataBR(a.criadoEm) })) },
    ...(fin && "medicoes" in os ? { medicoes: (os as any).medicoes.map((m: any) => ({ numero: m.numero, valor: num(m.valorTotal), status: m.status, data: dataBR(m.dataMedicao) })) } : {}),
    observacaoPermissao: fin ? undefined : "Valores financeiros omitidos: o perfil do usuário não tem acesso ao financeiro.",
  };
}

const textoCurto = (max: number) => z.string().trim().min(1).max(max);

export const FERRAMENTAS: Ferramenta[] = [
  {
    nome: "consultar_os",
    descricao: "Detalhes de UMA ordem de serviço pelo número (ex.: OS-2026-0107, 0107 ou 107; também aceita nº de chamado CHM-...): cliente, local, equipamentos, atividades, execução, técnicos/equipe/veículo, peças/serviços, fotos/anexos, status e datas. Valores só aparecem se o perfil puder ver o financeiro.",
    entrada: z.object({ numero: textoCurto(40) }).strict(),
    schema: { type: "object", properties: { numero: { type: "string", description: "Número da OS ou do chamado" } }, required: ["numero"], additionalProperties: false },
    exige: [["ordens", "visualizar"]],
    executar: (i, ctx) => carregarOs(i.numero, ctx, false),
  },
  {
    nome: "dados_laudo_os",
    descricao: "Dados COMPLETOS de uma OS para redigir laudo/relatório técnico: tudo de consultar_os mais as respostas dos checklists/formulários por atividade e por equipamento. Use quando pedirem laudo, relatório técnico ou parecer de uma OS.",
    entrada: z.object({ numero: textoCurto(40) }).strict(),
    schema: { type: "object", properties: { numero: { type: "string", description: "Número da OS ou do chamado" } }, required: ["numero"], additionalProperties: false },
    exige: [["ordens", "visualizar"]],
    executar: (i, ctx) => carregarOs(i.numero, ctx, true),
  },
  {
    nome: "listar_os",
    descricao: "Lista ordens de serviço (até 20) com filtros opcionais: status, período de agendamento (datas AAAA-MM-DD, no fuso de Brasília), nome do técnico e nome do cliente. Devolve também o total encontrado.",
    entrada: z.object({
      status: z.array(z.enum(STATUS_OS)).max(8).optional(),
      apenasAbertas: z.boolean().optional(),
      apenasAtrasadas: z.boolean().optional(),
      de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      tecnico: textoCurto(80).optional(),
      cliente: textoCurto(80).optional(),
      limite: z.number().int().min(1).max(20).optional(),
    }).strict(),
    schema: {
      type: "object",
      properties: {
        status: { type: "array", items: { type: "string", enum: [...STATUS_OS] }, description: "Filtrar por status" },
        apenasAbertas: { type: "boolean", description: "Só OS não concluídas/canceladas" },
        apenasAtrasadas: { type: "boolean", description: "Só OS abertas com previsão de conclusão vencida" },
        de: { type: "string", description: "Agendadas a partir de (AAAA-MM-DD)" },
        ate: { type: "string", description: "Agendadas até (AAAA-MM-DD, inclusive)" },
        tecnico: { type: "string", description: "Parte do nome do técnico" },
        cliente: { type: "string", description: "Parte do nome do cliente" },
        limite: { type: "integer", description: "Máximo de OS (1-20)" },
      },
      additionalProperties: false,
    },
    exige: [["ordens", "visualizar"]],
    executar: async (i, ctx) => {
      const agora = ctx.agora ?? new Date();
      const where: any = { empresaId: ctx.empresaId };
      if (i.status?.length) where.status = { in: i.status };
      if (i.apenasAbertas || i.apenasAtrasadas) where.status = { in: [...ABERTAS] };
      if (i.apenasAtrasadas) where.previsaoConclusao = { lt: agora };
      const atividade: any = {};
      if (i.de || i.ate) {
        const [ad, md, dd] = (i.de ?? "1970-01-01").split("-").map(Number);
        const [aa, ma, da] = (i.ate ?? "2999-12-31").split("-").map(Number);
        atividade.dataAgendada = { gte: inicioHojeBR(new Date(Date.UTC(ad, md - 1, dd, 12))), lt: inicioHojeBR(new Date(Date.UTC(aa, ma - 1, da, 12)), 1) };
      }
      if (i.tecnico) atividade.tecnico = { nome: { contains: i.tecnico, mode: "insensitive" } };
      if (Object.keys(atividade).length) where.atividades = { some: atividade };
      if (i.cliente) where.cliente = { OR: [{ nome: { contains: i.cliente, mode: "insensitive" } }, { nomeFantasia: { contains: i.cliente, mode: "insensitive" } }] };
      const [total, lista] = await Promise.all([
        prisma.ordemServico.count({ where }),
        prisma.ordemServico.findMany({
          where, take: i.limite ?? 10, orderBy: { criadoEm: "desc" },
          select: {
            numero: true, status: true, prioridade: true, descricao: true, previsaoConclusao: true,
            cliente: { select: { nome: true, nomeFantasia: true } },
            atividades: { take: 1, orderBy: { dataAgendada: "asc" }, where: { status: { not: "CANCELADA" } }, select: { dataAgendada: true, tecnico: { select: { nome: true } } } },
          },
        }),
      ]);
      return {
        total, mostrando: lista.length,
        os: lista.map((o) => ({
          numero: o.numero, cliente: nomeCli(o.cliente), status: o.status, prioridade: o.prioridade, descricao: t(o.descricao, 120),
          agendada: dataBR(o.atividades[0]?.dataAgendada), tecnico: o.atividades[0]?.tecnico?.nome ?? null, previsao: dataBR(o.previsaoConclusao),
        })),
      };
    },
  },
  {
    nome: "resumo_periodo",
    descricao: "Resumo operacional de hoje, da semana (próximos 7 dias) ou do mês: OS abertas, atrasadas, agendadas e concluídas no período, e atividades por técnico.",
    entrada: z.object({ periodo: z.enum(["hoje", "semana", "mes"]) }).strict(),
    schema: { type: "object", properties: { periodo: { type: "string", enum: ["hoje", "semana", "mes"] } }, required: ["periodo"], additionalProperties: false },
    exige: [["ordens", "visualizar"]],
    executar: async (i, ctx) => {
      const agora = ctx.agora ?? new Date();
      const ini = i.periodo === "mes" ? inicioMesBR(agora) : inicioHojeBR(agora);
      const fim = i.periodo === "hoje" ? inicioHojeBR(agora, 1) : i.periodo === "semana" ? inicioHojeBR(agora, 7) : inicioMesBR(agora, 1);
      const E = ctx.empresaId;
      const [abertas, atrasadas, concluidas, agendadas, porTecnico] = await Promise.all([
        prisma.ordemServico.count({ where: { empresaId: E, status: { in: [...ABERTAS] } } }),
        prisma.ordemServico.count({ where: { empresaId: E, status: { in: [...ABERTAS] }, previsaoConclusao: { lt: agora } } }),
        prisma.ordemServico.count({ where: { empresaId: E, status: "CONCLUIDA", dataConclusao: { gte: ini, lt: fim } } }),
        prisma.atividadeOs.count({ where: { empresaId: E, dataAgendada: { gte: ini, lt: fim }, status: { not: "CANCELADA" } } }),
        prisma.atividadeOs.groupBy({ by: ["tecnicoId", "status"], where: { empresaId: E, dataAgendada: { gte: ini, lt: fim }, status: { not: "CANCELADA" } }, _count: { _all: true } }),
      ]);
      const ids = [...new Set(porTecnico.map((g) => g.tecnicoId).filter((x): x is string => !!x))];
      const tecs = ids.length ? await prisma.tecnico.findMany({ where: { empresaId: E, id: { in: ids } }, select: { id: true, nome: true } }) : [];
      const nome = new Map(tecs.map((x) => [x.id, x.nome]));
      const linhas = new Map<string, { tecnico: string; total: number; concluidas: number }>();
      for (const g of porTecnico) {
        const k = g.tecnicoId ?? "-";
        const l = linhas.get(k) ?? { tecnico: g.tecnicoId ? nome.get(g.tecnicoId) ?? "?" : "Sem técnico", total: 0, concluidas: 0 };
        l.total += g._count._all;
        if (g.status === "CONCLUIDA") l.concluidas += g._count._all;
        linhas.set(k, l);
      }
      return {
        periodo: i.periodo, de: chaveDiaBR(ini), ate: chaveDiaBR(new Date(fim.getTime() - 1)),
        osAbertas: abertas, osAtrasadas: atrasadas, osConcluidasNoPeriodo: concluidas, atividadesAgendadasNoPeriodo: agendadas,
        atividadesPorTecnico: [...linhas.values()].sort((a, b) => b.total - a.total),
      };
    },
  },
  {
    nome: "resumo_financeiro",
    descricao: "Contas a receber: faturado e recebido no mês, total a receber, vencidos (com os maiores devedores) e o que vence nos próximos 7 dias.",
    entrada: z.object({}).strict(),
    schema: { type: "object", properties: {}, additionalProperties: false },
    exige: [["financeiro", "visualizar"], ["financeiro", "contasReceber"]],
    executar: async (_i, ctx) => {
      const agora = ctx.agora ?? new Date();
      const [resumo, vencidos] = await Promise.all([
        dadosFinanceiro(ctx.empresaId, agora),
        prisma.contaReceber.findMany({
          where: { empresaId: ctx.empresaId, status: { in: ["A_RECEBER", "ATRASADO"] }, dataVencimento: { lt: inicioHojeBR(agora) } },
          orderBy: { valor: "desc" }, take: 5,
          select: { numero: true, valor: true, dataVencimento: true, cliente: { select: { nome: true, nomeFantasia: true } } },
        }),
      ]);
      return {
        ...resumo,
        maioresVencidos: vencidos.map((c) => ({ titulo: c.numero, cliente: nomeCli(c.cliente), valor: num(c.valor), vencimento: dataBR(c.dataVencimento) })),
        observacao: "Valores em reais. Contas 'previstas' de contrato não entram (são projeção, não cobrança emitida).",
      };
    },
  },
  {
    nome: "buscar_cliente",
    descricao: "Busca clientes por nome, nome fantasia ou CPF/CNPJ (até 5): contato, cidade, contratos ativos e OS abertas.",
    entrada: z.object({ termo: textoCurto(80) }).strict(),
    schema: { type: "object", properties: { termo: { type: "string" } }, required: ["termo"], additionalProperties: false },
    exige: [["clientes", "visualizar"]],
    executar: async (i, ctx) => {
      const lista = await prisma.cliente.findMany({
        where: {
          empresaId: ctx.empresaId,
          OR: [{ nome: { contains: i.termo, mode: "insensitive" } }, { nomeFantasia: { contains: i.termo, mode: "insensitive" } }, { cpfCnpj: { contains: i.termo } }],
        },
        take: 5, orderBy: { nome: "asc" },
        // select explícito: nunca dados de acesso ao portal (senhas)
        select: {
          id: true, nome: true, nomeFantasia: true, cpfCnpj: true, email: true, telefone: true, ativo: true,
          unidades: { where: { ativo: true }, take: 3, select: { nome: true, cidade: true, estado: true } },
          _count: { select: { contratos: { where: { status: "ATIVO" } }, ordensServico: { where: { status: { in: [...ABERTAS] } } } } },
        },
      });
      return {
        encontrados: lista.length,
        clientes: lista.map((c) => ({
          nome: c.nome, nomeFantasia: c.nomeFantasia, documento: c.cpfCnpj, email: c.email, telefone: c.telefone, ativo: c.ativo,
          locais: c.unidades.map((u) => [u.nome, u.cidade, u.estado].filter(Boolean).join(" - ")),
          contratosAtivos: c._count.contratos, osAbertas: c._count.ordensServico,
        })),
      };
    },
  },
  {
    nome: "buscar_equipamento",
    descricao: "Busca equipamentos por nº de série, patrimônio, marca, modelo ou nome (até 8): cliente, local (unidade/setor/ambiente), garantia e quantidade de atendimentos.",
    entrada: z.object({ termo: textoCurto(80) }).strict(),
    schema: { type: "object", properties: { termo: { type: "string" } }, required: ["termo"], additionalProperties: false },
    exige: [["equipamentos", "visualizar"]],
    executar: async (i, ctx) => {
      const c = { contains: i.termo, mode: "insensitive" as const };
      const lista = await prisma.equipamento.findMany({
        where: { empresaId: ctx.empresaId, OR: [{ numeroSerie: c }, { patrimonio: c }, { marca: c }, { modelo: c }, { nome: c }] },
        take: 8, orderBy: { atualizadoEm: "desc" },
        select: {
          marca: true, modelo: true, nome: true, numeroSerie: true, patrimonio: true, tipo: true, capacidade: true, fluido: true,
          setor: true, localizacao: true, garantiaAte: true, ativo: true,
          unidade: { select: { nome: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
          _count: { select: { atividades: true } },
        },
      });
      return {
        encontrados: lista.length,
        equipamentos: lista.map((e) => ({
          equipamento: [e.marca, e.modelo, e.nome].filter(Boolean).join(" "), serie: e.numeroSerie, patrimonio: e.patrimonio, tipo: e.tipo,
          capacidade: e.capacidade, fluido: e.fluido, cliente: nomeCli(e.unidade?.cliente), unidade: e.unidade?.nome ?? null,
          setor: e.setor, ambiente: e.localizacao, garantiaAte: dataBR(e.garantiaAte), ativo: e.ativo, atendimentos: e._count.atividades,
        })),
      };
    },
  },
  {
    nome: "status_contrato",
    descricao: "Situação de contratos por número ou nome do cliente (até 5): status, tipo, vigência, valor mensal e locais cobertos.",
    entrada: z.object({ numero: textoCurto(40).optional(), cliente: textoCurto(80).optional() }).strict(),
    schema: { type: "object", properties: { numero: { type: "string" }, cliente: { type: "string" } }, additionalProperties: false },
    exige: [["contratos", "visualizar"]],
    executar: async (i, ctx) => {
      const where: any = { empresaId: ctx.empresaId };
      if (i.numero) where.numero = { contains: i.numero.trim().toUpperCase() };
      if (i.cliente) where.cliente = { OR: [{ nome: { contains: i.cliente, mode: "insensitive" } }, { nomeFantasia: { contains: i.cliente, mode: "insensitive" } }] };
      const lista = await prisma.contrato.findMany({
        where, take: 5, orderBy: { dataInicio: "desc" },
        select: {
          numero: true, status: true, tipo: true, dataInicio: true, dataFim: true, valorMensal: true, qtdVisitas: true, artNumero: true, artVencimento: true,
          cliente: { select: { nome: true, nomeFantasia: true } },
          unidades: { take: 5, select: { unidade: { select: { nome: true } } } },
        },
      });
      return {
        encontrados: lista.length,
        contratos: lista.map((x) => ({
          numero: x.numero, cliente: nomeCli(x.cliente), status: x.status, tipo: x.tipo,
          inicio: dataBR(x.dataInicio), fim: dataBR(x.dataFim), valorMensal: num(x.valorMensal), visitas: x.qtdVisitas,
          art: x.artNumero, artVencimento: dataBR(x.artVencimento), locais: x.unidades.map((u) => u.unidade.nome),
        })),
      };
    },
  },
];

const POR_NOME = new Map(FERRAMENTAS.map((f) => [f.nome, f]));

export function podeUsar(f: Pick<Ferramenta, "exige">, ctx: ContextoIA) {
  return f.exige.every(([m, a]) => podeCtx(ctx, m, a));
}

/** Ferramentas que este usuário pode usar (só elas são oferecidas à IA). */
export function ferramentasDisponiveis(ctx: ContextoIA) {
  return FERRAMENTAS.filter((f) => podeUsar(f, ctx));
}

export type ResultadoFerramenta = { ok: true; dados: unknown } | { ok: false; erro: string };

/**
 * Executa uma ferramenta pedida pela IA. Confere de novo a permissão (defesa em profundidade:
 * a IA pode "inventar" uma ferramenta que não recebeu) e valida a entrada antes de consultar.
 */
export async function executarFerramenta(nome: string, entrada: unknown, ctx: ContextoIA): Promise<ResultadoFerramenta> {
  const f = POR_NOME.get(nome);
  if (!f) return { ok: false, erro: `Ferramenta "${nome}" não existe.` };
  if (!podeUsar(f, ctx)) return { ok: false, erro: "O perfil deste usuário não tem permissão para esta informação." };
  const parsed = f.entrada.safeParse(entrada ?? {});
  if (!parsed.success) return { ok: false, erro: `Parâmetros inválidos: ${parsed.error.issues.map((x) => x.message).join("; ")}` };
  try {
    return { ok: true, dados: await f.executar(parsed.data, ctx) };
  } catch (e) {
    console.error(`[frivo-ia] ferramenta ${nome} falhou:`, e);
    return { ok: false, erro: "Não foi possível consultar esta informação agora." };
  }
}
