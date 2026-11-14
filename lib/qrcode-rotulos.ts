/**
 * Como o equipamento aparece nas telas de QR Codes. Marca e modelo sozinhos não bastam: um prédio tem
 * dezenas de "LG S4-W12", e na hora de vincular a etiqueta é preciso saber QUAL — por isso o apelido
 * vem primeiro e o lugar (cliente, unidade, ambiente) acompanha.
 */
type EquipamentoDoQr = {
  nome?: string | null; marca: string; modelo: string; localizacao?: string | null;
  unidade?: { nome: string; cliente?: { nome: string; nomeFantasia?: string | null } | null } | null;
};
const junta = (partes: (string | null | undefined)[]) => partes.map((p) => (p ?? "").trim()).filter(Boolean).join(" · ");

/** "Split UTI 1 · Daikin FTXS35" (sem apelido: só marca e modelo) */
export const nomeEquipamentoQr = (e: EquipamentoDoQr) => junta([e.nome, `${e.marca} ${e.modelo}`]);

/** Onde está, na lista: "Matriz · UTI" (unidade e ambiente; o que houver) */
export const localEquipamentoQr = (e: EquipamentoDoQr) => junta([e.unidade?.nome, e.localizacao]) || null;

/** No seletor de vincular: nome e, depois do travessão, cliente, unidade e ambiente */
export function rotuloParaVincular(e: EquipamentoDoQr): string {
  const cliente = e.unidade?.cliente ? e.unidade.cliente.nomeFantasia ?? e.unidade.cliente.nome : null;
  const onde = junta([cliente, e.unidade?.nome, e.localizacao]);
  return onde ? `${nomeEquipamentoQr(e)} — ${onde}` : nomeEquipamentoQr(e);
}
