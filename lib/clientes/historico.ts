/**
 * Leva H — o HISTÓRICO AUTOMÁTICO do cliente: a linha do tempo do que aconteceu com ele, montada a partir do que
 * o sistema já registra (OS, orçamentos, faturas e pagamentos, pedidos do cliente, o que o cliente fez pelo
 * link/portal, e-mails e lembretes enviados, contratos). As notas manuais antigas ("interações") continuam
 * visíveis, como o tipo "Notas". Regra pura: sem banco (quem busca é ./historico-server).
 */

export const TIPOS_HISTORICO = ["os", "orcamento", "financeiro", "pedido", "portal", "comunicacao", "contrato", "nota"] as const;
export type TipoHistorico = (typeof TIPOS_HISTORICO)[number];

export const ROTULO_TIPO_HISTORICO: Record<TipoHistorico, string> = {
  os: "Ordens de serviço",
  orcamento: "Orçamentos",
  financeiro: "Faturas e pagamentos",
  pedido: "Pedidos do cliente",
  portal: "Ações do cliente",
  comunicacao: "E-mails e lembretes",
  contrato: "Contratos",
  nota: "Notas",
};

export interface EventoCliente {
  /** Único na linha do tempo (fonte + id + o que aconteceu) */
  id: string;
  tipo: TipoHistorico;
  titulo: string;
  detalhe?: string | null;
  quando: Date;
  href?: string | null;
  /** Quem fez (nome da pessoa do escritório); vazio quando foi o cliente ou o sistema */
  autor?: string | null;
}

/** Mais recente primeiro; empate pelo id (estável). Sem data válida, fica de fora. */
export function ordenarEventos<T extends EventoCliente>(eventos: readonly T[]): T[] {
  return eventos
    .filter((e) => e.quando instanceof Date && !Number.isNaN(e.quando.getTime()))
    .sort((a, b) => b.quando.getTime() - a.quando.getTime() || a.id.localeCompare(b.id));
}

/** O mesmo evento vindo de duas fontes (o id é a chave): fica o primeiro. */
export function semRepetidos<T extends EventoCliente>(eventos: readonly T[]): T[] {
  const vistos = new Set<string>();
  return eventos.filter((e) => (vistos.has(e.id) ? false : (vistos.add(e.id), true)));
}

/** "todos" ou um tipo */
export function filtrarEventos<T extends EventoCliente>(eventos: readonly T[], tipo: TipoHistorico | "todos"): T[] {
  return tipo === "todos" ? [...eventos] : eventos.filter((e) => e.tipo === tipo);
}

/** Quantos eventos de cada tipo (os chips do filtro só aparecem para tipos com algo) */
export function contarPorTipo(eventos: readonly EventoCliente[]): Partial<Record<TipoHistorico, number>> {
  const c: Partial<Record<TipoHistorico, number>> = {};
  for (const e of eventos) c[e.tipo] = (c[e.tipo] ?? 0) + 1;
  return c;
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** Agrupado por mês (no fuso de Brasília), na ordem recebida: [{ chave: "2026-11", rotulo: "Novembro de 2026", eventos }] */
export function agruparPorMes<T extends EventoCliente>(eventos: readonly T[]): { chave: string; rotulo: string; eventos: T[] }[] {
  const grupos: { chave: string; rotulo: string; eventos: T[] }[] = [];
  for (const e of eventos) {
    const br = new Date(e.quando.getTime() - 3 * 3600_000); // Brasília (UTC−3), sem horário de verão
    const ano = br.getUTCFullYear(), mes = br.getUTCMonth();
    const chave = `${ano}-${String(mes + 1).padStart(2, "0")}`;
    let g = grupos[grupos.length - 1];
    if (!g || g.chave !== chave) { g = { chave, rotulo: `${MESES[mes]} de ${ano}`, eventos: [] }; grupos.push(g); }
    g.eventos.push(e);
  }
  return grupos;
}

/** A linha do tempo pronta: sem repetidos, ordenada e cortada no limite (as mais recentes ficam). */
export function montarHistorico<T extends EventoCliente>(eventos: readonly T[], limite = 300): T[] {
  return ordenarEventos(semRepetidos(eventos)).slice(0, limite);
}

/** Rótulos das notas antigas (InteracaoCliente.tipo) */
export const ROTULO_NOTA: Record<string, string> = { LIGACAO: "Ligação", VISITA: "Visita", EMAIL: "E-mail", WHATSAPP: "WhatsApp", REUNIAO: "Reunião" };
