import { VendedorTravado } from "@/components/comissoes/vendedor-travado";

/**
 * COM-1 — o VENDEDOR do orçamento: nasce = quem criou e fica TRAVADO. Só quem tem Orçamentos › "Trocar vendedor"
 * vê o "Trocar" (o servidor confere de novo), escolhe a pessoa e informa o motivo, que vai para a trilha.
 */
export function VendedorDoOrcamento({ orcamentoId, vendedor, podeTrocar, opcoes }: {
  orcamentoId: string;
  vendedor: { id: string; nome: string } | null;
  podeTrocar: boolean;
  opcoes: { id: string; nome: string }[];
}) {
  return <VendedorTravado url={`/api/orcamentos/${orcamentoId}/vendedor`} vendedor={vendedor} podeTrocar={podeTrocar} opcoes={opcoes} dica="Fica na linha do tempo do orçamento." />;
}
