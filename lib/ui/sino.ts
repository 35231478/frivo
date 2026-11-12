/**
 * O sino do cabeçalho relê os avisos a cada 2 minutos. Quando uma tela acaba de dar um aviso por
 * visto (ex.: abriu a OS que o cliente confirmou), ela chama `atualizarSino()` e o sino relê na hora.
 */
export const EVENTO_SINO = "frivo:sino";
export const atualizarSino = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_SINO)); };
