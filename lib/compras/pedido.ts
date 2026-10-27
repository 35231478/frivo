/**
 * Pedido de Compra (PCI) — regras puras (servidor, tela e testes usam as mesmas):
 * ciclo de status automático, quando dá para editar, número, histórico das edições, origem
 * (OS/orçamento/avulso), quem pode ver/editar e o texto da última compra do produto.
 *
 *   Solicitado → Em cotação (ao baixar OU enviar o PC) → Parcial / Concluída (a NF casou parte /
 *   todos os itens) | Cancelada. "Comprado" e "Entregue" são legados (o SQL migra).
 */
import { pode, type Permissoes } from "@/lib/permissoes";

export type StatusPedido = "SOLICITADO" | "COTANDO" | "PARCIAL" | "CONCLUIDO" | "CANCELADO" | "COMPRADO" | "ENTREGUE";

/** O ciclo, na ordem (filtro da lista e trilha da tela) */
export const CICLO_PEDIDO: StatusPedido[] = ["SOLICITADO", "COTANDO", "PARCIAL", "CONCLUIDO", "CANCELADO"];

export const LABEL_STATUS_PEDIDO: Record<StatusPedido, string> = {
  SOLICITADO: "Solicitado",
  COTANDO: "Em cotação",
  PARCIAL: "Parcial",
  CONCLUIDO: "Concluída",
  CANCELADO: "Cancelada",
  COMPRADO: "Comprado",
  ENTREGUE: "Entregue",
};

export const CLASSE_STATUS_PEDIDO: Record<StatusPedido, string> = {
  SOLICITADO: "badge-base bg-primary-50 text-primary-700",
  COTANDO: "badge-base bg-atencao-claro text-atencao-texto",
  PARCIAL: "badge-base bg-acento-claro text-acento",
  CONCLUIDO: "badge-base bg-success-50 text-success-700",
  CANCELADO: "badge-base bg-surface-linha text-ink-muted",
  COMPRADO: "badge-base bg-acento-claro text-acento-hover",
  ENTREGUE: "badge-base bg-success-50 text-success-700",
};

/** Encerrado: não edita, não envia, não cancela */
export const pedidoEncerrado = (status: string) => status === "CONCLUIDO" || status === "CANCELADO" || status === "ENTREGUE";

/** Editar itens, prazo, comprador, fornecedor e observação: até concluir ou cancelar */
export const pedidoEditavel = (status: string) => !pedidoEncerrado(status);

/** Baixar ou enviar o PC ao fornecedor: o pedido solicitado passa a "Em cotação"; os outros ficam */
export const statusAposEnvio = (status: string): string => (status === "SOLICITADO" ? "COTANDO" : status);

/** "PCI-2026-0147" (4 dígitos; cresce depois de 9999) */
export function codigoPedidoCompra(ano: number, sequencial: number): string {
  return `PCI-${ano}-${String(sequencial).padStart(4, "0")}`;
}

/** PC avulso (sem OS/orçamento): o motivo padrão */
export const MOTIVO_AVULSO_PADRAO = "Reposição de estoque";

// ───────────────────────── Origem ─────────────────────────

export interface OrigemEntrada {
  ordemServico?: { id: string; numero: string } | null;
  orcamento?: { id: string; codigo: string; ordensServico?: { id: string; numero: string }[] | null } | null;
}
export interface Origem {
  tipo: "OS" | "ORCAMENTO" | "AVULSO";
  os: { id: string; numero: string } | null;
  orcamento: { id: string; codigo: string } | null;
}

/**
 * De onde veio o pedido: direto de uma OS → a OS; de um orçamento que está dentro de uma OS → a OS
 * (e o orçamento); de um orçamento solto → o orçamento; nada → avulso.
 */
export function origemDoPedido(p: OrigemEntrada): Origem {
  const orc = p.orcamento ? { id: p.orcamento.id, codigo: p.orcamento.codigo } : null;
  const os = p.ordemServico ?? p.orcamento?.ordensServico?.[0] ?? null;
  if (os) return { tipo: "OS", os: { id: os.id, numero: os.numero }, orcamento: orc };
  if (orc) return { tipo: "ORCAMENTO", os: null, orcamento: orc };
  return { tipo: "AVULSO", os: null, orcamento: null };
}

// ───────────────────────── Permissões ─────────────────────────

export interface UsuarioPedido { id: string; role?: string; permissoes?: unknown }
export interface PedidoAcesso {
  ordemServicoId: string | null;
  orcamentoId: string | null;
  compradorId: string | null;
  solicitanteId?: string | null;
}

/**
 * Ver: Compras, o comprador designado, quem pediu (recebe o aviso quando a NF chega) ou quem vê a
 * OS/orçamento de origem
 */
export function podeVerPedido(user: UsuarioPedido, pedido: PedidoAcesso): boolean {
  const p = user.permissoes as Permissoes;
  return pode(p, "compras", "visualizar", user.role)
    || pedido.compradorId === user.id
    || (!!pedido.solicitanteId && pedido.solicitanteId === user.id)
    || (!!pedido.ordemServicoId && pode(p, "ordens", "visualizar", user.role))
    || (!!pedido.orcamentoId && pode(p, "orcamentos", "visualizar", user.role));
}

/** Baixar/enviar o PC ao fornecedor: quem tem Compras ou o comprador designado (recebeu o aviso) */
export function podeEnviarPedido(user: UsuarioPedido, pedido: PedidoAcesso): boolean {
  return pode(user.permissoes as Permissoes, "compras", "visualizar", user.role) || pedido.compradorId === user.id;
}

/**
 * Editar/cancelar: Compras › Gerenciar, o comprador designado, quem pediu, ou quem edita a
 * OS/orçamento de origem. O status (encerrado) é conferido à parte.
 */
export function podeEditarPedido(user: UsuarioPedido, pedido: PedidoAcesso): boolean {
  const p = user.permissoes as Permissoes;
  return pode(p, "compras", "gerenciar", user.role)
    || pedido.compradorId === user.id
    || (!!pedido.solicitanteId && pedido.solicitanteId === user.id)
    || (!!pedido.ordemServicoId && pode(p, "ordens", "editar", user.role))
    || (!!pedido.orcamentoId && pode(p, "orcamentos", "editar", user.role));
}

/** Comprador responsável: só quem tem Compras */
export const temAcessoCompras = (u: { role?: string | null; permissoes?: unknown }) =>
  pode(u.permissoes as Permissoes, "compras", "visualizar", u.role ?? undefined);

// ───────────────────────── Histórico da edição ─────────────────────────

export interface ItemComparavel { id?: string | null; produtoId?: string | null; descricao: string; quantidade: number; unidade: string }
export interface PedidoComparavel {
  prazoNecessario: string | null; // "AAAA-MM-DD"
  compradorNome: string | null;
  fornecedorNome: string | null;
  observacao: string | null;
  /** Só no PC avulso */
  motivo?: string | null;
  itens: ItemComparavel[];
}

const num = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
const dataBR = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const t = (v: string | null | undefined) => (v ?? "").trim();

/** O que mudou numa edição, uma linha por mudança (vai para o histórico). Vazio = nada mudou. */
export function mudancasPedido(antes: PedidoComparavel, depois: PedidoComparavel): string[] {
  const m: string[] = [];
  if ((antes.prazoNecessario ?? null) !== (depois.prazoNecessario ?? null)) m.push(`Prazo necessário: ${dataBR(antes.prazoNecessario)} → ${dataBR(depois.prazoNecessario)}`);
  if (t(antes.compradorNome) !== t(depois.compradorNome)) m.push(`Comprador: ${t(antes.compradorNome) || "—"} → ${t(depois.compradorNome) || "—"}`);
  if (t(antes.fornecedorNome) !== t(depois.fornecedorNome)) m.push(`Fornecedor: ${t(antes.fornecedorNome) || "—"} → ${t(depois.fornecedorNome) || "—"}`);
  if (t(antes.observacao) !== t(depois.observacao)) m.push(t(depois.observacao) ? "Observação alterada" : "Observação removida");
  if (t(antes.motivo) !== t(depois.motivo)) m.push(`Motivo: ${t(antes.motivo) || "—"} → ${t(depois.motivo) || "—"}`);

  const porId = new Map(antes.itens.filter((i) => i.id).map((i) => [i.id!, i]));
  const mantidos = new Set<string>();
  for (const d of depois.itens) {
    const a = d.id ? porId.get(d.id) : undefined;
    if (!a) { m.push(`Item adicionado: ${d.descricao} (${num(d.quantidade)} ${d.unidade})`); continue; }
    mantidos.add(a.id!);
    if (t(a.descricao) !== t(d.descricao) || (a.produtoId ?? null) !== (d.produtoId ?? null)) m.push(`Item alterado: ${a.descricao} → ${d.descricao}`);
    if (a.quantidade !== d.quantidade || t(a.unidade) !== t(d.unidade)) m.push(`Quantidade de ${d.descricao}: ${num(a.quantidade)} ${a.unidade} → ${num(d.quantidade)} ${d.unidade}`);
  }
  for (const a of antes.itens) if (a.id && !mantidos.has(a.id)) m.push(`Item removido: ${a.descricao}`);
  return m;
}

// ───────────────────────── Última compra (dica do valor estimado) ─────────────────────────

export interface UltimaCompra { valorUnitario: number; fornecedor: string | null; data: string | Date }

/** "Última compra: R$ 18,45 — Frigelar — 15/10/2026" */
export function textoUltimaCompra(u: UltimaCompra, fmt: { moeda: (n: number) => string; data: (d: string | Date) => string }): string {
  return ["Última compra: " + fmt.moeda(u.valorUnitario), u.fornecedor, fmt.data(u.data)].filter(Boolean).join(" — ");
}

/** Valor sugerido para o estimado: o da última compra arredondado a centavos, "18,45" (vazio sem histórico) */
export const valorSugerido = (u: UltimaCompra | null | undefined): string =>
  u && Number.isFinite(u.valorUnitario) && u.valorUnitario > 0 ? (Math.round(u.valorUnitario * 100) / 100).toFixed(2).replace(".", ",") : "";

// ───────────────────────── Envio ao fornecedor ─────────────────────────

export type CanalEnvioPedido = "BAIXAR" | "EMAIL" | "WHATSAPP";

export const ROTULO_EVENTO_PEDIDO: Record<string, string> = {
  CRIADO: "Pedido criado",
  EDITADO: "Pedido editado",
  BAIXADO: "PDF baixado",
  ENVIADO_EMAIL: "Enviado ao fornecedor por e-mail",
  ENVIADO_WHATSAPP: "Enviado ao fornecedor por WhatsApp",
  STATUS: "Status alterado",
  CANCELADO: "Pedido cancelado",
  NF_VINCULADA: "NF vinculada",
  NF_DESVINCULADA: "NF desvinculada",
};

/** Vincular/desvincular NF ao pedido (confirmar a sugestão, desfazer): Compras › gerenciar */
export const podeVincularNf = (user: Pick<UsuarioPedido, "role" | "permissoes">) =>
  pode(user.permissoes as Permissoes, "compras", "gerenciar", user.role);

/** Mensagem do WhatsApp para o fornecedor (com o link do PC) */
export function mensagemFornecedor(p: { numero: string; empresa: string; contato?: string | null; prazo?: string | null; link: string }): string {
  const ola = p.contato ? `Olá, ${p.contato.split(" ")[0]}!` : "Olá!";
  return `${ola} Segue o Pedido de Compra Nº ${p.numero} de ${p.empresa} para cotação${p.prazo ? ` (necessário até ${p.prazo})` : ""}:\n${p.link}\n\nPor favor, informe preço, validade e prazo de entrega.`;
}

// ───────────────────────── O pedido na tela (JSON da API e props da página) ─────────────────────────

export interface ItemPedidoTela {
  id: string; produtoId: string | null; produtoNome: string | null; descricao: string;
  quantidade: number; unidade: string; valorEstimado: number | null; valorReal: number | null;
  /** já recebido pelas NFs vinculadas (unidade do produto) */
  recebido: number;
}
/** Uma NF vinculada ao pedido e o que ela trouxe de cada item */
export interface NotaDoPedidoTela {
  notaId: string; numero: string; emitente: string; dataEmissao: string; automatico: boolean;
  itens: { descricao: string; quantidade: number; unidade: string }[];
}
export interface EventoPedidoTela { id: string; tipo: string; detalhe: string | null; criadoEm: string; usuarioNome: string | null }
export interface PedidoTela {
  id: string; numero: string; status: StatusPedido; statusEm: string; criadoEm: string;
  /** "AAAA-MM-DD" */
  prazoNecessario: string | null;
  observacao: string | null; motivo: string | null; tokenPublico: string;
  solicitante: { id: string; nome: string };
  comprador: { id: string; nome: string } | null;
  fornecedor: { id: string; nome: string; email: string | null; telefone: string | null; ativo: boolean } | null;
  origem: Origem;
  itens: ItemPedidoTela[];
  eventos: EventoPedidoTela[];
  notas: NotaDoPedidoTela[];
  podeEditar: boolean;
  podeEnviar: boolean;
  /** Compras › gerenciar: desfazer o vínculo de uma NF */
  podeDesvincular: boolean;
}

/** Total estimado (quantidade × valor estimado; itens sem estimativa não contam) */
export const totalEstimadoPedido = (itens: Pick<ItemPedidoTela, "quantidade" | "valorEstimado">[]) =>
  Math.round(itens.reduce((s, i) => s + (i.valorEstimado ?? 0) * i.quantidade, 0) * 100) / 100;

/** O que falta para enviar ao fornecedor por um canal (null = pode). Baixar não precisa de contato. */
export function faltaParaEnviar(canal: CanalEnvioPedido, fornecedor: PedidoTela["fornecedor"]): string | null {
  if (canal === "BAIXAR") return null;
  if (!fornecedor) return "Escolha o fornecedor do pedido para enviar.";
  if (canal === "EMAIL" && !fornecedor.email?.trim()) return `O fornecedor ${fornecedor.nome} não tem e-mail no cadastro.`;
  if (canal === "WHATSAPP" && !fornecedor.telefone?.trim()) return `O fornecedor ${fornecedor.nome} não tem telefone no cadastro.`;
  return null;
}
