/**
 * Ciclo do orçamento — regra pura (tela, lista, link público e servidor usam a mesma):
 *
 *   Rascunho → Enviado → Visualizado → Aprovado / Recusado / Expirado   (+ Cancelado, Convertido)
 *
 * O status GRAVADO continua o de sempre (RASCUNHO, ENVIADO, APROVADO, REPROVADO, CANCELADO,
 * CONVERTIDA). "Visualizado" e "Expirado" são DERIVADOS de um orçamento ENVIADO:
 *  - Visualizado: o cliente abriu o link (visualizadoEm);
 *  - Expirado: passou o dia da validade (dia civil, Brasília) sem resposta.
 * Assim nada do que já filtra por ENVIADO (lembretes, aprovação, ações em massa) muda, e "Expirado"
 * é sempre exato (não depende de uma rotina rodar).
 */
import { diaCivilPassou } from "@/lib/fuso";

export type EtapaCiclo =
  | "RASCUNHO" | "ENVIADO" | "VISUALIZADO" | "APROVADO" | "RECUSADO" | "EXPIRADO" | "CANCELADO" | "CONVERTIDO";

export const ETAPAS_CICLO: EtapaCiclo[] = ["RASCUNHO", "ENVIADO", "VISUALIZADO", "APROVADO", "RECUSADO", "EXPIRADO", "CANCELADO", "CONVERTIDO"];

export const LABELS_ETAPA: Record<EtapaCiclo, string> = {
  RASCUNHO: "Rascunho",
  ENVIADO: "Enviado",
  VISUALIZADO: "Visualizado",
  APROVADO: "Aprovado",
  RECUSADO: "Recusado",
  EXPIRADO: "Expirado",
  CANCELADO: "Cancelado",
  CONVERTIDO: "Convertido",
};

/** Pílula de cada etapa (tokens da identidade: neutro, acento, OK, atenção, atrasado) */
export const CLASSE_ETAPA: Record<EtapaCiclo, string> = {
  RASCUNHO: "badge-orc-rascunho",
  ENVIADO: "badge-orc-enviado",
  VISUALIZADO: "badge-base bg-acento-claro text-acento",
  APROVADO: "badge-orc-aprovado",
  RECUSADO: "badge-orc-reprovado",
  EXPIRADO: "badge-base bg-atencao-claro text-atencao-texto",
  CANCELADO: "badge-orc-cancelado",
  CONVERTIDO: "badge-base bg-primary-50 text-primary-700",
};

export interface OrcamentoCiclo {
  status: string;
  validadeEm?: Date | string | null;
  criadoEm?: Date | string | null;
  enviadoEm?: Date | string | null;
  visualizadoEm?: Date | string | null;
  visualizacoes?: number | null;
  assinadoEm?: Date | string | null;
  assinadoPor?: string | null;
  aprovadoIp?: string | null;
  recusadoEm?: Date | string | null;
  recusadoPor?: string | null;
  recusaMotivo?: string | null;
}

/** Etapa do ciclo que a tela mostra, a partir do status gravado e das datas. */
export function etapaCiclo(o: OrcamentoCiclo, agora: Date = new Date()): EtapaCiclo {
  switch (o.status) {
    case "RASCUNHO": return "RASCUNHO";
    case "APROVADO": return "APROVADO";
    case "REPROVADO": return "RECUSADO";
    case "CANCELADO": return "CANCELADO";
    case "CONVERTIDA": return "CONVERTIDO";
    case "ENVIADO":
      if (diaCivilPassou(o.validadeEm ?? null, agora)) return "EXPIRADO";
      return o.visualizadoEm ? "VISUALIZADO" : "ENVIADO";
    default: return "RASCUNHO";
  }
}

/** O cliente ainda pode aprovar ou recusar pelo link (enviado e dentro da validade). */
export function podeResponder(o: OrcamentoCiclo, agora: Date = new Date()): boolean {
  return o.status === "ENVIADO" && !diaCivilPassou(o.validadeEm ?? null, agora);
}

export const MSG_ENVIO_ENCERRADO = "Orçamento já encerrado, não é possível reenviar";
export const MSG_ENVIO_VENCIDO = "A validade deste orçamento já venceu. Volte para rascunho, ajuste a validade e envie de novo.";

/**
 * Por que a proposta não pode ser enviada agora (null = pode): encerrado (aprovado, cancelado,
 * convertido) ou validade vencida. A rota de envio e os ícones da lista usam a mesma regra.
 */
export function bloqueioEnvio(o: OrcamentoCiclo, agora: Date = new Date()): string | null {
  if (o.status === "APROVADO" || o.status === "CANCELADO" || o.status === "CONVERTIDA") return MSG_ENVIO_ENCERRADO;
  if (diaCivilPassou(o.validadeEm ?? null, agora)) return MSG_ENVIO_VENCIDO;
  return null;
}

/** Dia seguinte ao último dia da validade (quando virou "Expirado"), como dia civil "AAAA-MM-DD". */
function diaSeguinte(d: Date | string): Date {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate() + 1));
}

export interface MarcoCiclo {
  etapa: EtapaCiclo | "CRIADO";
  rotulo: string;
  em: Date;
  /** Quem / de onde / por quê (texto curto) */
  detalhe: string | null;
}

/**
 * Os marcos com data de cada transição, em ordem: criado, enviado, visualizado (com quantas vezes),
 * aprovado (por quem, IP) ou recusado (por quem, motivo) ou expirado (dia em que venceu).
 */
export function marcosCiclo(o: OrcamentoCiclo, agora: Date = new Date()): MarcoCiclo[] {
  const m: MarcoCiclo[] = [];
  const d = (v: Date | string | null | undefined) => (v ? new Date(v) : null);
  const criado = d(o.criadoEm);
  if (criado) m.push({ etapa: "CRIADO", rotulo: "Criado", em: criado, detalhe: null });
  const enviado = d(o.enviadoEm);
  if (enviado) m.push({ etapa: "ENVIADO", rotulo: "Enviado", em: enviado, detalhe: null });
  const visto = d(o.visualizadoEm);
  if (visto) {
    const n = o.visualizacoes ?? 0;
    m.push({ etapa: "VISUALIZADO", rotulo: "Visualizado pelo cliente", em: visto, detalhe: n > 1 ? `aberto ${n} vezes` : null });
  }
  const aprovado = d(o.assinadoEm);
  if (aprovado && (o.status === "APROVADO" || o.status === "CONVERTIDA")) {
    m.push({ etapa: "APROVADO", rotulo: "Aprovado", em: aprovado, detalhe: [o.assinadoPor, o.aprovadoIp && `IP ${o.aprovadoIp}`].filter(Boolean).join(" · ") || null });
  }
  const recusado = d(o.recusadoEm);
  if (recusado && o.status === "REPROVADO") {
    m.push({ etapa: "RECUSADO", rotulo: "Recusado", em: recusado, detalhe: [o.recusadoPor, o.recusaMotivo && `“${o.recusaMotivo}”`].filter(Boolean).join(" · ") || null });
  }
  if (etapaCiclo(o, agora) === "EXPIRADO" && o.validadeEm) {
    m.push({ etapa: "EXPIRADO", rotulo: "Expirado (validade vencida sem resposta)", em: diaSeguinte(o.validadeEm), detalhe: null });
  }
  return m.sort((a, b) => a.em.getTime() - b.em.getTime());
}

/** Data da etapa atual (para a coluna "desde" da lista). */
export function dataDaEtapa(o: OrcamentoCiclo, agora: Date = new Date()): Date | null {
  const e = etapaCiclo(o, agora);
  const ultimo = [...marcosCiclo(o, agora)].reverse().find((m) => m.etapa === e);
  return ultimo?.em ?? null;
}

/**
 * Filtro da lista pela etapa: o `where` do Prisma para cada uma (Visualizado/Expirado/Enviado
 * dependem das datas). `hoje` = início do dia civil de hoje (gravado como meia-noite UTC).
 */
export function whereEtapa(etapa: string, hoje: Date): Record<string, unknown> | null {
  const naValidade = { OR: [{ validadeEm: null }, { validadeEm: { gte: hoje } }] };
  switch (etapa) {
    case "RASCUNHO": return { status: "RASCUNHO" };
    case "APROVADO": return { status: "APROVADO" };
    case "RECUSADO": return { status: "REPROVADO" };
    case "CANCELADO": return { status: "CANCELADO" };
    case "CONVERTIDO": return { status: "CONVERTIDA" };
    case "EXPIRADO": return { status: "ENVIADO", validadeEm: { lt: hoje } };
    case "VISUALIZADO": return { AND: [{ status: "ENVIADO", visualizadoEm: { not: null } }, naValidade] };
    case "ENVIADO": return { AND: [{ status: "ENVIADO", visualizadoEm: null }, naValidade] };
    default: return null;
  }
}

/**
 * Transições que a EQUIPE pode fazer pelo PUT `{ status }` (destino ← origens). Aprovar é só do
 * cliente pelo link (com assinatura); Convertida, só pela conversão; Rascunho volta pelo "Reabrir".
 */
export const TRANSICOES_EQUIPE: Record<string, string[]> = {
  ENVIADO: ["RASCUNHO", "ENVIADO", "REPROVADO"],
  REPROVADO: ["ENVIADO"],
  RASCUNHO: ["ENVIADO", "REPROVADO"],
  CANCELADO: ["RASCUNHO", "ENVIADO", "APROVADO", "REPROVADO"],
};

export function podeMudarStatus(de: string, para: string): boolean {
  return !!TRANSICOES_EQUIPE[para]?.includes(de);
}

// ───────────────────────── Aceite / recusa no link público ─────────────────────────

/** IP de quem respondeu: o 1º do X-Forwarded-For (proxy da Vercel) ou o X-Real-IP; curto e sem lixo. */
export function ipDaRequisicao(h: { get(nome: string): string | null }): string | null {
  const bruto = h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "";
  const ip = bruto.trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

/**
 * Robôs que abrem o link sozinhos (prévia do WhatsApp/Telegram/Slack, antivírus do e-mail,
 * buscadores): não contam como "Visualizado" — só uma pessoa abrindo conta.
 */
export function ehRobo(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return /bot|crawler|spider|preview|whatsapp|facebookexternalhit|slack|telegram|discord|skypeuri|linkedin|google-safety|proofpoint|mimecast|barracuda|curl|wget|python-requests|headless/i.test(userAgent);
}

/**
 * A página do link foi aberta por uma pessoa: nem robô, nem pré-carregamento (prefetch), nem a
 * cópia que o app (service worker) busca sozinho para guardar offline — essas vêm sem
 * `Sec-Fetch-Dest: document`. Navegador antigo sem o cabeçalho conta.
 */
export function ehAberturaDaPagina(h: { get(nome: string): string | null }): boolean {
  if (ehRobo(h.get("user-agent"))) return false;
  const destino = h.get("sec-fetch-dest");
  if (destino && destino !== "document") return false;
  return !/prefetch|prerender/i.test(`${h.get("sec-purpose") ?? ""} ${h.get("purpose") ?? ""}`);
}

export const MOTIVO_RECUSA_MIN = 3;
export const MOTIVO_RECUSA_MAX = 1000;

/** Motivos rápidos da recusa (o cliente pode escrever o seu). */
export const MOTIVOS_RECUSA = [
  "Preço acima do orçado",
  "Prazo não atende",
  "Optamos por outro fornecedor",
  "Projeto adiado ou cancelado",
] as const;

// ───────────────────────── Linha do tempo (eventos) ─────────────────────────

export const ROTULO_EVENTO: Record<string, string> = {
  ENVIADO: "Marcado como enviado",
  ENVIADO_EMAIL: "Enviado por e-mail",
  ENVIADO_WHATSAPP: "Link enviado por WhatsApp",
  LINK_COPIADO: "Link copiado",
  VISUALIZADO: "Cliente abriu o link",
  APROVADO: "Aprovado pelo cliente",
  RECUSADO: "Recusado pelo cliente",
  STATUS: "Status alterado",
  OS_GERADA: "OS gerada",
  FATURADO: "Faturado",
};
