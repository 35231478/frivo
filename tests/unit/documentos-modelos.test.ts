/**
 * AS REGRAS PURAS dos modelos de documento.
 *
 * O que se prova:
 *  - o motor de {{campos}} troca o que conhece e DEIXA VISÍVEL o que não conhece (o mesmo do
 *    contrato da admissão, agora compartilhado);
 *  - cada tipo traz a sua gaveta, a sua permissão e o seu comportamento de itens — a advertência
 *    é a única que exige a permissão disciplinar;
 *  - a ficha de EPI exige o CA de cada item: é ele que dá valor legal ao papel;
 *  - a validade vira dia de vencimento no fuso da casa (e sem validade não vence nada);
 *  - o modelo só é salvo quando faz sentido (nome, tipo, texto, categoria conhecida, validade).
 */
import { describe, expect, it } from "vitest";
import {
  CAMPOS_AUTOMATICOS, ID_CAMPOS_AUTOMATICOS, ITENS_MAX, TIPOS, TIPOS_DOCUMENTO, TIPOS_SENSIVEIS,
  acaoDoTipo, camposAPreencher, camposConhecidos, camposDesconhecidosDoModelo, categoriaDoModelo,
  ehSensivel, ehTipoValido, erroDoModelo, erroDosItens, limparItens, preencherModelo,
  temItensPadrao, tipoDe, tituloDoDocumento, vencimentoDe, type ItemDocumento,
} from "@/lib/documentos/modelos";
import { CATEGORIAS } from "@/lib/colaborador/documentos";
import { camposUsados } from "@/lib/texto/modelo";

/** 16/11/2026, 09:00 em Brasília */
const AGORA = new Date("2026-11-16T12:00:00.000Z");

const item = (extra: Partial<ItemDocumento> = {}): ItemDocumento =>
  ({ descricao: "Luva de vaqueta", ca: "12345", quantidade: 2, ...extra });

describe("o motor de campos entre chaves", () => {
  it("troca o que conhece e deixa o resto como está", () => {
    const texto = "{{empresa}} entrega a {{nome}}, {{cargo}}, em {{data}}. Resp.: {{supervisor}}";
    const saiu = preencherModelo(texto, { empresa: "Clima Total", nome: "Marina", cargo: "Técnica", data: "16/11/2026" });
    expect(saiu).toBe("Clima Total entrega a Marina, Técnica, em 16/11/2026. Resp.: {{supervisor}}");
  });

  it("aceita espaço dentro das chaves e não repete campo na lista", () => {
    expect(preencherModelo("{{ nome }} e {{nome}}", { nome: "Marina" })).toBe("Marina e Marina");
    expect(camposUsados("{{ nome }} e {{nome}} e {{cargo}}")).toEqual(["nome", "cargo"]);
  });

  it("valor vazio é valor: entra como string vazia, só null e undefined ficam no texto", () => {
    expect(preencherModelo("[{{obs}}]", { obs: "" })).toBe("[]");
    expect(preencherModelo("[{{obs}}]", { obs: null })).toBe("[{{obs}}]");
    expect(preencherModelo("[{{obs}}]", {})).toBe("[{{obs}}]");
  });

  it("campo desconhecido é listado por tipo — o do tipo conta como conhecido", () => {
    const texto = "Advertência por {{motivo}} em {{ocorridoEm}}. Testemunha: {{testemunha}}";
    expect(camposDesconhecidosDoModelo(texto, "ADVERTENCIA")).toEqual(["testemunha"]);
    // o mesmo texto num tipo que não tem esses campos acusa os dois
    expect(camposDesconhecidosDoModelo(texto, "EPI")).toEqual(["motivo", "ocorridoEm", "testemunha"]);
  });

  it("os campos automáticos são os mesmos da lista mostrada na tela, sem repetição", () => {
    expect(ID_CAMPOS_AUTOMATICOS).toHaveLength(CAMPOS_AUTOMATICOS.length);
    expect(new Set(ID_CAMPOS_AUTOMATICOS).size).toBe(ID_CAMPOS_AUTOMATICOS.length);
    expect(camposConhecidos("EPI")).toContain("entregaEm");
    expect(camposConhecidos("EPI")).not.toContain("motivo");
  });

  it("a tela de gerar só pergunta os campos do tipo que o modelo realmente usa", () => {
    const pedidos = camposAPreencher("Advertência por {{motivo}}.", "ADVERTENCIA").map((c) => c.id);
    expect(pedidos).toEqual(["motivo"]);
  });
});

describe("os tipos", () => {
  it("cada tipo tem gaveta conhecida, e só a advertência exige a permissão disciplinar", () => {
    for (const t of TIPOS) {
      expect(CATEGORIAS.some((c) => c.id === t.categoria), `${t.id} → ${t.categoria}`).toBe(true);
    }
    expect(TIPOS_SENSIVEIS).toEqual(["ADVERTENCIA"]);
    expect(acaoDoTipo("ADVERTENCIA")).toBe("disciplinar");
    expect(acaoDoTipo("EPI")).toBe("criar");
    expect(ehSensivel("ADVERTENCIA")).toBe(true);
    expect(ehSensivel("TERMO")).toBe(false);
  });

  it("tipo desconhecido cai no último (OUTRO) em vez de explodir", () => {
    expect(tipoDe("NAO_EXISTE").id).toBe("OUTRO");
    expect(tipoDe(null).id).toBe("OUTRO");
    expect(ehTipoValido("EPI")).toBe(true);
    expect(ehTipoValido("QUALQUER")).toBe(false);
    expect([...TIPOS_DOCUMENTO]).toEqual(TIPOS.map((t) => t.id));
  });

  it("só a ficha de EPI nasce com a lista de itens ligada", () => {
    expect(temItensPadrao("EPI")).toBe(true);
    expect(temItensPadrao("TERMO")).toBe(false);
    expect(temItensPadrao("ADVERTENCIA")).toBe(false);
  });

  it("a gaveta do modelo manda; sem ela, vale a do tipo", () => {
    expect(categoriaDoModelo({ tipo: "EPI" })).toBe("ficha_epi");
    expect(categoriaDoModelo({ tipo: "EPI", categoria: "outros" })).toBe("outros");
    expect(categoriaDoModelo({ tipo: "ADVERTENCIA" })).toBe("disciplinar");
  });
});

describe("a lista de itens", () => {
  it("a ficha de EPI exige pelo menos um item", () => {
    expect(erroDosItens([], "EPI")).toBe("Acrescente pelo menos um item entregue.");
    expect(erroDosItens([item()], "EPI")).toBeNull();
  });

  it("no EPI o CA é obrigatório, e a mensagem diz o porquê", () => {
    const erro = erroDosItens([item({ ca: "" })], "EPI");
    expect(erro).toContain("CA");
    expect(erro).toContain("termo de responsabilidade");
    // no termo, o mesmo item sem CA passa
    expect(erroDosItens([item({ ca: "" })], "TERMO")).toBeNull();
  });

  it("descrição e quantidade são conferidas", () => {
    expect(erroDosItens([item({ descricao: "  " })], "EPI")).toContain("descreva");
    expect(erroDosItens([item({ quantidade: 0 })], "EPI")).toContain("inteiro a partir de 1");
    expect(erroDosItens([item({ quantidade: 1.5 })], "EPI")).toContain("inteiro");
    expect(erroDosItens([item({ quantidade: 99_999 })], "EPI")).toContain("acima do limite");
  });

  it("tipo sem lista recusa itens, e o teto vale", () => {
    expect(erroDosItens([item()], "ADVERTENCIA")).toContain("não tem lista de itens");
    const muitos = Array.from({ length: ITENS_MAX + 1 }, () => item());
    expect(erroDosItens(muitos, "EPI")).toContain(String(ITENS_MAX));
  });

  it("data de entrega torta é recusada", () => {
    expect(erroDosItens([item({ entregaEm: "16/11/2026" })], "EPI")).toContain("inválida");
    expect(erroDosItens([item({ entregaEm: "2026-11-16" })], "EPI")).toBeNull();
  });

  it("limpar apara, arredonda e descarta a linha vazia que a tela deixa no fim", () => {
    const limpos = limparItens([
      { descricao: "  Botina  ", ca: " 4321 ", quantidade: 2.9 },
      { descricao: "", ca: "" },
      { descricao: "Capacete" },
    ]);
    expect(limpos).toEqual([
      { descricao: "Botina", ca: "4321", quantidade: 2, entregaEm: undefined },
      { descricao: "Capacete", ca: undefined, quantidade: 1, entregaEm: undefined },
    ]);
  });
});

describe("o modelo", () => {
  const bom = { nome: "Ficha de EPI", tipo: "EPI", texto: "Recebi os equipamentos abaixo.", temItens: true };

  it("o que está em ordem passa", () => {
    expect(erroDoModelo(bom)).toBeNull();
  });

  it("nome, tipo e texto são conferidos", () => {
    expect(erroDoModelo({ ...bom, nome: " " })).toContain("nome");
    expect(erroDoModelo({ ...bom, nome: "a".repeat(81) })).toContain("80");
    expect(erroDoModelo({ ...bom, tipo: "INVENTADO" })).toContain("tipo");
    expect(erroDoModelo({ ...bom, texto: "curto" })).toContain("texto");
  });

  it("categoria desconhecida é recusada — gaveta errada é pior do que gaveta nenhuma", () => {
    expect(erroDoModelo({ ...bom, categoria: "nao_existe" })).toBe("Categoria desconhecida.");
    expect(erroDoModelo({ ...bom, categoria: "ficha_epi" })).toBeNull();
  });

  it("o EPI não pode desligar a lista de itens, e a advertência não pode ligar", () => {
    expect(erroDoModelo({ ...bom, temItens: false })).toContain("NR-6");
    expect(erroDoModelo({ nome: "Advertência", tipo: "ADVERTENCIA", texto: "Fica advertido por {{motivo}}.", temItens: true }))
      .toContain("não tem lista de itens");
  });

  it("a validade é um número de dias dentro do limite", () => {
    expect(erroDoModelo({ ...bom, validadeDias: 0 })).toContain("a partir de 1");
    expect(erroDoModelo({ ...bom, validadeDias: 4000 })).toContain("3650");
    expect(erroDoModelo({ ...bom, validadeDias: 365 })).toBeNull();
    expect(erroDoModelo({ ...bom, validadeDias: null })).toBeNull();
  });
});

describe("validade e título", () => {
  it("a validade conta a partir da entrega, no dia civil", () => {
    const venc = vencimentoDe(30, AGORA);
    expect(venc?.toISOString().slice(0, 10)).toBe("2026-12-16");
  });

  it("sem validade, nada vence", () => {
    expect(vencimentoDe(null, AGORA)).toBeNull();
    expect(vencimentoDe(0, AGORA)).toBeNull();
  });

  it("o título diz o que é e de quem é — o RH arquiva por nome", () => {
    expect(tituloDoDocumento("Ficha de EPI", "Marina Alves")).toBe("Ficha de EPI - Marina Alves");
  });
});
