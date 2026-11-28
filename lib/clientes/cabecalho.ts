/**
 * Leva H — o CABEÇALHO da ficha do cliente: só o que importa (regra pura, sem banco).
 *  - "Inadimplente" só quando há valor em atraso (com o valor só para quem vê o financeiro); adimplente não mostra nada;
 *  - contratos só se houver contrato ativo (link aos ativos só para quem vê contratos); "a receber em 30 dias" só
 *    quando há valor (e só para quem vê o financeiro);
 *  - "Inativo" só quando o cliente está inativo (ativo é o normal: não ocupa espaço);
 *  - o botão único "Novo ▾": só os itens que o perfil permite, e só para cliente ativo.
 */
import { formatarMoeda } from "@/lib/utils";
import type { TomStatus } from "@/components/ui/status-pill";
import type { Acao } from "@/lib/permissoes";
import { avaliacoesTexto, mediaTexto } from "@/lib/clientes/satisfacao";

export interface SinalCliente { id: "inativo" | "inadimplente" | "contratos" | "aReceber" | "satisfacao"; rotulo: string; tom: TomStatus; href?: string; titulo?: string }

export interface DadosDoCabecalho {
  clienteId: string;
  ativo: boolean;
  valorEmAtraso: number;
  totalProximos30Dias: number;
  contratosAtivos: number;
  /** Média das notas do aceite (1 a 5) e quantas avaliações; sem avaliação, nada */
  satisfacao?: { media: number | null; avaliacoes: number } | null;
  /** Quem vê o contas a receber: o "Inadimplente" vira link para as contas vencidas do cliente */
  podeVerReceber?: boolean;
  /** Quem não vê o financeiro não recebe os valores: só se há atraso ("Inadimplente", sem o valor) */
  emAtraso?: boolean;
  /** Quem vê os contratos: "N contratos ativos" vira link para os contratos ativos do cliente */
  podeVerContratos?: boolean;
}

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

export function sinaisDoCliente(d: DadosDoCabecalho): SinalCliente[] {
  const s: SinalCliente[] = [];
  if (!d.ativo) s.push({ id: "inativo", rotulo: "Inativo", tom: "previsto" });
  const atraso = centavos(d.valorEmAtraso);
  if (atraso > 0 || d.emAtraso) s.push({ id: "inadimplente", rotulo: atraso > 0 ? `Inadimplente · ${formatarMoeda(atraso)} em atraso` : "Inadimplente", tom: "atrasado", ...(d.podeVerReceber ? { href: `/financeiro/contas-receber?clienteId=${d.clienteId}&card=VENCIDO&periodo=todos` } : {}) });
  if (d.contratosAtivos > 0) s.push({ id: "contratos", rotulo: `${d.contratosAtivos} contrato${d.contratosAtivos > 1 ? "s" : ""} ativo${d.contratosAtivos > 1 ? "s" : ""}`, tom: "ok", ...(d.podeVerContratos ? { href: `/contratos?clienteId=${d.clienteId}&status=ATIVO` } : {}) });
  const aReceber = centavos(d.totalProximos30Dias);
  if (aReceber > 0) s.push({ id: "aReceber", rotulo: `A receber em 30 dias · ${formatarMoeda(aReceber)}`, tom: "acento" });
  const sat = d.satisfacao;
  if (sat && sat.avaliacoes > 0 && sat.media != null) s.push({ id: "satisfacao", rotulo: `★ ${mediaTexto(sat.media)} (${sat.avaliacoes})`, tom: "previsto", titulo: `Média ${mediaTexto(sat.media)} de 5 em ${avaliacoesTexto(sat.avaliacoes)} no aceite das OS` });
  return s;
}

/** Vê o financeiro do cliente (contas a receber ou faturas)? Só então os valores saem do servidor */
export const veFinanceiroDoCliente = (pode: (modulo: string, acao: Acao) => boolean) => pode("financeiro", "contasReceber") || pode("financeiro", "medicoes");

/**
 * O que a página manda para o cabeçalho: quem vê o financeiro recebe os valores; quem não vê, só se há atraso
 * (os valores nem saem do servidor).
 */
export function valoresDoCabecalho(f: { valorEmAtraso: number; totalProximos30Dias: number }, veFinanceiro: boolean) {
  const emAtraso = centavos(f.valorEmAtraso) > 0;
  return veFinanceiro ? { valorEmAtraso: f.valorEmAtraso, totalProximos30Dias: f.totalProximos30Dias, emAtraso } : { emAtraso };
}

export interface ItemNovo { id: "os" | "orcamento" | "contrato" | "documentacao"; rotulo: string; href: string }

/** O "Novo ▾" da ficha: o que se cria a partir do cliente, já com o cliente escolhido. Vazio = sem botão. */
export function itensDoNovo(clienteId: string, ativo: boolean, pode: (modulo: string, acao: Acao) => boolean): ItemNovo[] {
  if (!ativo) return [];
  const q = `clienteId=${encodeURIComponent(clienteId)}`;
  const itens: (ItemNovo & { ok: boolean })[] = [
    { id: "os", rotulo: "Ordem de serviço", href: `/ordens/nova?${q}`, ok: pode("ordens", "criar") },
    { id: "orcamento", rotulo: "Orçamento", href: `/orcamentos/novo?${q}`, ok: pode("orcamentos", "criar") },
    { id: "contrato", rotulo: "Contrato", href: `/contratos/novo?${q}`, ok: pode("contratos", "criar") },
    { id: "documentacao", rotulo: "Envio de documentação da equipe", href: `/documentacao-equipe/novo?${q}`, ok: pode("documentos", "enviar") },
  ];
  return itens.filter((i) => i.ok).map(({ ok: _ok, ...i }) => i);
}
