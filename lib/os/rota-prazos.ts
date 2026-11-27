/**
 * Para onde vai quem abre o endereço antigo "/prazos" (o menu "Prazos e SLA" saiu):
 *  - com filtro da tela antiga (`status`, `templateId`): o acompanhamento das ETAPAS COM PRAZO, que
 *    agora mora em /ordens/etapas — é o que aquele link mostrava (o sino e o dashboard apontavam assim);
 *  - sem filtro: a lista de OS já filtrada nas ATRASADAS — o que se procura por "prazos".
 */
export function destinoDePrazos(sp: Record<string, string | undefined>): string {
  if (!sp.status && !sp.templateId) return "/ordens?prazo=atrasadas&periodo=todos";
  const antigos = new URLSearchParams();
  for (const k of ["status", "templateId", "pagina", "por"]) if (sp[k]) antigos.set(k, sp[k]!);
  return `/ordens/etapas?${antigos.toString()}`;
}
