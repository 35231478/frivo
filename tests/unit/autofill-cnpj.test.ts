import { describe, it, expect } from "vitest";
import { mesclarEnderecoPrincipal, mesclarContato, type EnderecoConsulta } from "@/lib/cadastros/autofill-cnpj";

type U = { _tempId: string; nome: string; principal: boolean; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string; cep: string };
type C = { _tempId: string; nome: string; email: string; telefone: string; principal: boolean };
let n = 0;
const novaU = (): U => ({ _tempId: `u${++n}`, nome: "", principal: false, logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "", cep: "" });
const novoC = (): C => ({ _tempId: `c${++n}`, nome: "", email: "", telefone: "", principal: false });

const END: EnderecoConsulta = { logradouro: "Av Central", numero: "1000", complemento: "Sala 2", bairro: "Setor Central", cidade: "Goiânia", estado: "GO", cep: "74000-000" };

describe("mesclarEnderecoPrincipal", () => {
  it("lista vazia: cria o endereço principal 'Matriz' preenchido", () => {
    const { unidades, preencheu } = mesclarEnderecoPrincipal<U>([], END, novaU);
    expect(preencheu).toBe(true);
    expect(unidades).toHaveLength(1);
    expect(unidades[0]).toMatchObject({ nome: "Matriz", principal: true, logradouro: "Av Central", cidade: "Goiânia", estado: "GO", cep: "74000-000" });
  });

  it("já existe: preenche só os campos VAZIOS do principal, sem sobrescrever", () => {
    const atual: U[] = [{ ...novaU(), nome: "Matriz", principal: true, cidade: "São Paulo", estado: "SP" }];
    const { unidades, preencheu } = mesclarEnderecoPrincipal<U>(atual, END, novaU);
    expect(preencheu).toBe(true);
    // cidade/estado já tinham valor → mantidos; logradouro/cep estavam vazios → preenchidos
    expect(unidades[0].cidade).toBe("São Paulo");
    expect(unidades[0].estado).toBe("SP");
    expect(unidades[0].logradouro).toBe("Av Central");
    expect(unidades[0].cep).toBe("74000-000");
  });

  it("principal já completo: nada muda", () => {
    const cheio: U = { ...novaU(), nome: "Matriz", principal: true, logradouro: "Rua X", numero: "5", complemento: "A", bairro: "B", cidade: "C", estado: "GO", cep: "11111-111" };
    const { preencheu } = mesclarEnderecoPrincipal<U>([cheio], END, novaU);
    expect(preencheu).toBe(false);
  });

  it("consulta sem endereço: não mexe", () => {
    const vazio: EnderecoConsulta = { logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "", cep: "" };
    const { unidades, preencheu } = mesclarEnderecoPrincipal<U>([], vazio, novaU);
    expect(preencheu).toBe(false);
    expect(unidades).toHaveLength(0);
  });

  it("preenche o 1º endereço quando nenhum é principal", () => {
    const atual: U[] = [{ ...novaU(), nome: "Filial", principal: false }];
    const { unidades } = mesclarEnderecoPrincipal<U>(atual, END, novaU);
    expect(unidades[0].cidade).toBe("Goiânia");
  });
});

describe("mesclarContato", () => {
  it("adiciona um contato principal com e-mail/telefone quando não há nenhum", () => {
    const { contatos, adicionou } = mesclarContato<C>([], { email: "contato@x.com", telefone: "(62) 3333-4444" }, "Termofrio Ltda", novoC);
    expect(adicionou).toBe(true);
    expect(contatos[0]).toMatchObject({ nome: "Termofrio Ltda", email: "contato@x.com", telefone: "(62) 3333-4444", principal: true });
  });

  it("não duplica: mesmo e-mail já existe", () => {
    const atual: C[] = [{ ...novoC(), nome: "João", email: "contato@x.com", principal: true }];
    const { adicionou } = mesclarContato<C>(atual, { email: "CONTATO@X.com", telefone: "" }, "Termofrio", novoC);
    expect(adicionou).toBe(false);
  });

  it("não duplica por telefone quando não há e-mail", () => {
    const atual: C[] = [{ ...novoC(), nome: "João", telefone: "6233334444", principal: true }];
    const { adicionou } = mesclarContato<C>(atual, { email: "", telefone: "(62) 3333-4444" }, "Termofrio", novoC);
    expect(adicionou).toBe(false);
  });

  it("sem e-mail nem telefone: não adiciona", () => {
    const { adicionou } = mesclarContato<C>([], { email: "", telefone: "" }, "X", novoC);
    expect(adicionou).toBe(false);
  });
});
