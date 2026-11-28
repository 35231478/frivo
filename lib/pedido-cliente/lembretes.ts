/**
 * PEDIDO DO CLIENTE NO PORTAL + LEMBRETES (PC-2) — a regra pura (servidor, telas, cron e testes).
 *
 * Termos: no PORTAL o cliente vê "Pedido de compra" (o nome que ele usa); no ESCRITÓRIO, "Pedido do cliente".
 *
 * 1. O comprador do cliente vê no portal o que espera o pedido dele e ANEXA o pedido (nº, data, valor, arquivo;
 *    um pedido pode cobrir várias OS). O pedido fica "Pedido recebido — conferir": ainda NÃO libera nada.
 *    O escritório confere e CONFIRMA (aí liga às OS e o faturamento segue) ou RECUSA com o motivo, que o cliente vê.
 * 2. LEMBRETES por e-mail ao contato de compras do cliente, nos dias da régua da empresa (padrão 3, 7 e 15 dias
 *    desde o início da espera), com a lista do que está pendente e o link direto do portal. Cada etapa de cada
 *    item vai uma vez só (a chave única do lembrete); o que já foi resolvido — ou está em conferência — não entra.
 *
 * Leva I.2:
 *  - o pedido do portal cujos serviços se resolveram por outro caminho (outro pedido, liberação, cancelamento,
 *    faturamento) encerra sozinho como RESOLVIDO ("Resolvido por outro meio"), sem pedir nada ao cliente;
 *  - o cliente SEM acesso ao portal (o e-mail de compras não é o login de um contato com portal) recebe outro e-mail:
 *    a lista com o link do relatório de cada OS, pedindo que RESPONDA com o pedido de compra (sem link do portal);
 *  - o pedido do portal RECUSADO vai por e-mail ao cliente, com o motivo.
 */
import { limparMotivo, MOTIVO_MAX, MOTIVO_MIN, reais } from "@/lib/pedido-cliente/regra";

/* ───────── a situação do pedido ───────── */

export const SITUACOES_PEDIDO = ["CONFIRMADO", "CONFERIR", "RECUSADO", "RESOLVIDO"] as const;
export type SituacaoPedidoCliente = (typeof SITUACOES_PEDIDO)[number];
export const ehSituacaoPedido = (v: unknown): v is SituacaoPedidoCliente => typeof v === "string" && (SITUACOES_PEDIDO as readonly string[]).includes(v);

/** No escritório (etiqueta da OS/orçamento, sino, gaveta) */
export const ETIQUETA_CONFERIR = "Pedido recebido — conferir";
/** No portal, a situação de cada pedido de compra enviado */
export const ROTULO_SITUACAO_PORTAL: Record<SituacaoPedidoCliente, string> = {
  CONFERIR: "Recebido — em conferência",
  CONFIRMADO: "Confirmado",
  RECUSADO: "Recusado",
  RESOLVIDO: "Resolvido por outro meio",
};
/** O porquê do "Resolvido por outro meio" (o balão no portal) */
export const DICA_RESOLVIDO_PORTAL = "Os serviços deste pedido foram resolvidos pela equipe por outro caminho (outro pedido, liberação ou cancelamento). Nenhuma ação é necessária.";
export const MSG_PEDIDO_RESOLVIDO = "Este pedido foi encerrado: os serviços dele já não aguardam pedido de compra.";
export const ACAO_TRILHA_RESOLVIDO = "Pedido de compra do portal encerrado (resolvido por outro meio)";

/**
 * O pedido do portal em conferência que nada mais espera: nenhuma das OS/orçamentos que ele cobre aguarda o pedido
 * (`vivos`: os que ainda aguardam). Encerra como RESOLVIDO.
 */
export function resolvidoPorOutroMeio(p: { situacao: string; osPropostas: readonly string[]; orcamentosPropostos: readonly string[] }, vivos: { os: ReadonlySet<string>; orc: ReadonlySet<string> }): boolean {
  if (p.situacao !== "CONFERIR") return false;
  return !p.osPropostas.some((id) => vivos.os.has(id)) && !p.orcamentosPropostos.some((id) => vivos.orc.has(id));
}

export const MSG_MOTIVO_RECUSA = `Escreva o motivo da recusa (de ${MOTIVO_MIN} a ${MOTIVO_MAX} caracteres). O cliente vê este motivo no portal.`;
/** O motivo da recusa segue a mesma régua do motivo da liberação (5 a 300 caracteres) */
export const limparMotivoRecusa = limparMotivo;

/* ───────── quem vê "Pedido de compra" no portal ───────── */

export const PERMISSAO_PEDIDO_PORTAL = "enviarPedidoCompra";
export const MSG_SEM_PERMISSAO_PEDIDO_PORTAL = "Sem permissão para enviar o pedido de compra.";
const mesmoEmail = (a: string | null | undefined, b: string | null | undefined) =>
  !!a?.trim() && !!b?.trim() && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * O contato do portal vê e envia o pedido de compra quando tem a permissão "Enviar pedido de compra" OU é o
 * próprio "Contato de compras" da ficha do cliente (mesmo e-mail): é a pessoa para quem vão os lembretes.
 */
export function podePedidoNoPortal(contato: { permissoes?: Record<string, boolean> | null; email?: string | null }, comprasEmail: string | null | undefined): boolean {
  return contato.permissoes?.[PERMISSAO_PEDIDO_PORTAL] === true || mesmoEmail(contato.email, comprasEmail);
}

/**
 * Leva I.2 — o lembrete leva o link do portal? Só quando o e-mail de compras é o LOGIN de um contato ativo com acesso
 * ao portal (senha criada, cliente com portal ligado) que pode enviar o pedido. Senão, o e-mail "sem portal".
 */
export function compradorTemPortal(p: {
  portalAtivo: boolean; comprasEmail: string | null | undefined;
  contatos: readonly { email: string | null; ativo: boolean; temSenha: boolean; permissoes?: Record<string, boolean> | null }[];
}): boolean {
  if (!p.portalAtivo || !p.comprasEmail?.trim()) return false;
  return p.contatos.some((c) => c.ativo && c.temSenha && mesmoEmail(c.email, p.comprasEmail) && podePedidoNoPortal(c, p.comprasEmail));
}

/* ───────── a régua dos lembretes ───────── */

export const DIAS_LEMBRETE_PADRAO = [3, 7, 15] as const;
export const DIA_LEMBRETE_MAX = 90;
export const ETAPAS_LEMBRETE_MAX = 6;
export const MSG_REGUA = `Informe de 1 a ${ETAPAS_LEMBRETE_MAX} dias, entre 1 e ${DIA_LEMBRETE_MAX}, separados por vírgula (ex.: 3, 7, 15).`;

/**
 * A régua como a empresa escreveu ("3, 7, 15", ou a lista): dias inteiros de 1 a 90, sem repetir, em ordem,
 * até 6 etapas. Qualquer valor fora disso invalida tudo (null) — melhor recusar do que salvar outra régua.
 */
export function lerRegua(v: unknown): number[] | null {
  const partes = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;\s]+/).filter(Boolean) : null;
  if (!partes || !partes.length) return null;
  const dias: number[] = [];
  for (const p of partes) {
    const n = typeof p === "number" ? p : typeof p === "string" && /^\d+$/.test(p.trim()) ? Number(p.trim()) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > DIA_LEMBRETE_MAX) return null;
    dias.push(n);
  }
  const unicos = [...new Set(dias)].sort((a, b) => a - b);
  return unicos.length <= ETAPAS_LEMBRETE_MAX ? unicos : null;
}

/** A régua que vale (a gravada, se for válida; senão a padrão) */
export const reguaEfetiva = (gravada: unknown): number[] => lerRegua(gravada) ?? [...DIAS_LEMBRETE_PADRAO];

/** O texto da régua para a tela ("3, 7 e 15 dias") */
export function textoRegua(dias: readonly number[]): string {
  if (!dias.length) return "";
  const n = dias.map(String);
  return `${n.length > 1 ? `${n.slice(0, -1).join(", ")} e ${n.at(-1)}` : n[0]} dia${dias.length === 1 && dias[0] === 1 ? "" : "s"}`;
}

/** A etapa em que o item está: o maior dia da régua já alcançado (0 = ainda não chegou à 1ª) */
export function etapaAtual(diasEsperando: number, regua: readonly number[]): number {
  let etapa = 0;
  for (const d of regua) if (diasEsperando >= d && d > etapa) etapa = d;
  return etapa;
}

export type TipoItemPedido = "os" | "orcamento";
/** A chave única do lembrete: o mesmo item na mesma etapa só vai uma vez */
export const chaveLembrete = (tipo: TipoItemPedido, id: string, etapa: number) => `${tipo}:${id}:${etapa}`;

/** O item da lista do lembrete (já sabido que está aguardando o pedido e fora de conferência) */
export interface ItemLembrete {
  tipo: TipoItemPedido; id: string; numero: string;
  /** null = a espera ainda não começou (OS de "para faturar" ainda não concluída): não entra no e-mail */
  diasEsperando: number | null;
  concluidoEm: Date | null;
  valor: number;
  /** O relatório da OS (ou o orçamento) pelo link público, sem o domínio (o e-mail "sem portal" leva o link) */
  documento?: string | null;
}

export interface PlanoLembrete {
  /** Os itens que fazem o e-mail sair agora (chegaram a uma etapa ainda não enviada) */
  devidos: { item: ItemLembrete; etapa: number; chave: string }[];
  /** Todos os itens do e-mail (a lista do que está pendente), com a etapa de cada um */
  listados: { item: ItemLembrete; etapa: number; chave: string }[];
}

/**
 * O que um cliente recebe hoje: sai o e-mail se ALGUM item chegou a uma etapa ainda não enviada. O e-mail lista
 * tudo o que está pendente (com a espera já começada), para o comprador resolver de uma vez.
 *  - lembretes desligados (empresa ou cliente), sem e-mail de compras ou sem nada devido: nada sai;
 *  - item que pula etapas (o 1º lembrete no 20º dia) recebe só a etapa maior — nunca três e-mails;
 *  - `enviadas`: as chaves já gravadas (o cron que roda de novo não repete).
 */
export function planejarLembrete(p: {
  empresaAtiva: boolean; clienteAtivo: boolean; email: string | null | undefined; regua: readonly number[];
  itens: ItemLembrete[]; enviadas: ReadonlySet<string>;
}): PlanoLembrete {
  const vazio: PlanoLembrete = { devidos: [], listados: [] };
  if (!p.empresaAtiva || !p.clienteAtivo || !p.email?.trim() || !p.regua.length) return vazio;
  const listados = p.itens
    .filter((i) => i.diasEsperando !== null)
    .map((item) => { const etapa = etapaAtual(item.diasEsperando!, p.regua); return { item, etapa, chave: chaveLembrete(item.tipo, item.id, etapa) }; });
  const devidos = listados.filter((l) => l.etapa > 0 && !p.enviadas.has(l.chave));
  return devidos.length ? { devidos, listados } : vazio;
}

/* ───────── o e-mail ───────── */

export const TIPO_EMAIL_LEMBRETE = "PEDIDO_CLIENTE_LEMBRETE";
/** Leva I.2: o lembrete ao cliente sem acesso ao portal (responder o e-mail com o pedido) */
export const TIPO_EMAIL_LEMBRETE_SEM_PORTAL = "PEDIDO_CLIENTE_LEMBRETE_SEM_PORTAL";
/** Leva I.2: o pedido do portal recusado, com o motivo */
export const TIPO_EMAIL_RECUSADO = "PEDIDO_CLIENTE_RECUSADO";
export const ROTA_PORTAL_PEDIDO = "/portal/pedidos-compra";

const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dataBR = (d: Date) => d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

/** A linha de cada item no e-mail: "OS-1410 · concluída em 19/11/2026 · R$ 1.800,00 · há 9 dias" */
export function linhaItem(i: ItemLembrete): string {
  const partes = [
    i.tipo === "os" ? i.numero : `Orçamento ${i.numero}`,
    i.concluidoEm ? `${i.tipo === "os" ? "concluída" : "aprovado"} em ${dataBR(i.concluidoEm)}` : null,
    i.valor > 0 ? reais(i.valor) : null,
    i.diasEsperando ? `há ${i.diasEsperando} dia${i.diasEsperando === 1 ? "" : "s"}` : null,
  ];
  return partes.filter(Boolean).join(" · ");
}

/** As variáveis do template (o HTML da lista já vem escapado: o número vem do cadastro) */
export function variaveisLembrete(p: { contatoNome: string | null | undefined; clienteNome: string; itens: ItemLembrete[]; link: string }): Record<string, string> {
  const total = p.itens.reduce((s, i) => s + (i.valor || 0), 0);
  return {
    contato_nome: (p.contatoNome ?? "").trim() || "comprador(a)",
    cliente_nome: p.clienteNome,
    quantidade_pendente: String(p.itens.length),
    total_pendente: reais(total),
    lista_pendencias: `<ul>${p.itens.map((i) => `<li>${escapar(linhaItem(i))}</li>`).join("")}</ul>`,
    link_portal: p.link,
  };
}

/**
 * Leva I.2 — as variáveis do lembrete SEM portal: a mesma lista, cada item com o link público do relatório da OS
 * (ou do orçamento) — o cliente abre e imprime/salva em PDF — e nenhum link do portal.
 */
export function variaveisLembreteSemPortal(p: { contatoNome: string | null | undefined; clienteNome: string; itens: ItemLembrete[]; base: string }): Record<string, string> {
  const { link_portal: _semPortal, ...v } = variaveisLembrete({ ...p, link: "" });
  const link = (i: ItemLembrete) => (i.documento ? ` — <a href="${escapar(`${p.base}${i.documento}`)}">${i.tipo === "os" ? "Relatório da OS" : "Orçamento"}</a>` : "");
  return { ...v, lista_pendencias: `<ul>${p.itens.map((i) => `<li>${escapar(linhaItem(i))}${link(i)}</li>`).join("")}</ul>` };
}

/** Leva I.2 — as variáveis do e-mail da recusa (o motivo vem do escritório: escapado) */
export function variaveisRecusa(p: { contatoNome: string | null | undefined; clienteNome: string; numero: string; motivo: string; itens: string[]; link: string }): Record<string, string> {
  return {
    contato_nome: (p.contatoNome ?? "").trim() || "comprador(a)",
    cliente_nome: p.clienteNome,
    numero_pedido: p.numero,
    motivo_recusa: escapar(p.motivo),
    lista_pendencias: p.itens.length ? `<ul>${p.itens.map((i) => `<li>${escapar(i)}</li>`).join("")}</ul>` : "",
    link_portal: p.link,
  };
}
export const ACAO_TRILHA_RECUSA_EMAIL = "Recusa do pedido de compra enviada ao cliente";
export const ACAO_TRILHA_RECUSA_FALHA = "Recusa do pedido de compra não enviada por e-mail";

/** Os destinatários da recusa: o contato que enviou e o e-mail de compras (sem repetir); vazio = nenhum */
export function destinosRecusa(enviadoPor: string | null | undefined, comprasEmail: string | null | undefined): string[] {
  const lista = [enviadoPor, comprasEmail].map((e) => (e ?? "").trim()).filter(Boolean);
  return lista.filter((e, i) => lista.findIndex((x) => x.toLowerCase() === e.toLowerCase()) === i);
}

/** O que fica na trilha da OS (e no evento do orçamento) a cada lembrete */
export const textoTrilhaLembrete = (para: string, etapa: number) =>
  `Enviado a ${para}${etapa > 0 ? ` (lembrete de ${etapa} dia${etapa === 1 ? "" : "s"})` : " (na lista do lembrete)"}`;
export const ACAO_TRILHA_LEMBRETE = "Lembrete do pedido do cliente";

/** "Último lembrete em 24/11/2026" (escritório) */
export const textoUltimoLembrete = (d: Date | null | undefined) => (d ? `Último lembrete em ${dataBR(d)}` : null);
