/**
 * PC-2 — os LEMBRETES do pedido do cliente (a rotina diária, /api/cron/lembretes-pedido). A regra pura está em
 * ./lembretes (planejarLembrete); aqui, o banco e o envio.
 *
 * Por cliente (que exige o pedido, com e-mail de compras e lembretes ligados na empresa e no cliente):
 *  1. o que espera o pedido AGORA (o resolvido — pedido informado, liberado, faturado ou cancelado — já não vem;
 *     o que está em conferência também não);
 *  2. se algum item chegou a uma etapa da régua ainda não enviada, um e-mail ao contato de compras com a lista
 *     de tudo o que está pendente e o link do portal;
 *  3. cada item listado fica em pedidos_cliente_lembretes e na trilha da OS (ou no evento do orçamento).
 *
 * Sem duplicar: antes de enviar, a rotina GRAVA as chaves devidas (chave única "os:<id>:<etapa>"). Se outra rodada
 * já gravou (rodou de novo, ou duas ao mesmo tempo), nada sai. Se o envio falha, as chaves gravadas são apagadas
 * e a próxima rodada tenta de novo.
 */
import { linkDoPortal } from "@/lib/portal/senha-provisoria";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { enviarEmail } from "@/lib/email";
import { autorDoSistema, pendentesDoCliente } from "@/lib/pedido-cliente/portal-server";
import {
  ACAO_TRILHA_LEMBRETE, ROTA_PORTAL_PEDIDO, TIPO_EMAIL_LEMBRETE, chaveLembrete, planejarLembrete, reguaEfetiva, textoTrilhaLembrete,
  variaveisLembrete, type ItemLembrete,
} from "@/lib/pedido-cliente/lembretes";

const baseUrl = () => (process.env.NEXTAUTH_URL || process.env.APP_URL || "").replace(/\/$/, "");

export interface ResumoLembretes { clientes: number; enviados: number; itens: number; erros: number; pulados: number }

type Enviar = typeof enviarEmail;

/** Um cliente: planeja, reserva as chaves, envia e registra. Devolve o que aconteceu. */
export async function lembrarCliente(
  cliente: { id: string; empresaId: string; nome: string; comprasNome: string | null; comprasEmail: string | null; pedidoLembretesAtivo: boolean },
  empresa: { ativo: boolean; regua: number[] },
  agora: Date = new Date(), enviar: Enviar = enviarEmail,
): Promise<"enviado" | "nada" | "ja-enviado" | "erro"> {
  const pendentes = (await pendentesDoCliente(cliente.empresaId, cliente.id, agora)).filter((i) => !i.emConferencia);
  const itens: ItemLembrete[] = pendentes.map((i) => ({ tipo: i.tipo, id: i.id, numero: i.numero, diasEsperando: i.diasEsperando, concluidoEm: i.concluidoEm, valor: i.valor }));
  const candidatas = itens.flatMap((i) => empresa.regua.concat(0).map((e) => chaveLembrete(i.tipo, i.id, e)));
  const enviadas = new Set(candidatas.length
    ? (await prisma.pedidoClienteLembrete.findMany({ where: { chave: { in: candidatas } }, select: { chave: true } })).map((l) => l.chave)
    : []);
  const plano = planejarLembrete({ empresaAtiva: empresa.ativo, clienteAtivo: cliente.pedidoLembretesAtivo, email: cliente.comprasEmail, regua: empresa.regua, itens, enviadas });
  if (!plano.devidos.length) return "nada";

  const para = cliente.comprasEmail!.trim();
  const envio = randomUUID();
  const linha = (l: (typeof plano.listados)[number]) => ({
    empresaId: cliente.empresaId, clienteId: cliente.id, etapa: l.etapa, chave: l.chave, envio, para,
    ordemServicoId: l.item.tipo === "os" ? l.item.id : null, orcamentoId: l.item.tipo === "orcamento" ? l.item.id : null, enviadoEm: agora,
  });
  // A reserva: só quem grava as chaves devidas envia (a chave é única)
  const reservadas = await prisma.pedidoClienteLembrete.createMany({ data: plano.devidos.map(linha), skipDuplicates: true });
  if (!reservadas.count) return "ja-enviado";

  const listados = plano.listados.map((l) => l.item);
  const r = await enviar(cliente.empresaId, {
    tipo: TIPO_EMAIL_LEMBRETE, para,
    variaveis: variaveisLembrete({ contatoNome: cliente.comprasNome, clienteNome: cliente.nome, itens: listados, link: linkDoPortal(baseUrl(), ROTA_PORTAL_PEDIDO) }),
    referenciaId: cliente.id, referenciaTipo: "PEDIDO_CLIENTE_LEMBRETE",
  }).catch((e: unknown) => ({ ok: false, erro: (e as Error)?.message ?? "erro no envio" }));
  if (!r.ok) {
    // não saiu: devolve as chaves para a próxima rodada tentar de novo
    await prisma.pedidoClienteLembrete.deleteMany({ where: { envio } });
    console.error("[lembrete do pedido do cliente] envio falhou", cliente.id, r.erro);
    return "erro";
  }

  // O que foi listado sem estar devido (antes da 1ª etapa, ou numa etapa que já tinha ido) também fica registrado,
  // com a chave deste envio: o "último lembrete" do escritório é o último e-mail em que o item apareceu, e essas
  // linhas nunca seguram uma etapa (a chave da etapa é só a do item devido)
  const devidas = new Set(plano.devidos.map((d) => d.chave));
  const outros = plano.listados.filter((l) => !devidas.has(l.chave));
  if (outros.length) await prisma.pedidoClienteLembrete.createMany({ data: outros.map((l) => ({ ...linha(l), chave: `${l.chave}@${envio}` })), skipDuplicates: true });
  const autor = await autorDoSistema(cliente.empresaId);
  const trilha = (l: (typeof plano.listados)[number]) => textoTrilhaLembrete(para, devidas.has(l.chave) ? l.etapa : 0);
  const os = plano.listados.filter((l) => l.item.tipo === "os");
  const orcs = plano.listados.filter((l) => l.item.tipo === "orcamento");
  if (autor && os.length) await prisma.osHistorico.createMany({ data: os.map((l) => ({ ordemServicoId: l.item.id, usuarioId: autor, acao: ACAO_TRILHA_LEMBRETE, detalhes: trilha(l), criadoEm: agora })) });
  if (orcs.length) await prisma.orcamentoEvento.createMany({ data: orcs.map((l) => ({ empresaId: cliente.empresaId, orcamentoId: l.item.id, tipo: "PEDIDO_CLIENTE", detalhe: `${ACAO_TRILHA_LEMBRETE}: ${trilha(l)}`, usuarioId: autor, criadoEm: agora })) });
  return "enviado";
}

/** A rotina: todas as empresas (ou uma), cliente a cliente; a falha de um não para os outros */
export async function processarLembretesPedido(agora: Date = new Date(), op: { empresaId?: string; enviar?: Enviar } = {}): Promise<ResumoLembretes> {
  const clientes = await prisma.cliente.findMany({
    where: {
      ...(op.empresaId ? { empresaId: op.empresaId } : {}),
      ativo: true, pedidoLembretesAtivo: true, comprasEmail: { not: null },
      // sem a linha de configurações, vale o padrão (ligado)
      empresa: { ativo: true, OR: [{ configuracao: null }, { configuracao: { is: { pedidoLembretesAtivo: true } } }] },
      OR: [{ exigePcAntesNf: true }, { unidades: { some: { exigePedido: { in: ["FATURAR", "EXECUTAR"] } } } }],
    },
    select: { id: true, empresaId: true, nome: true, nomeFantasia: true, comprasNome: true, comprasEmail: true, pedidoLembretesAtivo: true, empresa: { select: { configuracao: { select: { pedidoLembretesAtivo: true, pedidoLembretesDias: true } } } } },
    orderBy: { criadoEm: "asc" }, take: 5000,
  });
  const resumo: ResumoLembretes = { clientes: clientes.length, enviados: 0, itens: 0, erros: 0, pulados: 0 };
  for (const c of clientes) {
    const cfg = c.empresa.configuracao;
    try {
      const r = await lembrarCliente(
        { id: c.id, empresaId: c.empresaId, nome: c.nomeFantasia ?? c.nome, comprasNome: c.comprasNome, comprasEmail: c.comprasEmail, pedidoLembretesAtivo: c.pedidoLembretesAtivo },
        { ativo: cfg?.pedidoLembretesAtivo ?? true, regua: reguaEfetiva(cfg?.pedidoLembretesDias) }, agora, op.enviar,
      );
      if (r === "enviado") resumo.enviados++;
      else if (r === "erro") resumo.erros++;
      else resumo.pulados++;
    } catch (e) {
      resumo.erros++;
      console.error("[lembrete do pedido do cliente] cliente", c.id, (e as Error)?.message);
    }
  }
  resumo.itens = op.empresaId
    ? await prisma.pedidoClienteLembrete.count({ where: { empresaId: op.empresaId, enviadoEm: agora } })
    : await prisma.pedidoClienteLembrete.count({ where: { enviadoEm: agora } });
  return resumo;
}
