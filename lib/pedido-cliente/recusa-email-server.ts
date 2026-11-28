/**
 * Leva I.2 — o e-mail ao cliente quando o pedido de compra do portal é RECUSADO, com o motivo. Vai ao contato que
 * enviou o pedido e ao e-mail de compras da ficha (sem repetir). Nunca derruba a recusa: sem e-mail configurado, sem
 * destinatário ou com o envio falhando, a falha fica na trilha da OS (e no log), como o lembrete faz.
 */
import { prisma } from "@/lib/prisma";
import { enviarEmail } from "@/lib/email";
import { linkDoPortal } from "@/lib/portal/senha-provisoria";
import {
  ACAO_TRILHA_RECUSA_EMAIL, ACAO_TRILHA_RECUSA_FALHA, ROTA_PORTAL_PEDIDO, TIPO_EMAIL_RECUSADO, destinosRecusa, variaveisRecusa,
} from "@/lib/pedido-cliente/lembretes";

const baseUrl = () => (process.env.NEXTAUTH_URL || process.env.APP_URL || "").replace(/\/$/, "");

export interface ResultadoEmailRecusa { ok: boolean; para?: string[]; erro?: string }

export async function avisarRecusaPorEmail(empresaId: string, pedidoId: string, usuarioId: string): Promise<ResultadoEmailRecusa> {
  const p = await prisma.pedidoCliente.findFirst({
    where: { id: pedidoId, empresaId, situacao: "RECUSADO" },
    select: {
      numero: true, motivoRecusa: true, clienteId: true, osPropostas: true, orcamentosPropostos: true, enviadoPorContatoId: true,
      cliente: { select: { nome: true, nomeFantasia: true, comprasNome: true, comprasEmail: true } },
    },
  });
  if (!p) return { ok: false, erro: "Pedido não encontrado." };
  const [contato, oss, orcs] = await Promise.all([
    p.enviadoPorContatoId ? prisma.contatoCliente.findFirst({ where: { id: p.enviadoPorContatoId, clienteId: p.clienteId, empresaId, ativo: true }, select: { nome: true, email: true } }) : null,
    p.osPropostas.length ? prisma.ordemServico.findMany({ where: { id: { in: p.osPropostas }, empresaId, clienteId: p.clienteId }, select: { id: true, numero: true } }) : [],
    p.orcamentosPropostos.length ? prisma.orcamento.findMany({ where: { id: { in: p.orcamentosPropostos }, empresaId, clienteId: p.clienteId }, select: { codigo: true } }) : [],
  ]);
  const para = destinosRecusa(contato?.email, p.cliente.comprasEmail);
  let r: ResultadoEmailRecusa;
  if (!para.length) r = { ok: false, erro: "Cliente sem e-mail de compras e contato sem e-mail." };
  else {
    const env = await enviarEmail(empresaId, {
      tipo: TIPO_EMAIL_RECUSADO, para,
      variaveis: variaveisRecusa({
        contatoNome: contato?.nome ?? p.cliente.comprasNome, clienteNome: p.cliente.nomeFantasia ?? p.cliente.nome, numero: p.numero,
        motivo: p.motivoRecusa ?? "", itens: [...oss.map((o) => o.numero), ...orcs.map((o) => `Orçamento ${o.codigo}`)],
        link: linkDoPortal(baseUrl(), ROTA_PORTAL_PEDIDO),
      }),
      referenciaId: pedidoId, referenciaTipo: "PEDIDO_CLIENTE_RECUSADO",
    }).catch((e: unknown) => ({ ok: false, erro: (e as Error)?.message ?? "erro no envio" }));
    r = env.ok ? { ok: true, para } : { ok: false, para, erro: env.erro ?? "erro no envio" };
  }
  if (!r.ok) console.error("[recusa do pedido do cliente] e-mail não enviado", pedidoId, r.erro);
  if (oss.length) {
    await prisma.osHistorico.createMany({ data: oss.map((o) => ({
      ordemServicoId: o.id, usuarioId, acao: r.ok ? ACAO_TRILHA_RECUSA_EMAIL : ACAO_TRILHA_RECUSA_FALHA,
      detalhes: (r.ok ? `Enviado a ${para.join(", ")}` : `nº ${p.numero} · ${r.erro}`).slice(0, 1000),
    })) }).catch(() => null);
  }
  return r;
}
