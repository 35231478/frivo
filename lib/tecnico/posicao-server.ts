/**
 * Posição do técnico — o lado do SERVIDOR (Operações › Mapa).
 *
 * CONSENTIMENTO: tudo passa por "Rastrear localização dos técnicos" (Equipes › App do colaborador),
 * desligado por padrão. Desligado, `registrarPosicoes` não grava nada (mesmo que um app antigo ou
 * mal-intencionado envie) e `posicoesDoMapa` não devolve posição nenhuma.
 *
 * Só a ÚLTIMA leitura de cada técnico fica guardada (`tecnico_posicoes`, uma linha por técnico). O
 * lote pode trazer várias — a fila de quem ficou sem sinal, ou o app nativo no futuro: vale a mais
 * nova, e ela só entra se for mais nova que a que já está lá.
 */
import { prisma } from "@/lib/prisma";
import { chaveDiaBR, diaCivilDeChave } from "@/lib/fuso";
import { carregarConfigApp } from "@/lib/tecnico/config-app-server";
import { horarioDoToque } from "@/lib/tecnico/aviso-cliente";
import { maisNova, type EnvioPosicoes, type OsNoMapa, type RespostaMapa, type TecnicoNoMapa } from "@/lib/tecnico/posicao";

export interface ResultadoPosicao {
  /** O rastreamento está ligado na empresa? (o app usa para parar de capturar quando desligam) */
  rastreio: boolean;
  /** A leitura virou a última posição do técnico? (false também quando já havia uma mais nova) */
  gravada: boolean;
}

/**
 * Recebe as leituras de um técnico e guarda a mais nova, se for mais nova que a guardada.
 * O horário vem do relógio do APARELHO; o atraso (leitura → envio) é medido no próprio aparelho, então
 * um relógio errado não joga a posição para o futuro nem para o passado (mesma conta do "Cheguei").
 */
export async function registrarPosicoes(
  ator: { empresaId: string; tecnicoId: string; usuarioId: string | null },
  envio: EnvioPosicoes, agora: Date = new Date(),
): Promise<ResultadoPosicao> {
  const config = await carregarConfigApp(ator.empresaId);
  if (!config.rastrearLocalizacao) return { rastreio: false, gravada: false };

  const leitura = maisNova(envio.posicoes);
  if (!leitura) return { rastreio: true, gravada: false };
  const { registradoEm } = horarioDoToque(leitura.em, agora.getTime(), envio.agora);
  const dados = {
    latitude: leitura.lat, longitude: leitura.lng, precisaoM: leitura.precisao ?? null,
    bateria: leitura.bateria ?? null, carregando: leitura.carregando ?? null,
    registradoEm, recebidoEm: agora, motivo: leitura.motivo, origem: envio.origem ?? "PWA", usuarioId: ator.usuarioId,
  };

  // Atualiza só se a leitura for MAIS NOVA que a guardada (condição no próprio UPDATE: dois envios
  // juntos não se atropelam). Sem linha ainda, cria; se outro envio criou no meio, tenta de novo.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { count } = await prisma.tecnicoPosicao.updateMany({ where: { tecnicoId: ator.tecnicoId, registradoEm: { lt: registradoEm } }, data: dados });
    if (count) return { rastreio: true, gravada: true };
    const criada = await prisma.tecnicoPosicao.createMany({ data: [{ empresaId: ator.empresaId, tecnicoId: ator.tecnicoId, ...dados }], skipDuplicates: true });
    if (criada.count) return { rastreio: true, gravada: true };
    // Já existe uma linha e ela não é mais antiga que esta leitura: fica a que está
    const atual = await prisma.tecnicoPosicao.findUnique({ where: { tecnicoId: ator.tecnicoId }, select: { registradoEm: true } });
    if (atual && atual.registradoEm >= registradoEm) break;
  }
  return { rastreio: true, gravada: false };
}

/**
 * A OS em que cada técnico está: a atividade EM ANDAMENTO dele (responsável ou na composição) mexida
 * por último; sem nenhuma, a atividade em que ele tocou "Cheguei" hoje (está no local, ainda não começou).
 */
async function osDosTecnicos(empresaId: string, tecnicoIds: string[], agora: Date): Promise<Map<string, OsNoMapa>> {
  const porTecnico = new Map<string, OsNoMapa>();
  if (!tecnicoIds.length) return porTecnico;
  const select = {
    id: true, titulo: true, tecnicoId: true, tecnicosEquipe: { select: { tecnicoId: true } },
    ordemServico: { select: { id: true, numero: true, cliente: { select: { nome: true, nomeFantasia: true } } } },
  } as const;
  const dosTecnicos = { OR: [{ tecnicoId: { in: tecnicoIds } }, { tecnicosEquipe: { some: { tecnicoId: { in: tecnicoIds } } } }] };
  const [emAndamento, noLocal] = await Promise.all([
    prisma.atividadeOs.findMany({ where: { empresaId, status: "EM_ANDAMENTO", ...dosTecnicos }, orderBy: { atualizadoEm: "desc" }, take: 500, select }),
    prisma.atividadeOs.findMany({
      where: { empresaId, status: "AGENDADA", ...dosTecnicos, avisosCliente: { some: { evento: "CHEGOU", dia: diaCivilDeChave(chaveDiaBR(agora))! } } },
      orderBy: { atualizadoEm: "desc" }, take: 500, select,
    }),
  ]);
  const marcar = (lista: typeof emAndamento, situacao: OsNoMapa["situacao"]) => {
    for (const a of lista) {
      const os = a.ordemServico;
      const info: OsNoMapa = { osId: os.id, numero: os.numero, atividadeId: a.id, titulo: a.titulo, cliente: (os.cliente.nomeFantasia ?? "").trim() || os.cliente.nome, situacao };
      for (const id of [a.tecnicoId, ...a.tecnicosEquipe.map((t) => t.tecnicoId)]) if (id && tecnicoIds.includes(id) && !porTecnico.has(id)) porTecnico.set(id, info);
    }
  };
  marcar(emAndamento, "EM_ANDAMENTO"); // em andamento tem prioridade
  marcar(noLocal, "NO_LOCAL");
  return porTecnico;
}

/**
 * O que o mapa mostra: os técnicos de CAMPO ativos da empresa, cada um com a última posição (ou sem —
 * vão para a lista "sem localização") e a OS em que está. Rastreamento desligado: lista vazia.
 */
export async function posicoesDoMapa(empresaId: string, agora: Date = new Date()): Promise<RespostaMapa> {
  const geradoEm = agora.toISOString();
  const config = await carregarConfigApp(empresaId);
  if (!config.rastrearLocalizacao) return { rastreio: false, tecnicos: [], geradoEm };

  const tecnicos = await prisma.tecnico.findMany({
    where: { empresaId, ativo: true, tipoEquipe: "CAMPO" },
    orderBy: { nome: "asc" },
    take: 1000,
    select: {
      id: true, nome: true,
      posicao: { select: { latitude: true, longitude: true, precisaoM: true, bateria: true, carregando: true, registradoEm: true, motivo: true, origem: true } },
    },
  });
  const os = await osDosTecnicos(empresaId, tecnicos.map((t) => t.id), agora);
  const lista: TecnicoNoMapa[] = tecnicos.map((t) => ({
    id: t.id, nome: t.nome, os: os.get(t.id) ?? null,
    posicao: t.posicao && {
      lat: t.posicao.latitude, lng: t.posicao.longitude, precisaoM: t.posicao.precisaoM,
      bateria: t.posicao.bateria, carregando: t.posicao.carregando,
      registradoEm: t.posicao.registradoEm.toISOString(), motivo: t.posicao.motivo, origem: t.posicao.origem,
    },
  }));
  return { rastreio: true, tecnicos: lista, geradoEm };
}
