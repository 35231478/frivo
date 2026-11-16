/**
 * MODELO DE TEXTO com campos entre chaves — o motor que a empresa usa para escrever o próprio
 * papel: `{{nome}}`, `{{cargo}}`, `{{salario}}`.
 *
 * Nasceu no contrato da admissão digital (`montarContrato`) e saiu para cá quando a ficha de EPI,
 * o termo de responsabilidade, a advertência e o aditivo passaram a precisar da mesma coisa. O
 * comportamento é o mesmo, byte por byte — os testes do contrato são a prova.
 *
 * A regra que vale para todos: **o sistema preenche, não inventa.** Campo que o sistema não
 * conhece fica no texto exatamente como foi escrito, e a tela avisa — é erro de quem escreveu o
 * modelo, e esconder isso só atrasaria a descoberta.
 */

/** `{{campo}}`, com ou sem espaço em volta. Só letra, número e underscore: nada de expressão. */
const CAMPO = /\{\{\s*(\w+)\s*\}\}/g;

/** Troca `{{campo}}` pelo valor. Campo sem valor (ou desconhecido) fica como está. */
export function preencherModelo(texto: string, dados: Record<string, unknown>): string {
  return String(texto ?? "").replace(CAMPO, (inteiro, campo: string) => {
    const v = dados[campo];
    return v === undefined || v === null ? inteiro : String(v);
  });
}

/** Os campos que o texto usa, na ordem em que aparecem, sem repetir. */
export function camposUsados(texto: string): string[] {
  return [...new Set([...String(texto ?? "").matchAll(CAMPO)].map((m) => m[1]))];
}

/** Os campos que o texto usa e o sistema não conhece — a tela de configuração avisa. */
export function camposDesconhecidosEm(texto: string, conhecidos: readonly string[]): string[] {
  return camposUsados(texto).filter((c) => !conhecidos.includes(c));
}
