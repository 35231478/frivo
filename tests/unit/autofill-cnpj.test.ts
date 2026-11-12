import { describe, it, expect } from "vitest";
import { mesclarContato } from "@/lib/cadastros/autofill-cnpj";

type C = { _tempId: string; nome: string; email: string; telefone: string; principal: boolean };
let n = 0;
const novoC = (): C => ({ _tempId: `c${++n}`, nome: "", email: "", telefone: "", principal: false });

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
