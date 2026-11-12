/**
 * CPF/CNPJ: dígitos verificadores de verdade (não só o tamanho). Puro: telas, servidor e testes.
 */
export const digitos = (s: string) => s.replace(/\D/g, "");

export function cpfValido(s: string): boolean {
  const d = digitos(s);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function cnpjValido(s: string): boolean {
  const d = digitos(s);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + Number(d[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

/** "cpf" | "cnpj" quando válido; null quando inválido. */
export function tipoDocumento(s: string): "cpf" | "cnpj" | null {
  const d = digitos(s);
  if (d.length === 11) return cpfValido(d) ? "cpf" : null;
  if (d.length === 14) return cnpjValido(d) ? "cnpj" : null;
  return null;
}

/** 000.000.000-00 / 00.000.000/0000-00 (como o cadastro de clientes guarda). */
export function formatarDocumento(s: string): string {
  const d = digitos(s);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return s;
}
