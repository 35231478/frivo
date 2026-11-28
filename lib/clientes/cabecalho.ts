/**
 * Leva H — o CABEÇALHO da ficha do cliente: só o que importa (regra pura, sem banco).
 *  - "Inadimplente" só quando há valor em atraso (e com o valor); adimplente não mostra nada;
 *  - contratos só se houver contrato ativo; "a receber em 30 dias" só quando há valor;
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
}

const centavos = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

export function sinaisDoCliente(d: DadosDoCabecalho): SinalCliente[] {
  const s: SinalCliente[] = [];
  if (!d.ativo) s.push({ id: "inativo", rotulo: "Inativo", tom: "previsto" });
  const atraso = centavos(d.valorEmAtraso);
  if (atraso > 0) s.push({ id: "inadimplente", rotulo: `Inadimplente · ${formatarMoeda(atraso)} em atraso`, tom: "atrasado", ...(d.podeVerReceber ? { href: `/financeiro/contas-receber?clienteId=${d.clienteId}&card=VENCIDO&periodo=todos` } : {}) });
  if (d.contratosAtivos > 0) s.push({ id: "contratos", rotulo: `${d.contratosAtivos} contrato${d.contratosAtivos > 1 ? "s" : ""} ativo${d.contratosAtivos > 1 ? "s" : ""}`, tom: "ok", href: `/contratos?clienteId=${d.clienteId}` });
  const aReceber = centavos(d.totalProximos30Dias);
  if (aReceber > 0) s.push({ id: "aReceber", rotulo: `A receber em 30 dias · ${formatarMoeda(aReceber)}`, tom: "acento" });
  const sat = d.satisfacao;
  if (sat && sat.avaliacoes > 0 && sat.media != null) s.push({ id: "satisfacao", rotulo: `★ ${mediaTexto(sat.media)} (${sat.avaliacoes})`, tom: "previsto", titulo: `Média ${mediaTexto(sat.media)} de 5 em ${avaliacoesTexto(sat.avaliacoes)} no aceite das OS` });
  return s;
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
