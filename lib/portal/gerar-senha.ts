import { randomInt } from "node:crypto";
import { ALFABETO_SENHA, DIGITOS_SENHA, TAMANHO_SENHA_PROVISORIA } from "@/lib/portal/senha-provisoria";

/**
 * Senha provisória com gerador criptográfico: 12 caracteres do alfabeto sem ambíguos, com pelo menos uma
 * letra e um número (passa na mesma regra das senhas novas). `sortear` só é trocado nos testes.
 */
export function gerarSenhaProvisoria(sortear: (n: number) => number = randomInt): string {
  const s = Array.from({ length: TAMANHO_SENHA_PROVISORIA }, () => ALFABETO_SENHA[sortear(ALFABETO_SENHA.length)]);
  if (!s.some((c) => DIGITOS_SENHA.includes(c))) s[sortear(s.length)] = DIGITOS_SENHA[sortear(DIGITOS_SENHA.length)];
  if (!s.some((c) => /[A-Za-z]/.test(c))) s[sortear(s.length)] = ALFABETO_SENHA[sortear(48)]; // as 48 primeiras são letras
  return s.join("");
}
