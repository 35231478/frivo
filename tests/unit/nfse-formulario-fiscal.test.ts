/**
 * NFS-e — formulário fiscal do serviço (regras puras): CNAE herdado da empresa (CNAE efetivo e o
 * objeto `servico` do PlugNotas), busca nas listas de códigos (LC 116 e códigos municipais) e as
 * opções do código municipal (códigos já usados nos serviços + LC 116 de apoio).
 */
import { describe, expect, it } from "vitest";
import { cnaeEfetivo, servicoPlugNotas } from "@/lib/nfse/servico";
import { filtrarCodigos, GRUPO_LC116, GRUPO_USADOS, MAX_OPCOES_BUSCA, opcoesCodigoMunicipal, type OpcaoCodigo } from "@/lib/nfse/busca-codigo";
import { LISTA_LC116 } from "@/lib/nfse/lc116";

describe("CNAE efetivo: o do serviço, senão o principal da empresa", () => {
  it.each([
    ["4321500", "4322302", "4321500"], ["4321-5/00", null, "4321500"], [null, "4322302", "4322302"], ["", "4322-3/02", "4322302"],
    [" ", null, null], [null, null, null], [undefined, undefined, null], ["123", "4322302", "4322302"],
  ])("serviço %j + empresa %j → %j", (s, e, esperado) => expect(cnaeEfetivo(s, e)).toBe(esperado));

  it("vai no objeto do PlugNotas (e não vai quando nenhum dos dois tem)", () => {
    const s = { nome: "X", codigoLc116: "14.01", aliquotaISS: 5 };
    expect(servicoPlugNotas(s, { valor: 1, cnaeEmpresa: "4322302" }).cnae).toBe("4322302");
    expect(servicoPlugNotas({ ...s, cnae: "4321500" }, { valor: 1, cnaeEmpresa: "4322302" }).cnae).toBe("4321500");
    expect(servicoPlugNotas(s, { valor: 1 })).not.toHaveProperty("cnae");
    expect(servicoPlugNotas(s, { valor: 1, cnaeEmpresa: null })).not.toHaveProperty("cnae");
  });
});

const OPCOES: OpcaoCodigo[] = [
  { codigo: "07.02", descricao: "Execução por administração de obras de construção civil" },
  { codigo: "14.01", descricao: "Lubrificação, limpeza, revisão e manutenção de máquinas" },
  { codigo: "14.06", descricao: "Instalação e montagem de aparelhos" },
  { codigo: "17.14", descricao: "Advocacia" },
  { codigo: "31.01", descricao: "Serviços técnicos em edificações, eletrônica e mecânica (14.01 não)" },
];
const cods = (r: OpcaoCodigo[]) => r.map((o) => o.codigo);

describe("Busca nos códigos", () => {
  it("sem texto: a lista na ordem, até o limite", () => {
    expect(cods(filtrarCodigos(OPCOES, ""))).toEqual(cods(OPCOES));
    expect(cods(filtrarCodigos(OPCOES, "   "))).toEqual(cods(OPCOES));
    expect(filtrarCodigos(LISTA_LC116, "")).toHaveLength(MAX_OPCOES_BUSCA);
    expect(filtrarCodigos(OPCOES, "", 2)).toHaveLength(2);
    expect(filtrarCodigos(LISTA_LC116, "a")).toHaveLength(MAX_OPCOES_BUSCA); // com texto também corta no limite
    expect(filtrarCodigos(LISTA_LC116, "a", 3)).toHaveLength(3);
  });
  it("por código, com ou sem ponto; começa-com antes de contém", () => {
    expect(cods(filtrarCodigos(OPCOES, "1401"))).toEqual(["14.01"]);
    expect(cods(filtrarCodigos(OPCOES, "14.01"))).toEqual(["14.01"]);
    expect(cods(filtrarCodigos(OPCOES, "14"))).toEqual(["14.01", "14.06", "17.14"]);
    expect(cods(filtrarCodigos(OPCOES, "7"))).toEqual(["07.02", "17.14"]);
    expect(cods(filtrarCodigos(OPCOES, "702"))).toEqual(["07.02"]);
    expect(cods(filtrarCodigos(OPCOES, " 14 "))).toEqual(["14.01", "14.06", "17.14"]);
  });
  it("por descrição: todas as palavras, sem acento nem maiúscula", () => {
    expect(cods(filtrarCodigos(OPCOES, "instalacao"))).toEqual(["14.06"]);
    expect(cods(filtrarCodigos(OPCOES, "MANUTENÇÃO máquinas"))).toEqual(["14.01"]);
    expect(cods(filtrarCodigos(OPCOES, "manutencao advocacia"))).toEqual([]);
    expect(cods(filtrarCodigos(OPCOES, "nada disso"))).toEqual([]);
    // número junto com palavras não vira busca por código (nem no fim nem no começo)
    expect(cods(filtrarCodigos(OPCOES, "14.01 não"))).toEqual(["31.01"]);
    expect(cods(filtrarCodigos(OPCOES, "edificações 14"))).toEqual(["31.01"]);
  });
  it("código com letras: quem começa com o digitado vem antes", () => {
    const o: OpcaoCodigo[] = [{ codigo: "X9", descricao: "tem ab no meio" }, { codigo: "AB1", descricao: "outro" }];
    expect(cods(filtrarCodigos(o, "ab"))).toEqual(["AB1", "X9"]);
    expect(cods(filtrarCodigos(o, "  ab "))).toEqual(["AB1", "X9"]); // espaço em volta não atrapalha
  });
  it("blocos (grupos) ficam na ordem e não se misturam", () => {
    const o: OpcaoCodigo[] = [
      { codigo: "9914", descricao: "usado", grupo: "A" }, { codigo: "1401", descricao: "usado", grupo: "A" },
      { codigo: "14.01", descricao: "lc", grupo: "B" },
    ];
    expect(filtrarCodigos(o, "14").map((x) => `${x.grupo}:${x.codigo}`)).toEqual(["A:1401", "A:9914", "B:14.01"]);
  });
  it("acha na lista real da LC 116", () => {
    expect(cods(filtrarCodigos(LISTA_LC116, "ar condicionado"))).toEqual([]);
    expect(filtrarCodigos(LISTA_LC116, "1406")[0].codigo).toBe("14.06");
    expect(cods(filtrarCodigos(LISTA_LC116, "lubrificacao"))).toContain("14.01");
  });
});

describe("Opções do código municipal", () => {
  it("primeiro os já usados (com os serviços), depois a LC 116 de apoio", () => {
    const r = opcoesCodigoMunicipal([
      { codigoMunicipal: "140101", nome: "Limpeza" }, { codigoMunicipal: " 140101 ", nome: "Higienização" },
      { codigoMunicipal: "07020", nome: "Obra" }, { codigoMunicipal: null, nome: "Sem" }, { codigoMunicipal: "  ", nome: "Branco" },
    ], [{ codigo: "14.01", descricao: "Lubrificação" }]);
    expect(r).toEqual([
      { codigo: "07020", descricao: "Em uso: Obra", grupo: GRUPO_USADOS },
      { codigo: "140101", descricao: "Em uso: Limpeza, Higienização", grupo: GRUPO_USADOS },
      { codigo: "14.01", descricao: "Lubrificação", grupo: GRUPO_LC116 },
    ]);
  });
  it("muitos serviços no mesmo código: mostra 3 e conta o resto; ordem numérica", () => {
    const r = opcoesCodigoMunicipal(["A", "B", "C", "D", "E"].map((nome) => ({ codigoMunicipal: "10", nome })).concat([{ codigoMunicipal: "9", nome: "Z" }]), []);
    expect(r.map((o) => o.codigo)).toEqual(["9", "10"]);
    expect(r[1].descricao).toBe("Em uso: A, B, C e mais 2");
    expect(opcoesCodigoMunicipal([{ codigoMunicipal: "1", nome: "A" }, { codigoMunicipal: "1", nome: "B" }, { codigoMunicipal: "1", nome: "C" }], [])[0].descricao).toBe("Em uso: A, B, C");
  });
  it("sem nada usado: só a LC 116", () => {
    expect(opcoesCodigoMunicipal([], LISTA_LC116).every((o) => o.grupo === GRUPO_LC116)).toBe(true);
    expect(opcoesCodigoMunicipal([], LISTA_LC116)).toHaveLength(LISTA_LC116.length);
  });
});
