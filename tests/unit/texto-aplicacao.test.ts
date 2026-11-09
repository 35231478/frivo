import { describe, it, expect } from "vitest";
import {
  clienteSchema, tecnicoSchema, contatoClienteSchema, equipeSchema, unidadeSchema,
} from "@/lib/validations";
import { leadSiteSchema } from "@/lib/leads/criar-lead-site";
import { CADASTROS } from "@/lib/cadastros/registro";

/**
 * O servidor é a fonte da verdade: ao validar (criar/editar, lead do site, cadastros do registro) a
 * digitação já sai padronizada. Não muda senha, documento nem campo fiscal — só nome/e-mail/endereço,
 * e observação só perde espaços.
 */

describe("Schemas de cadastro padronizam a caixa ao validar", () => {
  it("cliente: nome/fantasia/contato/endereço viram Nome Próprio, e-mail minúsculo, observação intacta", () => {
    const r = clienteSchema.parse({
      tipoPessoa: "JURIDICA", nome: "TERMOFRIO ENGENHARIA LTDA", nomeFantasia: "termofrio",
      cpfCnpj: "11444777000161", email: "  VENDAS@Termofrio.COM ", contato: "joão da silva",
      endereco: "RUA DAS FLORES", bairro: "SETOR CENTRAL", cidade: "GOIÂNIA", complemento: "sala 2",
      observacoes: "  Cliente PEDIU revisão  ",
    });
    expect(r.nome).toBe("Termofrio Engenharia Ltda");
    expect(r.nomeFantasia).toBe("Termofrio");
    expect(r.email).toBe("vendas@termofrio.com");
    expect(r.contato).toBe("João da Silva");
    expect(r.endereco).toBe("Rua das Flores");
    expect(r.bairro).toBe("Setor Central");
    expect(r.cidade).toBe("Goiânia");
    expect(r.complemento).toBe("Sala 2");
    expect(r.observacoes).toBe("Cliente PEDIU revisão"); // casing intacto
    expect(r.cpfCnpj).toBe("11444777000161"); // documento não muda
  });

  it("colaborador (técnico): nome e endereço padronizados, e-mail minúsculo", () => {
    const r = tecnicoSchema.parse({
      nome: "carlos EDUARDO", cpf: "12345678901", telefone: "6299990000",
      email: "CARLOS@Ex.COM", cidade: "aparecida de goiânia", bairro: "JARDIM",
    });
    expect(r.nome).toBe("Carlos Eduardo");
    expect(r.email).toBe("carlos@ex.com");
    expect(r.cidade).toBe("Aparecida de Goiânia");
    expect(r.bairro).toBe("Jardim");
    expect(r.cpf).toBe("12345678901");
  });

  it("contato do cliente: nome e cargo Nome Próprio, e-mail minúsculo", () => {
    const r = contatoClienteSchema.parse({ nome: "ANA souza", cargo: "gerente de compras", email: "ANA@X.COM" });
    expect(r.nome).toBe("Ana Souza");
    expect(r.cargo).toBe("Gerente de Compras");
    expect(r.email).toBe("ana@x.com");
  });

  it("equipe: nome Nome Próprio", () => {
    expect(equipeSchema.parse({ nome: "EQUIPE alpha" }).nome).toBe("Equipe Alpha");
  });

  it("unidade: nome e endereço Nome Próprio", () => {
    const r = unidadeSchema.parse({ clienteId: "c1", nome: "MATRIZ", logradouro: "av central", cidade: "GOIÂNIA" });
    expect(r.nome).toBe("Matriz");
    expect(r.logradouro).toBe("Av Central");
    expect(r.cidade).toBe("Goiânia");
  });

  it("lead do site: nome e cidade Nome Próprio, e-mail minúsculo", () => {
    const r = leadSiteSchema.parse({
      nome: "JOÃO DA SILVA", whatsapp: "62999990000", email: "JOAO@Ex.COM", cidade: "goiânia",
      ambientes: [{ nome: "Quarto", areaM2: 12, btuCalculado: 7200, btuRecomendado: 9000, tipoEquipamento: "hi-wall" }],
    });
    expect(r.nome).toBe("João da Silva");
    expect(r.cidade).toBe("Goiânia");
    expect(r.email).toBe("joao@ex.com");
  });
});

describe("Cadastros do registro (fornecedor, usuário) padronizam o nome", () => {
  it("fornecedor: razão social vira Nome Próprio ao criar", () => {
    const r = CADASTROS.fornecedores.schemaCriar.parse({ nome: "FRIGELAR DISTRIBUIDORA LTDA" }) as { nome: string };
    expect(r.nome).toBe("Frigelar Distribuidora Ltda");
  });

  it("usuário: nome vira Nome Próprio ao criar (e-mail já minúsculo)", () => {
    const r = CADASTROS.usuarios.schemaCriar.parse({ nome: "maria DAS dores", email: "MARIA@Ex.com" }) as { nome: string; email: string };
    expect(r.nome).toBe("Maria das Dores");
    expect(r.email).toBe("maria@ex.com");
  });
});
