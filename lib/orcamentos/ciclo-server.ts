/**
 * Ciclo do orçamento — servidor: linha do tempo (eventos), visualização pelo link público e o
 * aviso ao responsável quando o cliente responde. A empresa vem sempre do orçamento/sessão.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { enviarEmailInterno } from "@/lib/email";
import { montarEmailHtml } from "@/lib/email-templates";
import { formatarData, formatarMoeda } from "@/lib/utils";
import { numeroFormalOrcamento } from "@/lib/orcamentos/proposta";
import { ehRobo } from "@/lib/orcamentos/ciclo";

type Cliente = Prisma.TransactionClient | typeof prisma;

export interface NovoEvento {
  empresaId: string;
  orcamentoId: string;
  tipo: string;
  detalhe?: string | null;
  usuarioId?: string | null;
  ip?: string | null;
}

export function registrarEvento(e: NovoEvento, db: Cliente = prisma) {
  return db.orcamentoEvento.create({
    data: {
      empresaId: e.empresaId, orcamentoId: e.orcamentoId, tipo: e.tipo,
      detalhe: e.detalhe?.slice(0, 500) ?? null, usuarioId: e.usuarioId ?? null, ip: e.ip ?? null,
    },
  });
}

/**
 * O cliente abriu o link: conta a visualização e, na primeira, grava "Visualizado" (data + evento).
 * Só conta orçamento ENVIADO (rascunho/aprovado/recusado não mudam de etapa) e nunca quem é da
 * própria empresa conferindo o link logado (não é o cliente) nem robô de prévia de link.
 */
export async function registrarVisualizacao(
  o: { id: string; empresaId: string; status: string; visualizadoEm: Date | null },
  quem: { empresaIdSessao?: string | null; ip?: string | null; userAgent?: string | null },
) {
  if (o.status !== "ENVIADO") return false;
  if (ehRobo(quem.userAgent)) return false;
  if (quem.empresaIdSessao && quem.empresaIdSessao === o.empresaId) return false;
  const agora = new Date();
  // Primeira vez: grava a data só se ainda estiver vazia (duas abas ao mesmo tempo não duplicam o evento)
  const primeira = !o.visualizadoEm
    ? (await prisma.orcamento.updateMany({ where: { id: o.id, visualizadoEm: null }, data: { visualizadoEm: agora, visualizacoes: { increment: 1 } } })).count === 1
    : false;
  if (primeira) {
    await registrarEvento({ empresaId: o.empresaId, orcamentoId: o.id, tipo: "VISUALIZADO", ip: quem.ip });
  } else {
    await prisma.orcamento.update({ where: { id: o.id }, data: { visualizacoes: { increment: 1 } } });
  }
  return primeira;
}

/**
 * Abrir o orçamento que o cliente respondeu (aprovou/recusou) = resposta vista: sai do sino.
 * Sempre pela empresa da sessão.
 */
export async function marcarRespostaVista(o: { id: string; status: string; respostaVistaEm: Date | null }, empresaId: string) {
  if ((o.status !== "APROVADO" && o.status !== "REPROVADO") || o.respostaVistaEm) return false;
  const r = await prisma.orcamento.updateMany({ where: { id: o.id, empresaId, respostaVistaEm: null }, data: { respostaVistaEm: new Date() } });
  return r.count === 1;
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL || process.env.APP_URL || "").replace(/\/$/, "");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

/**
 * Avisa o responsável (quem criou o orçamento) por e-mail (Resend da empresa) que o cliente
 * aprovou ou recusou. O sino acende sozinho (respostaVistaEm vazio). Falha de e-mail não derruba
 * a resposta do cliente.
 */
export async function avisarResponsavel(orcamentoId: string, resposta: "APROVADO" | "RECUSADO") {
  try {
    const o = await prisma.orcamento.findUnique({
      where: { id: orcamentoId },
      select: {
        id: true, empresaId: true, codigo: true, nome: true, totalGeral: true, assinadoPor: true, recusadoPor: true, recusaMotivo: true,
        criadoPor: { select: { email: true, nome: true, ativo: true } },
        cliente: { select: { nome: true, nomeFantasia: true } },
        empresa: { select: { nome: true, nomeFantasia: true, telefone: true, email: true, site: true, logo: true, endereco: true, cidade: true, estado: true } },
      },
    });
    if (!o?.criadoPor?.email || o.criadoPor.ativo === false) return { ok: false, erro: "Sem responsável com e-mail." };
    const numero = numeroFormalOrcamento(o.codigo);
    const cliente = o.cliente.nomeFantasia ?? o.cliente.nome;
    const aprovou = resposta === "APROVADO";
    const quem = aprovou ? o.assinadoPor : o.recusadoPor;
    const corpo = aprovou
      ? `<p>Olá, <strong>${esc(o.criadoPor.nome)}</strong>.</p><p><strong>${esc(cliente)}</strong> aprovou o orçamento <strong>Nº ${esc(numero)}</strong> (${esc(o.nome)}) no valor de <strong>${formatarMoeda(Number(o.totalGeral))}</strong>${quem ? `, por ${esc(quem)}` : ""}, em ${formatarData(new Date(), "dd/MM/yyyy 'às' HH:mm")}.</p>`
      : `<p>Olá, <strong>${esc(o.criadoPor.nome)}</strong>.</p><p><strong>${esc(cliente)}</strong> recusou o orçamento <strong>Nº ${esc(numero)}</strong> (${esc(o.nome)})${quem ? `, por ${esc(quem)}` : ""}.</p>${o.recusaMotivo ? `<p>Motivo: “${esc(o.recusaMotivo)}”</p>` : ""}`;
    const html = montarEmailHtml({
      empresa: { ...o.empresa, nome: o.empresa.nomeFantasia ?? o.empresa.nome },
      corpoHtml: corpo, botaoLabel: "Abrir o orçamento", botaoUrl: `${baseUrl()}/orcamentos/${o.id}`,
    });
    return await enviarEmailInterno(o.empresaId, o.criadoPor.email, `Orçamento Nº ${numero} ${aprovou ? "aprovado" : "recusado"} — ${cliente}`, html);
  } catch {
    return { ok: false, erro: "Falha ao avisar o responsável." };
  }
}
