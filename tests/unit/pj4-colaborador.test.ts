/**
 * PJ4 — pontas soltas do colaborador (Leva J), as regras puras:
 *  - J3: o par tipo × tipoEquipe que as rotas gravam (lib/colaborador/funcao#funcaoDoCorpo) — sem equipe no corpo,
 *    ela sai do tipo; com ela, ela manda e o tipo é refeito; o schema não inventa mais "CAMPO";
 *  - J13: a recusa do cadastro diz o que está errado (a 1ª mensagem do schema, em português);
 *  - J18: especialidades aparadas, sem repetida (maiúscula não conta), até 60 caracteres e 20 itens;
 *  - J14: a dica de "Usa o app de campo" não promete o custo-hora (ele segue o tipo, lib/folha/calculo);
 *  - J20: o formulário morto (components/forms/tecnico-form.tsx) saiu e ninguém o importa.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { tecnicoSchema } from "@/lib/validations";
import { DICA_CAMPO, erroDoCadastro, funcaoDaFicha, funcaoDoCorpo, gravarFuncao } from "@/lib/colaborador/funcao";
import { FUNCOES_CUSTO_HORA } from "@/lib/folha/calculo";

const RAIZ = path.resolve(__dirname, "../..");
const BASE = { nome: "Carlos Oliveira", cpf: "529.982.247-25", telefone: "(11) 3333-4444" };

describe("J3: o par tipo × tipoEquipe que as rotas gravam", () => {
  it("sem tipoEquipe, ela sai do tipo (ADMINISTRATIVO → ADMINISTRATIVO; o resto → CAMPO)", () => {
    expect(funcaoDoCorpo("ADMINISTRATIVO")).toEqual({ tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" });
    expect(funcaoDoCorpo("TECNICO_CAMPO")).toEqual({ tipo: "TECNICO_CAMPO", tipoEquipe: "CAMPO" });
    expect(funcaoDoCorpo("RESPONSAVEL_TECNICO")).toEqual({ tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "CAMPO" });
    expect(funcaoDoCorpo("MOTORISTA")).toEqual({ tipo: "MOTORISTA", tipoEquipe: "CAMPO" });
    expect(funcaoDoCorpo("OUTRO", null)).toEqual({ tipo: "OUTRO", tipoEquipe: "CAMPO" });
  });
  it("com tipoEquipe, ela manda no 'campo' e o tipo é refeito; o RT continua RT", () => {
    expect(funcaoDoCorpo("ADMINISTRATIVO", "CAMPO")).toEqual({ tipo: "TECNICO_CAMPO", tipoEquipe: "CAMPO" });
    expect(funcaoDoCorpo("TECNICO_CAMPO", "ADMINISTRATIVO")).toEqual({ tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" });
    expect(funcaoDoCorpo("RESPONSAVEL_TECNICO", "ADMINISTRATIVO")).toEqual({ tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "ADMINISTRATIVO" });
  });
  it("qualquer par gravado volta igual pela ficha (a ficha não vira o tipo no próximo salvar)", () => {
    for (const tipo of ["TECNICO_CAMPO", "RESPONSAVEL_TECNICO", "ADMINISTRATIVO", "MOTORISTA", "OUTRO"]) {
      for (const eq of [undefined, "CAMPO", "ADMINISTRATIVO"] as const) {
        const gravado = funcaoDoCorpo(tipo, eq);
        expect(gravarFuncao(funcaoDaFicha(gravado), gravado.tipo), `${tipo}/${eq}`).toEqual(gravado);
      }
    }
  });
  it("o schema não inventa mais tipoEquipe=CAMPO quando ela não vem (dá para saber que não veio)", () => {
    const p = tecnicoSchema.parse({ ...BASE, tipo: "ADMINISTRATIVO" });
    expect(p.tipoEquipe).toBeUndefined();
    expect(tecnicoSchema.parse({ ...BASE, tipoEquipe: "ADMINISTRATIVO" }).tipoEquipe).toBe("ADMINISTRATIVO");
    expect(tecnicoSchema.safeParse({ ...BASE, tipoEquipe: "OUTRA" }).success).toBe(false);
  });
});

describe("J13: a recusa diz o que está errado", () => {
  const erro = (corpo: unknown) => { const r = tecnicoSchema.safeParse(corpo); expect(r.success).toBe(false); return erroDoCadastro((r as any).error); };
  it("a 1ª mensagem do schema (em português), inclusive a do e-mail (que é e-mail OU vazio)", () => {
    expect(erro({ ...BASE, nome: "A" })).toBe("Nome deve ter pelo menos 2 caracteres");
    expect(erro({ ...BASE, telefone: "123" })).toBe("Telefone inválido");
    expect(erro({ ...BASE, email: "nao-e-email" })).toBe("E-mail inválido");
  });
  it("campo ausente, tipo errado ou valor fora da lista (mensagem do zod em inglês) ficam no genérico", () => {
    expect(erro({ nome: "Carlos Oliveira", cpf: BASE.cpf })).toBe("Dados inválidos");
    expect(erro({ ...BASE, tipo: "CHEFE" })).toBe("Dados inválidos");
  });
});

describe("J18: especialidades limitadas", () => {
  const esp = (especialidades: unknown) => tecnicoSchema.safeParse({ ...BASE, especialidades });
  it("apara, tira vazias e repetidas (maiúscula/minúscula não conta), na ordem em que vieram", () => {
    const r = esp([" VRF ", "vrf", "  ", "Chiller", "CHILLER", "Câmara fria", "câmara FRIA"]);
    expect(r.success && r.data.especialidades).toEqual(["VRF", "Chiller", "Câmara fria"]);
  });
  it("até 60 caracteres cada e 20 itens", () => {
    expect(esp(["x".repeat(60)]).success).toBe(true);
    expect(erroDoCadastro((esp(["x".repeat(61)]) as any).error)).toBe("Cada especialidade pode ter até 60 caracteres");
    expect(esp(Array.from({ length: 20 }, (_, i) => `E${i}`)).success).toBe(true);
    expect(erroDoCadastro((esp(Array.from({ length: 21 }, (_, i) => `E${i}`)) as any).error)).toBe("Informe no máximo 20 especialidades");
  });
});

describe("J14: a dica de 'Usa o app de campo' é exata", () => {
  it("não promete o custo-hora: ele segue o tipo (técnico de campo e RT), não a chave — um RT administrativo entra, um motorista de campo não", () => {
    expect(DICA_CAMPO).not.toMatch(/custo/i);
    expect(FUNCOES_CUSTO_HORA).toContain(funcaoDoCorpo("RESPONSAVEL_TECNICO", "ADMINISTRATIVO").tipo);
    expect(FUNCOES_CUSTO_HORA).not.toContain(funcaoDoCorpo("MOTORISTA", "CAMPO").tipo);
  });
});

describe("J20: o formulário morto do técnico saiu", () => {
  it("components/forms/tecnico-form.tsx não existe e nada o importa", () => {
    expect(existsSync(path.join(RAIZ, "components/forms/tecnico-form.tsx"))).toBe(false);
    const fontes: string[] = [];
    const andar = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) andar(p);
        else if (/\.(ts|tsx)$/.test(n)) fontes.push(p);
      }
    };
    for (const d of ["app", "components", "lib"]) andar(path.join(RAIZ, d));
    expect(fontes.filter((f) => /forms\/tecnico-form|TecnicoForm\b/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});
