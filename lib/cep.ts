/**
 * Consulta de CEP no ViaCEP — UMA função para todas as telas que preenchem endereço (unidade do
 * cliente, cadastro rápido, admissão digital). Sem rede (ou CEP que não existe), devolve null e a
 * tela segue com o que a pessoa digitar: a consulta é conforto, nunca trava o formulário.
 */
export interface EnderecoCep {
  logradouro: string;
  bairro: string;
  cidade: string;
  estado: string;
  complemento: string;
}

export const cepCompleto = (cep: string) => cep.replace(/\D/g, "").length === 8;

/** Formata enquanto digita: 13010-000 */
export function formatarCep(cep: string): string {
  const d = cep.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export async function buscarCep(cepBruto: string): Promise<EnderecoCep | null> {
  const cep = cepBruto.replace(/\D/g, "");
  if (cep.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || d.erro) return null;
    return {
      logradouro: d.logradouro ?? "", bairro: d.bairro ?? "",
      cidade: d.localidade ?? "", estado: d.uf ?? "", complemento: d.complemento ?? "",
    };
  } catch {
    return null;
  }
}
