/**
 * ERRO NO CAMPO — as regras puras (lib/forms/erros) e a resposta padrão da API (lib/forms/erros-server).
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  camposDoRhf, camposDoZod, errosPorAba, formatoDoDocumento, lerErroDaApi, limparCampos, MSG_FORMATO,
  numeroDigitado, resumoDosErros, textoQuantos, validarFormato,
} from "@/lib/forms/erros";
import { erroDeValidacao, erroNoCampo, errosNosCampos } from "@/lib/forms/erros-server";

describe("resumo da faixa do topo", () => {
  it("sem erro, sem faixa", () => {
    expect(resumoDosErros({ geral: null, campos: {} })).toBeNull();
    expect(resumoDosErros({ geral: "  ", campos: { a: " " } })).toBeNull();
  });
  it("só o geral: o geral, sem contagem", () => {
    expect(resumoDosErros({ geral: "Erro de conexão.", campos: {} })).toEqual({ texto: "Erro de conexão.", quantos: null, itens: [] });
  });
  it("um erro de campo sozinho: a faixa traz o mesmo texto do campo", () => {
    const r = resumoDosErros({ geral: null, campos: { cpfCnpj: "Informe os 14 dígitos do CNPJ." } })!;
    expect(r.texto).toBe("Informe os 14 dígitos do CNPJ.");
    expect(r.quantos).toBeNull();
    expect(r.itens).toEqual([{ campo: "cpfCnpj", mensagem: "Informe os 14 dígitos do CNPJ." }]);
  });
  it("mais de um: \"N campos para corrigir\", na ordem da tela", () => {
    const r = resumoDosErros({ geral: null, campos: { email: "E-mail inválido.", nome: "Informe o nome.", cep: "CEP" } }, ["nome", "cep", "email"])!;
    expect(r.texto).toBe("3 campos para corrigir");
    expect(r.itens.map((i) => i.campo)).toEqual(["nome", "cep", "email"]);
  });
  it("geral + campos: o geral em cima e a contagem embaixo", () => {
    const r = resumoDosErros({ geral: "Não foi possível salvar.", campos: { nome: "Informe o nome." } })!;
    expect(r.texto).toBe("Não foi possível salvar.");
    expect(r.quantos).toBe("1 campo para corrigir");
  });
  it("o \"Dados inválidos\" genérico (ou a mesma frase do campo) não vira faixa à parte", () => {
    expect(resumoDosErros({ geral: "Dados inválidos", campos: { nome: "Informe o nome." } })!.texto).toBe("Informe o nome.");
    expect(resumoDosErros({ geral: "Informe o nome.", campos: { nome: "Informe o nome." } })!.quantos).toBeNull();
  });
  it("plural e singular", () => {
    expect(textoQuantos(1)).toBe("1 campo para corrigir");
    expect(textoQuantos(2)).toBe("2 campos para corrigir");
  });
});

describe("resposta de erro da API", () => {
  it("o padrão novo { erro, campos }", () => {
    expect(lerErroDaApi({ erro: "CPF/CNPJ já cadastrado", campos: { cpfCnpj: "CPF/CNPJ já cadastrado" } }))
      .toEqual({ geral: null, campos: { cpfCnpj: "CPF/CNPJ já cadastrado" } });
  });
  it("o `detalhes` do zod que as rotas já devolvem vira campos", () => {
    const e = lerErroDaApi({ erro: "Dados inválidos", detalhes: { formErrors: [], fieldErrors: { nome: ["Nome curto"], email: [] } } });
    expect(e).toEqual({ geral: null, campos: { nome: "Nome curto" } });
  });
  it("só o `erro` de sempre: vai para a faixa", () => {
    expect(lerErroDaApi({ erro: "Sem permissão" })).toEqual({ geral: "Sem permissão", campos: {} });
    expect(lerErroDaApi({ error: "x" }).geral).toBe("x");
    expect(lerErroDaApi(null, "Erro ao salvar.").geral).toBe("Erro ao salvar.");
    expect(lerErroDaApi("texto").geral).toBe("texto");
  });
  it("erro geral diferente dos campos fica junto", () => {
    expect(lerErroDaApi({ erro: "Limite do plano", campos: { nome: "x" } })).toEqual({ geral: "Limite do plano", campos: { nome: "x" } });
  });
});

describe("helpers do servidor: { erro, campos } sem quebrar quem lê só o `erro`", () => {
  it("erroNoCampo", async () => {
    const r = erroNoCampo("cpfCnpj", "CPF/CNPJ já cadastrado", 409);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ erro: "CPF/CNPJ já cadastrado", campos: { cpfCnpj: "CPF/CNPJ já cadastrado" } });
  });
  it("errosNosCampos: sem frase geral, a do primeiro campo", async () => {
    expect(await errosNosCampos({ a: "A.", b: "B." }).json()).toEqual({ erro: "A.", campos: { a: "A.", b: "B." } });
    expect(await errosNosCampos({ a: "A." }, "Geral").json()).toEqual({ erro: "Geral", campos: { a: "A." } });
  });
  it("erroDeValidacao: o mesmo { erro, detalhes } de antes + campos com o caminho (tabela editável)", async () => {
    const s = z.object({ nome: z.string().min(2, "Nome curto"), itens: z.array(z.object({ quantidade: z.number().positive("Quantidade maior que zero") })) });
    const p = s.safeParse({ nome: "a", itens: [{ quantidade: 1 }, { quantidade: 0 }] });
    expect(p.success).toBe(false);
    const corpo = await erroDeValidacao(p.error!).json();
    expect(corpo.erro).toBe("Dados inválidos");
    expect(corpo.detalhes.fieldErrors.nome).toEqual(["Nome curto"]);
    expect(corpo.campos).toEqual({ nome: "Nome curto", "itens.1.quantidade": "Quantidade maior que zero" });
    expect(lerErroDaApi(corpo).campos["itens.1.quantidade"]).toBe("Quantidade maior que zero");
  });
  it("camposDoZod: vale a 1ª mensagem de cada caminho; caminho vazio não conta", () => {
    expect(camposDoZod([{ path: ["a"], message: "1" }, { path: ["a"], message: "2" }, { path: [], message: "raiz" }])).toEqual({ a: "1" });
  });
});

describe("formato ao sair do campo (vazio nunca acusa)", () => {
  it.each([
    ["cnpj", "", null],
    ["cnpj", "11.222.333/0001", MSG_FORMATO.cnpjIncompleto],
    ["cnpj", "11.222.333/0001-80", MSG_FORMATO.cnpjInvalido],
    ["cnpj", "11.222.333/0001-81", null],
    ["cpf", "123.456.789", MSG_FORMATO.cpfIncompleto],
    ["cpf", "111.111.111-11", MSG_FORMATO.cpfInvalido],
    ["cpf", "529.982.247-25", null],
    ["cpfCnpj", "123", MSG_FORMATO.documentoIncompleto],
    ["cpfCnpj", "52998224725", null],
    ["cpfCnpj", "11222333000180", MSG_FORMATO.cnpjInvalido],
    ["email", "joao@", MSG_FORMATO.email],
    ["email", "joao@empresa.com.br", null],
    ["cep", "13010-00", MSG_FORMATO.cep],
    ["cep", "13010-000", null],
    ["telefone", "(19) 3333-444", MSG_FORMATO.telefone],
    ["telefone", "(19) 3333-4444", null],
    ["telefone", "+55 19 99999-8888", null],
    ["celular", "(19) 3333-4444", MSG_FORMATO.celular],
    ["celular", "(19) 99999-8888", null],
    ["data", "31/02/2026", MSG_FORMATO.dataInexistente],
    ["data", "1/2/2026", MSG_FORMATO.dataIncompleta],
    ["data", "28/02/2026", null],
    ["hora", "25:00", MSG_FORMATO.hora],
    ["hora", "08:30", null],
    ["valor", "12,3,4", MSG_FORMATO.valor],
    ["valor", "1.250,00", null],
    ["valor", "R$ 10", null],
  ] as const)("%s %j → %j", (f, v, esperado) => {
    expect(validarFormato(f, v)).toBe(esperado);
  });
  it("número digitado no jeito brasileiro", () => {
    expect(numeroDigitado("1.250,50")).toBe(1250.5);
    expect(numeroDigitado("1250.50")).toBe(1250.5);
    expect(numeroDigitado("1.250")).toBe(1250);
    expect(numeroDigitado("abc")).toBeNull();
  });
  it("o formato do documento pelo tipo de pessoa", () => {
    expect(formatoDoDocumento("FISICA")).toBe("cpf");
    expect(formatoDoDocumento("JURIDICA")).toBe("cnpj");
    expect(formatoDoDocumento(undefined)).toBe("cpfCnpj");
  });
});

describe("abas e react-hook-form", () => {
  it("conta os erros de cada aba (\"itens.2.x\" cai na aba de \"itens\")", () => {
    const mapa: Record<string, string> = { nome: "dados", cep: "enderecos", itens: "itens" };
    expect(errosPorAba({ nome: "x", cep: "y", "itens.2.quantidade": "z", solto: "w" }, (n) => mapa[n])).toEqual({ dados: 1, enderecos: 1, itens: 1 });
  });
  it("os erros aninhados do react-hook-form viram caminhos", () => {
    const errs = { nome: { type: "min", message: "Nome curto", ref: {} }, itens: [undefined, { quantidade: { type: "x", message: "Qtd" } }], vazio: { type: "x" } };
    expect(camposDoRhf(errs)).toEqual({ nome: "Nome curto", "itens.1.quantidade": "Qtd" });
  });
  it("limparCampos tira os vazios e pega a 1ª de uma lista", () => {
    expect(limparCampos({ a: "", b: ["", "B"], c: 3, d: " D " })).toEqual({ b: "B", d: "D" });
  });
});
