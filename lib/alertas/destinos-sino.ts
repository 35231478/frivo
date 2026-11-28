/**
 * Para onde cada aviso do sino leva — regra pura (o sino em components/layout/header e os testes).
 * Um registro só e o id dele: abre o registro; senão, a lista JÁ filtrada pelo aviso (a mesma regra do
 * painel de pendências).
 */
export const umOuLista = (valor: number | undefined, id: string | null | undefined, registro: (id: string) => string, lista: string) =>
  valor === 1 && id ? registro(id) : lista;

/** Documentos de veículo vencidos ou vencendo em 30 dias: a ficha do veículo (aba Documentos) ou a frota com o aviso */
export const hrefDocumentosVencendo = (valor: number | undefined, veiculoId: string | null | undefined) =>
  umOuLista(valor, veiculoId, (id) => `/veiculos/${id}/editar?aba=documentos`, "/veiculos?aviso=documentos&status=todos");

/** Checklists com alertas de hoje: a ficha do veículo (aba Checklists) ou os preenchidos "Só com alertas" */
export const hrefChecklistsComAlertas = (valor: number | undefined, veiculoId: string | null | undefined) =>
  umOuLista(valor, veiculoId, (id) => `/veiculos/${id}/editar?aba=checklists`, "/veiculos/checklist?aba=preenchidos&alertas=1");

/** Novos leads do site (24h): o orçamento do lead ou a lista "Novos em 24h" */
export const hrefLeadsSite = (valor: number | undefined, leadId: string | null | undefined) =>
  umOuLista(valor, leadId, (id) => `/orcamentos/${id}`, "/leads-site?status=novos");
