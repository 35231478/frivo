/**
 * ERRO NO CAMPO — a resposta de erro padrão das rotas: `{ erro, campos? }`.
 *  - `erro` continua sendo a frase de sempre (quem já lê só o `erro` não quebra);
 *  - `campos` diz em qual campo do formulário o erro mora, com o NOME do campo na tela (ex.: { cpfCnpj: "…" }).
 * O formulário (components/ui/formulario-erros) lê os dois com `lerErroDaApi` e marca o campo certo.
 */
import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { camposDoZod, type ErrosDeCampo } from "@/lib/forms/erros";

/** Um erro que pertence a um campo: `{ erro: mensagem, campos: { [campo]: mensagem } }` */
export function erroNoCampo(campo: string, mensagem: string, status = 400) {
  return NextResponse.json({ erro: mensagem, campos: { [campo]: mensagem } }, { status });
}

/** Vários campos de uma vez; `erro` é a frase geral (sem ela, a do primeiro campo) */
export function errosNosCampos(campos: ErrosDeCampo, erro?: string, status = 400) {
  const primeira = Object.values(campos)[0];
  return NextResponse.json({ erro: erro ?? primeira ?? "Dados inválidos", campos }, { status });
}

/**
 * A validação do zod que falhou: o mesmo `{ erro: "Dados inválidos", detalhes: flatten() }` de antes (não quebra
 * ninguém) + `campos` com o caminho de cada erro ("itens.2.quantidade" numa tabela).
 */
export function erroDeValidacao(error: ZodError, erro = "Dados inválidos", status = 400) {
  return NextResponse.json({ erro, detalhes: error.flatten(), campos: camposDoZod(error.issues) }, { status });
}
