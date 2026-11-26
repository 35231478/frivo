// @vitest-environment happy-dom
/**
 * Implantação, levas 3 e 4 — o motor (puro) e as telas (DOM real).
 *  - estoque inicial: produto por código → id → nome (nome repetido = erro, não existe = erro com o nome
 *    digitado); quantidade = saldo final (≥ 0); custo opcional e só para quem vê custo; avisos de "igual",
 *    "baixa" e "já tem movimentação";
 *  - colaboradores: CPF pelos dígitos; novo precisa ser válido; telefone só ao criar; função e equipe;
 *    CPF repetido no cadastro só com o id_sistema; o CPF não muda pela planilha;
 *  - veículos: placa sem hífen/espaço (antiga e Mercosul), responsável pelo CPF, ano, tipo, km;
 *  - defPara: a coluna de custo some para quem não vê custo (e sempre para o papel TECNICO);
 *  - etapas: módulo desligado tira a etapa; progresso arredonda para baixo; próxima etapa;
 *  - telas: Implantação (contagens, atalhos só com permissão e módulo, modelo), destaque do painel,
 *    o assistente com o custo só para quem pode e o "baixar" dentro dele.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { montarPermissoes, permissoesTotais, pode, type Permissoes } from "@/lib/permissoes";
import { analisar, type ContextoImportacao } from "@/lib/importacao/motor";
import { chavePlaca, defPara, IMPORTACOES, PERMISSOES_IMPORTACAO, placaValida } from "@/lib/importacao/entidades";
import { destaqueNoPainel, ehEtapaId, montarEtapas, progresso, type Contagens } from "@/lib/implantacao/etapas";
import { itemConfig, podeVerItemConfig } from "@/lib/navegacao/configuracoes";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }), usePathname: () => "/configuracoes", useSearchParams: () => new URLSearchParams() }));

function cpf(base: string) {
  const d = base.split("").map(Number);
  const dv = (n: number) => { const s = d.slice(0, n).reduce((a, x, i) => a + x * (n + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
  d.push(dv(9)); d.push(dv(10)); return d.join("");
}
const CPF_A = cpf("731004501"), CPF_B = cpf("731004502");
const todas = (permitido: (m: string, a: any) => boolean) => permitido;
const tudo = todas(() => true);

const validar = (entidade: keyof typeof IMPORTACOES, o: Record<string, string | number | null>, c: ContextoImportacao) => {
  const def = IMPORTACOES[entidade];
  return def.validar(Object.fromEntries(def.colunas.map((k) => [k.chave, o[k.chave] ?? null])), c);
};

/* ═════════════ Estoque inicial ═════════════ */
const ctxEstoque = (o: Partial<ContextoImportacao> = {}): ContextoImportacao => ({
  existentes: new Map([["cod:1", "p-gas"], ["id:p-gas", "p-gas"], ["nome:gas r22", "p-gas"], ["cod:2", "p-filtro"], ["nome:filtro de ar", "p-filtro"], ["cod:5", "p-sem"], ["cod:6", "p-off"]]),
  refs: {}, podeAtualizar: true, permitido: tudo,
  mapas: {
    ambiguas: new Map([["nome:capacitor", "2"]]),
    saldos: new Map([["p-gas", "0"], ["p-filtro", "10"]]),
    semControle: new Map([["p-sem", "1"]]), inativos: new Map([["p-off", "1"]]),
    comMovimento: new Map([["p-filtro", "3"]]),
  },
  ...o,
});

describe("estoque inicial (motor)", () => {
  it("produto pelo código, id ou nome (sem acento/maiúsculas); quantidade e custo em formato BR", () => {
    const r = validar("estoque", { codigo: "1", quantidade: "12,5", custo_unitario: "R$ 389,90" }, ctxEstoque());
    expect(r).toMatchObject({ ok: true, chaves: ["cod:1"], dados: { quantidade: 12.5, custoUnitario: 389.9 }, rotulo: "código 1" });
    expect(validar("estoque", { produto: "GÁS r22", quantidade: 3 }, ctxEstoque())).toMatchObject({ ok: true, chaves: ["nome:gas r22"], rotulo: "GÁS r22" });
    expect(validar("estoque", { produto: "x", quantidade: 1, id_sistema: "p-gas" }, ctxEstoque())).toMatchObject({ ok: true, chaves: ["id:p-gas"] });
  });

  it("erros: sem produto, sem quantidade, negativo, texto, nome repetido, não existe (com o nome digitado), não controla, inativo", () => {
    const e = (o: Record<string, string | number | null>) => { const r = validar("estoque", o, ctxEstoque()); return r.ok ? "" : r.erros.join(" "); };
    expect(e({ quantidade: 1 })).toMatch(/produto: informe o nome ou o código/);
    expect(e({ codigo: "1" })).toMatch(/quantidade: obrigatória/);
    expect(e({ codigo: "1", quantidade: "-1" })).toMatch(/não pode ser negativo/);
    expect(e({ codigo: "1", quantidade: "três" })).toMatch(/quantidade: “três” não é um número/);
    expect(e({ codigo: "1", quantidade: 1, custo_unitario: "-5" })).toMatch(/custo_unitario: o custo não pode ser negativo/);
    expect(e({ produto: "Capacitor", quantidade: 1 })).toMatch(/há 2 produtos com o nome “Capacitor”\. Use o código/);
    expect(e({ produto: "Compressor Ãncora", quantidade: 1 })).toMatch(/produto “Compressor Ãncora” não está cadastrado/);
    expect(e({ codigo: "5", quantidade: 1 })).toMatch(/não controla estoque/);
    expect(e({ codigo: "6", quantidade: 1 })).toMatch(/está inativo/);
    // Com o código, o nome repetido não atrapalha
    expect(validar("estoque", { codigo: "1", produto: "Capacitor", quantidade: 1 }, ctxEstoque()).ok).toBe(true);
  });

  it("avisos: saldo igual (e o custo que não entraria), baixa (sem custo) e produto que já tem movimentação", () => {
    const av = (o: Record<string, string | number | null>) => { const r = validar("estoque", o, ctxEstoque()); return r.ok ? (r.avisos ?? []).join(" ") : "ERRO"; };
    expect(av({ codigo: "2", quantidade: 10 })).toBe("O saldo já é 10: nada a lançar.");
    expect(av({ codigo: "2", quantidade: 10, custo_unitario: 5 })).toMatch(/o custo só entra junto com uma entrada de quantidade/);
    expect(av({ codigo: "2", quantidade: "2,5" })).toBe("O saldo cai de 10 para 2,5 (ajuste de inventário).");
    expect(av({ codigo: "2", quantidade: 1, custo_unitario: 5 })).toMatch(/numa baixa o custo não entra/);
    expect(av({ codigo: "2", quantidade: 13 })).toBe("Este produto já tem movimentações: entra só a diferença (+3).");
    expect(av({ codigo: "1", quantidade: 4 })).toBe(""); // saldo 0, sem movimentação: nada a avisar
  });

  it("custo: sem a permissão de ver custo é erro (a coluna nem chega, mas o motor não confia na tela)", () => {
    const r = validar("estoque", { codigo: "1", quantidade: 1, custo_unitario: 10 }, ctxEstoque({ permitido: (m, a) => m === "estoque" && a === "gerenciar" }));
    expect(r.ok ? "" : r.erros.join(" ")).toMatch(/custo_unitario: exige a permissão de ver o custo/);
  });

  it("defPara: a coluna de custo só para quem vê custo (Estoque › ver ou Orçamentos › ver custo), nunca para o TECNICO", () => {
    const cols = (p: Permissoes, papel?: string) => defPara("estoque", (m, a) => pode(p, m, a, papel), papel).colunas.map((c) => c.chave);
    expect(cols(montarPermissoes({ estoque: ["gerenciar"] }))).toEqual(["codigo", "produto", "quantidade", "id_sistema"]);
    expect(cols(montarPermissoes({ estoque: ["gerenciar", "visualizar"] }))).toContain("custo_unitario");
    expect(cols(montarPermissoes({ estoque: ["gerenciar"], orcamentos: ["verCusto"] }))).toContain("custo_unitario");
    expect(cols(permissoesTotais(), "TECNICO")).not.toContain("custo_unitario");
    // As outras planilhas não têm coluna restrita: o mesmo objeto
    expect(defPara("clientes", () => false)).toBe(IMPORTACOES.clientes);
  });

  it("na planilha sem a coluna de custo (modelo de quem não vê), o cabeçalho “custo” é ignorado", () => {
    const def = defPara("estoque", (m, a) => m === "estoque" && a === "gerenciar");
    const a = analisar([["codigo", "quantidade", "custo_unitario"], ["1", "2", "50"]], def, ctxEstoque({ permitido: (m, x) => m === "estoque" && x === "gerenciar" }));
    expect(a.colunasIgnoradas).toEqual(["custo_unitario"]);
    expect(a.linhas[0]).toMatchObject({ status: "atualizar", erros: [] });
  });
});

/* ═════════════ Colaboradores ═════════════ */
const ctxColab = (o: Partial<ContextoImportacao> = {}): ContextoImportacao => ({
  existentes: new Map([["cpf:90000000001", "t-velho"], ["id:t-velho", "t-velho"], ["id:t-d1", "t-d1"], ["id:t-d2", "t-d2"]]),
  refs: { cargo: [{ valor: "cg-tec", rotulo: "Técnico de Refrigeração" }] }, podeAtualizar: true,
  mapas: { ambiguas: new Map([[`cpf:${CPF_B}`, "2"]]) },
  ...o,
});
describe("colaboradores (motor)", () => {
  it("novo: CPF válido formatado, telefone, função (vazio = técnico de campo) e equipe pela função", () => {
    expect(validar("colaboradores", { nome: "rafael teixeira", cpf: CPF_A, telefone: "31988880101", cargo: "tecnico de refrigeracao", estado: "mg" }, ctxColab()))
      .toMatchObject({ ok: true, chaves: [`cpf:${CPF_A}`], dados: { nome: "Rafael Teixeira", cpf: `${CPF_A.slice(0, 3)}.${CPF_A.slice(3, 6)}.${CPF_A.slice(6, 9)}-${CPF_A.slice(9)}`, tipo: "TECNICO_CAMPO", tipoEquipe: "CAMPO", cargoId: "cg-tec", estado: "MG" } });
    expect(validar("colaboradores", { nome: "Ju", cpf: CPF_A, telefone: "31988880101", funcao: "adm" }, ctxColab())).toMatchObject({ dados: { tipo: "ADMINISTRATIVO", tipoEquipe: "ADMINISTRATIVO" } });
    expect(validar("colaboradores", { nome: "Mo", cpf: CPF_A, telefone: "31988880101", funcao: "Motorista" }, ctxColab())).toMatchObject({ dados: { tipo: "MOTORISTA", tipoEquipe: "CAMPO" } });
    expect(validar("colaboradores", { nome: "Rt", cpf: CPF_A, telefone: "31988880101", funcao: "RT", equipe: "Campo" }, ctxColab())).toMatchObject({ dados: { tipo: "RESPONSAVEL_TECNICO", tipoEquipe: "CAMPO" } });
  });

  it("existente: casa pelos dígitos mesmo com CPF antigo inválido; sem telefone pode; função e equipe vazias não mudam", () => {
    const r = validar("colaboradores", { nome: "Carlos", cpf: "900.000.000-01" }, ctxColab());
    expect(r).toMatchObject({ ok: true, chaves: ["cpf:90000000001"] });
    expect(r.ok && r.dados.tipo).toBeUndefined();
    expect(r.ok && r.dados.tipoEquipe).toBeUndefined();
  });

  it("erros: CPF novo inválido, curto; telefone incompleto; e-mail; CPF repetido sem id; CPF trocado com id", () => {
    const e = (o: Record<string, string | number | null>) => { const r = validar("colaboradores", o, ctxColab()); return r.ok ? "" : r.erros.join(" "); };
    expect(e({ nome: "X", cpf: "111.222.333-44", telefone: "31988880101" })).toMatch(/não é um CPF válido/);
    expect(e({ nome: "X", cpf: "123", telefone: "31988880101" })).toMatch(/cpf: “123” não tem 11 dígitos/);
    expect(e({ nome: "X", cpf: CPF_A, telefone: "1234" })).toMatch(/telefone: “1234” está incompleto/);
    expect(e({ nome: "X", cpf: CPF_A, telefone: "31988880101", email: "sem-arroba" })).toMatch(/não é um e-mail válido/);
    expect(e({ nome: "", cpf: "" })).toMatch(/nome: obrigatório.*cpf: obrigatório/);
    expect(e({ nome: "X", cpf: CPF_B, telefone: "31988880101" })).toMatch(/está em 2 colaboradores desta empresa/);
    expect(e({ nome: "X", cpf: CPF_A, id_sistema: "t-velho" })).toMatch(/O CPF não muda pela planilha/);
  });

  it("sem telefone: entra com aviso só ao cadastrar (decisão do Zé); o existente não recebe aviso", () => {
    const novo = validar("colaboradores", { nome: "X", cpf: CPF_A }, ctxColab());
    expect(novo).toMatchObject({ ok: true, avisos: [expect.stringMatching(/Sem telefone: o colaborador entra, mas o app e o WhatsApp precisam do telefone/)] });
    expect(validar("colaboradores", { nome: "Carlos", cpf: "90000000001" }, ctxColab())).toMatchObject({ ok: true, avisos: [] });
  });

  it("cargo: o ativo casa; o que não existe vira 'cargo novo' com aviso; o inativo é erro (não recria)", () => {
    const c = ctxColab({ mapas: { ...ctxColab().mapas, cargosInativos: new Map([["cargo antigo", "cg-off"]]) } });
    expect(validar("colaboradores", { nome: "X", cpf: CPF_A, telefone: "31988880101", cargo: "TÉCNICO de refrigeração" }, c)).toMatchObject({ ok: true, avisos: [], dados: { cargoId: "cg-tec", cargoNovo: undefined } });
    expect(validar("colaboradores", { nome: "X", cpf: CPF_A, telefone: "31988880101", cargo: " Encarregado " }, c))
      .toMatchObject({ ok: true, avisos: ["cargo “Encarregado” não existe: será criado em Configurações › Cargos."], dados: { cargoId: undefined, cargoNovo: "Encarregado" } });
    const r = validar("colaboradores", { nome: "X", cpf: CPF_A, telefone: "31988880101", cargo: "Cargo Antigo" }, c);
    expect(r.ok ? "" : r.erros.join(" ")).toMatch(/cargo “Cargo Antigo” está inativo/);
    const longo = validar("colaboradores", { nome: "X", cpf: CPF_A, telefone: "31988880101", cargo: "x".repeat(101) }, c);
    expect(longo.ok ? "" : longo.erros.join(" ")).toMatch(/cargo: no máximo 100/);
  });

  it("CPF repetido no cadastro: com o id_sistema, é o id que decide (o CPF sai das chaves)", () => {
    expect(validar("colaboradores", { nome: "X", cpf: CPF_B, id_sistema: "t-d1" }, ctxColab())).toMatchObject({ ok: true, chaves: ["id:t-d1"] });
    expect(validar("colaboradores", { nome: "Y", cpf: CPF_B, id_sistema: "t-d2" }, ctxColab())).toMatchObject({ ok: true, chaves: ["id:t-d2"] });
  });
});

/* ═════════════ Veículos ═════════════ */
const ctxVeic = (o: Partial<ContextoImportacao> = {}): ContextoImportacao => ({
  existentes: new Map([["placa:ABC1234", "v1"], ["id:v1", "v1"], ["id:v2", "v2"]]),
  refs: {}, podeAtualizar: true,
  mapas: { ambiguas: new Map([["placa:XYZ1A11", "2"]]), colaboradores: new Map([[`cpf:${CPF_A}`, "t-a"]]), colaboradoresAmbiguos: new Map([[`cpf:${CPF_B}`, "2"]]) },
  ...o,
});
describe("veículos (motor)", () => {
  it("placa: sem hífen, espaço e ponto, em maiúsculas; antiga e Mercosul", () => {
    expect(chavePlaca(" frv-9a.11 ")).toBe("FRV9A11");
    expect(placaValida("ABC1234")).toBe(true);
    expect(placaValida("ABC1D23")).toBe(true);
    expect(placaValida("AB12345")).toBe(false);
    expect(placaValida("ABCD123")).toBe(false);
    expect(placaValida("ABC12345")).toBe(false);
  });

  it("novo e existente; responsável pelo CPF; tipo por apelido; km e ano", () => {
    expect(validar("veiculos", { placa: "frv-9a11", modelo: "Fiorino", tipo: "furgão", quilometragem: "45.300", ano: "2022", responsavel_cpf: CPF_A, chassi: "9bd abc" }, ctxVeic()))
      .toMatchObject({ ok: true, chaves: ["placa:FRV9A11"], dados: { placa: "FRV9A11", tipo: "VAN", quilometragemAtual: 45300, ano: "2022", responsavelId: "t-a", chassi: "9BD ABC" } });
    const velho = validar("veiculos", { placa: "abc 1234", modelo: "Saveiro" }, ctxVeic());
    expect(velho).toMatchObject({ ok: true, chaves: ["placa:ABC1234"] });
    expect(velho.ok && velho.dados.tipo).toBeUndefined(); // tipo vazio não muda o existente
    expect(validar("veiculos", { placa: "FRV9B22", modelo: "Uno" }, ctxVeic())).toMatchObject({ dados: { tipo: "CARRO" } });
  });

  it("erros: placa, modelo, ano, tipo, km, responsável (inexistente e repetido), placa repetida sem id e placa trocada com id", () => {
    const e = (o: Record<string, string | number | null>) => { const r = validar("veiculos", o, ctxVeic()); return r.ok ? "" : r.erros.join(" "); };
    expect(e({ placa: "12345", modelo: "Uno" })).toMatch(/placa: “12345” não é uma placa/);
    expect(e({ placa: "", modelo: "" })).toMatch(/placa: obrigatória.*modelo: obrigatório/);
    expect(e({ placa: "FRV9B22", modelo: "Uno", ano: "1949" })).toMatch(/ano: “1949” não é um ano/);
    expect(e({ placa: "FRV9B22", modelo: "Uno", ano_modelo: "22" })).toMatch(/ano_modelo: “22” não é um ano/);
    expect(e({ placa: "FRV9B22", modelo: "Uno", tipo: "Avião" })).toMatch(/tipo “Avião” não existe/);
    expect(e({ placa: "FRV9B22", modelo: "Uno", quilometragem: "1,5" })).toMatch(/quilometragem: use um número inteiro/);
    expect(e({ placa: "FRV9B22", modelo: "Uno", quilometragem: "-3" })).toMatch(/quilometragem: não pode ser negativa/);
    expect(e({ placa: "FRV9B22", modelo: "Uno", responsavel_cpf: "529.982.247-25" })).toMatch(/nenhum colaborador com o CPF 529\.982\.247-25/);
    expect(e({ placa: "FRV9B22", modelo: "Uno", responsavel_cpf: CPF_B })).toMatch(/está em mais de um colaborador/);
    expect(e({ placa: "FRV9B22", modelo: "Uno", responsavel_cpf: "123" })).toMatch(/não tem 11 dígitos/);
    expect(e({ placa: "xyz-1a11", modelo: "Kombi" })).toMatch(/está em 2 veículos desta empresa/);
    expect(e({ placa: "FRV9B22", modelo: "Uno", id_sistema: "v1" })).toMatch(/A placa não muda pela planilha/);
    expect(e({ placa: "FRV9B22", modelo: "Uno", combustivel: "x".repeat(31) })).toMatch(/no máximo 30/);
  });

  it("placa repetida no cadastro com o id_sistema: o id decide", () => {
    expect(validar("veiculos", { placa: "XYZ1A11", modelo: "Kombi", id_sistema: "v2" }, ctxVeic())).toMatchObject({ ok: true, chaves: ["id:v2"] });
  });

  it("a mesma placa duas vezes na planilha (escrita diferente) = erro na 2ª", () => {
    const a = analisar([["placa", "modelo"], ["FRV-9A11", "Fiorino"], ["frv 9a11", "Fiorino"]], IMPORTACOES.veiculos, ctxVeic());
    expect(a.linhas[1]).toMatchObject({ status: "erro", erros: [expect.stringMatching(/Repete a linha 2/)] });
  });
});

describe("permissões das planilhas novas", () => {
  it("estoque = Estoque › gerenciar; colaboradores = Equipes › gerenciar; veículos = Frota › gerenciar", () => {
    expect(PERMISSOES_IMPORTACAO.estoque).toEqual({ criar: [["estoque", "gerenciar"]], editar: [["estoque", "gerenciar"]] });
    expect(PERMISSOES_IMPORTACAO.colaboradores).toEqual({ criar: [["equipes", "gerenciar"]], editar: [["equipes", "gerenciar"]] });
    expect(PERMISSOES_IMPORTACAO.veiculos).toEqual({ criar: [["veiculos", "gerenciar"]], editar: [["veiculos", "gerenciar"]] });
  });
  it("colaboradores nunca levam salário, acesso ou dados bancários (nem no modelo)", () => {
    const cols = IMPORTACOES.colaboradores.colunas.map((c) => c.chave);
    expect(cols).toEqual(["nome", "cpf", "telefone", "email", "funcao", "equipe", "cargo", "crea", "endereco", "numero", "complemento", "bairro", "cidade", "estado", "cep", "observacoes", "id_sistema"]);
    for (const proibido of ["salario", "perfil", "senha", "banco", "agencia", "conta", "pix", "rg", "pis", "usuario"]) expect(cols).not.toContain(proibido);
  });
});

/* ═════════════ Etapas ═════════════ */
const VAZIO: Contagens = { dadosEmpresa: false, logo: false, tiposOs: 0, usuarios: 1, clientes: 0, unidades: 0, contatos: 0, equipamentos: 0, produtosEstoque: 0, produtosComSaldo: 0, colaboradores: 0, veiculos: 0, contratos: 0, pmocs: 0 };
const CHEIO: Contagens = { dadosEmpresa: true, logo: true, tiposOs: 3, usuarios: 4, clientes: 10, unidades: 12, contatos: 8, equipamentos: 40, produtosEstoque: 20, produtosComSaldo: 15, colaboradores: 6, veiculos: 2, contratos: 0, pmocs: 1 };
describe("implantação (etapas)", () => {
  it("as 7 etapas na ordem; tudo vazio = 0% e a próxima é a 1ª", () => {
    const e = montarEtapas(VAZIO, () => true);
    expect(e.map((x) => `${x.numero}.${x.id}`)).toEqual(["1.empresa", "2.clientes", "3.equipamentos", "4.estoque", "5.colaboradores", "6.veiculos", "7.contratos"]);
    expect(progresso(e)).toMatchObject({ feitas: 0, total: 7, pct: 0, completa: false });
    expect(progresso(e).proxima?.id).toBe("empresa");
  });
  it("feita: empresa pede dados, logo e tipos de OS; estoque pede saldo lançado; contratos OU PMOC", () => {
    expect(montarEtapas({ ...CHEIO, logo: false }, () => true)[0].feita).toBe(false);
    expect(montarEtapas({ ...CHEIO, tiposOs: 0 }, () => true)[0].feita).toBe(false);
    expect(montarEtapas({ ...CHEIO, produtosComSaldo: 0 }, () => true).find((x) => x.id === "estoque")!.feita).toBe(false);
    expect(montarEtapas({ ...CHEIO, pmocs: 0, contratos: 1 }, () => true).find((x) => x.id === "contratos")!.feita).toBe(true);
    expect(montarEtapas({ ...CHEIO, pmocs: 0 }, () => true).find((x) => x.id === "contratos")!.feita).toBe(false);
    expect(progresso(montarEtapas(CHEIO, () => true))).toMatchObject({ feitas: 7, pct: 100, completa: true, proxima: null });
  });
  it("módulo desligado: a etapa some e as outras renumeram; contratos só some com os dois desligados", () => {
    const sem = (...fora: string[]) => montarEtapas(VAZIO, (m) => !fora.includes(m)).map((x) => x.id);
    expect(sem("veiculos", "estoque", "equipamentos")).toEqual(["empresa", "clientes", "colaboradores", "contratos"]);
    expect(sem("contratos")).toContain("contratos");
    expect(sem("contratos", "pmoc")).not.toContain("contratos");
    const so = montarEtapas(VAZIO, (m) => m !== "contratos").find((x) => x.id === "contratos")!;
    expect(so.itens.map((i) => i.rotulo)).toEqual(["Planos PMOC"]);
    expect(so.href).toBe("/pmoc");
    expect(montarEtapas(VAZIO, (m) => m !== "veiculos").map((x) => x.numero)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("destaque no painel: só quem configura a empresa e só abaixo de 100%; o cartão pede Configurações › Gerenciar", () => {
    const meio = progresso(montarEtapas(VAZIO, () => true));
    const pronto = progresso(montarEtapas(CHEIO, () => true));
    expect(destaqueNoPainel(true, meio)).toBe(true);
    expect(destaqueNoPainel(false, meio)).toBe(false);
    expect(destaqueNoPainel(true, pronto)).toBe(false);
    expect(destaqueNoPainel(true, null)).toBe(false);
    const item = itemConfig("implantacao")!;
    expect(item).toMatchObject({ aba: "conta", modulo: "configuracoes", acao: "gerenciar" });
    expect(podeVerItemConfig(item, montarPermissoes({ configuracoes: ["visualizar"] }), "OPERADOR")).toBe(false);
    expect(podeVerItemConfig(item, montarPermissoes({ configuracoes: ["visualizar", "gerenciar"] }), "OPERADOR")).toBe(true);
  });
  it("não se aplica / fazer depois: conta como concluída; feita de verdade vence a marcação; id desconhecido é ignorado", () => {
    const e = montarEtapas(VAZIO, () => true, ["contratos", "veiculos", "qualquer-coisa"]);
    expect(e.filter((x) => x.dispensada).map((x) => x.id)).toEqual(["veiculos", "contratos"]);
    expect(e.find((x) => x.id === "veiculos")!.feita).toBe(false);
    expect(progresso(e)).toMatchObject({ feitas: 2, total: 7, pct: 28 });
    expect(progresso(e).proxima?.id).toBe("empresa");
    // Já feita: não fica "dispensada"
    expect(montarEtapas({ ...VAZIO, veiculos: 1 }, () => true, ["veiculos"]).find((x) => x.id === "veiculos")).toMatchObject({ feita: true, dispensada: false });
    // Só falta o que foi marcado: 100% e o destaque sai do painel
    const quase = montarEtapas({ ...CHEIO, contratos: 0, pmocs: 0 }, () => true, ["contratos"]);
    expect(progresso(quase)).toMatchObject({ completa: true, pct: 100 });
    expect(destaqueNoPainel(true, progresso(quase))).toBe(false);
    expect(ehEtapaId("contratos")).toBe(true);
    expect(ehEtapaId("financeiro")).toBe(false);
  });

  it("progresso arredonda para baixo (6 de 7 = 85%, nunca 100% antes da hora)", () => {
    expect(progresso(montarEtapas({ ...CHEIO, logo: false }, () => true))).toMatchObject({ feitas: 6, pct: 85, completa: false });
    expect(progresso([])).toMatchObject({ total: 0, pct: 100, completa: true });
  });
});

/* ═════════════ Telas ═════════════ */
let root: Root | null = null;
let caixa: HTMLDivElement;
let PProv: any, MProv: any, ImportarPlanilha: any, PainelImplantacao: any, DestaqueImplantacao: any;
beforeAll(async () => {
  ({ PermissoesProvider: PProv } = await import("@/components/providers/permissoes-provider"));
  ({ ModulosProvider: MProv } = await import("@/components/providers/modulos-provider"));
  ({ ImportarPlanilha } = await import("@/components/importacao/importar-planilha"));
  ({ PainelImplantacao } = await import("@/components/implantacao/painel-implantacao"));
  ({ DestaqueImplantacao } = await import("@/components/dashboard/destaque-implantacao"));
});
afterEach(() => { act(() => root?.unmount()); caixa?.remove(); vi.unstubAllGlobals(); document.body.innerHTML = ""; });
const $ = (s: string) => document.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => Array.from(document.querySelectorAll(s)) as HTMLElement[];
const espera = async (ms = 20) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
async function render(el: any, permissoes: Permissoes = permissoesTotais(), desligados: string[] = [], role = "OPERADOR") {
  caixa = document.createElement("div"); document.body.appendChild(caixa); root = createRoot(caixa);
  await act(async () => { root!.render(createElement(MProv, { desligados }, createElement(PProv, { permissoes, role }, el))); });
}
async function abrirImportacao(entidade: string, permissoes?: Permissoes, role?: string) {
  await render(createElement(ImportarPlanilha, { entidade, rotulo: "Importar algo" }), permissoes, [], role);
  expect($(`[data-importar='${entidade}']`)!.textContent).toContain("Importar algo");
  await act(async () => { ($("[data-acao='importar-planilha']") as HTMLButtonElement).click(); });
  await espera();
}
async function escolherArquivo() {
  const input = $("[data-campo='arquivo']") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [new File(["x"], "e.csv")], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await espera();
}
const LIGAR = { erro: "Faltam colunas", ligar: { cabecalho: ["Cod", "Qtd", "Custo"], ligadas: {}, faltando: ["produto", "quantidade"] } };

describe("tela: assistente das planilhas novas", () => {
  it("estoque: o ligar colunas mostra o custo só para quem vê custo; o baixar fica no próprio assistente", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(LIGAR), { status: 400 })));
    await abrirImportacao("estoque", montarPermissoes({ estoque: ["gerenciar", "visualizar"] }));
    expect($("[data-acao='baixar-cadastrados']")!.textContent).toMatch(/Baixar o estoque atual/);
    expect($("[data-dica-exportar]")).toBeNull(); // não há "Baixar planilha" na lista para indicar
    await escolherArquivo();
    expect($$("[data-ligacao]").map((s) => s.dataset.ligacao)).toEqual(["codigo", "produto", "quantidade", "custo_unitario"]);
    act(() => root?.unmount()); caixa.remove(); document.body.innerHTML = "";

    await abrirImportacao("estoque", montarPermissoes({ estoque: ["gerenciar"] }));
    await escolherArquivo();
    expect($$("[data-ligacao]").map((s) => s.dataset.ligacao)).toEqual(["codigo", "produto", "quantidade"]);
    expect($("[data-importacao='estoque']")!.textContent).not.toContain("custo_unitario");
    act(() => root?.unmount()); caixa.remove(); document.body.innerHTML = "";

    await abrirImportacao("estoque", permissoesTotais(), "TECNICO");
    await escolherArquivo();
    expect($$("[data-ligacao]").map((s) => s.dataset.ligacao)).not.toContain("custo_unitario");
  });

  it("colaboradores e veículos: o baixar dentro do assistente; clientes continua com a dica do botão da lista", async () => {
    await abrirImportacao("colaboradores");
    expect($("[data-acao='baixar-cadastrados']")!.getAttribute("href")).toBe("/api/importacao/colaboradores/exportar");
    expect($("[data-aviso-previa]")).toBeNull(); // só na prévia
    act(() => root?.unmount()); caixa.remove(); document.body.innerHTML = "";
    await abrirImportacao("veiculos");
    expect($("[data-acao='baixar-cadastrados']")!.textContent).toMatch(/Baixar veículos já cadastrados/);
    act(() => root?.unmount()); caixa.remove(); document.body.innerHTML = "";
    await abrirImportacao("produtos");
    expect($("[data-acao='baixar-cadastrados']")).toBeNull();
    expect($("[data-dica-exportar]")).not.toBeNull();
  });
});

const etapasDe = (c: Contagens, tem: (m: string) => boolean = () => true) => { const e = montarEtapas(c, tem); return { etapas: e, progresso: progresso(e) }; };

describe("tela: Implantação", () => {
  it("progresso, etapas feitas e a fazer, contagens reais, item que abre a configuração, modelo e lista", async () => {
    await render(createElement(PainelImplantacao, etapasDe({ ...CHEIO, logo: false })));
    expect($("[data-implantacao-progresso]")!.dataset.implantacaoProgresso).toBe("85");
    expect($("[data-implantacao-progresso]")!.textContent).toMatch(/6 de 7 etapas.*85%.*Próxima etapa: Empresa e configurações/);
    expect($$("[data-etapa]").map((e) => `${e.dataset.etapa}:${e.dataset.etapaFeita}`)).toEqual(["empresa:nao", "clientes:sim", "equipamentos:sim", "estoque:sim", "colaboradores:sim", "veiculos:sim", "contratos:sim"]);
    expect($("[data-etapa='clientes']")!.textContent).toMatch(/Clientes10.*Unidades12.*Contatos8/);
    expect($("[data-etapa='empresa'] [data-item-etapa='Logo']")!.textContent).toMatch(/Logofalta/);
    expect($("[data-etapa='empresa'] [data-item-etapa='Logo'] a")!.getAttribute("href")).toBe("/configuracoes?aba=conta&secao=empresa");
    expect($("[data-etapa='empresa'] [data-item-etapa='Tipos de OS'] a")!.getAttribute("href")).toBe("/configuracoes?aba=operacionais&secao=tipos-os");
    // Clientes: UM botão (abre a família inteira) e o modelo de cada planilha
    expect($$("[data-etapa='clientes'] [data-importar]").map((b) => b.dataset.importar)).toEqual(["clientes"]);
    expect($$("[data-etapa='clientes'] [data-modelo]").map((a) => a.getAttribute("href"))).toEqual(["/api/importacao/clientes/modelo?formato=xlsx", "/api/importacao/unidades/modelo?formato=xlsx", "/api/importacao/contatos/modelo?formato=xlsx"]);
    // Estoque: produtos e saldos, cada um com o seu rótulo
    expect($$("[data-etapa='estoque'] [data-importar]").map((b) => `${b.dataset.importar}:${b.textContent!.trim()}`)).toEqual(["produtos:Importar produtos", "estoque:Importar saldos de estoque"]);
    expect($("[data-abrir-lista='veiculos']")!.getAttribute("href")).toBe("/veiculos");
    // Contratos: ainda sem planilha (L6), só a lista e o aviso
    expect($$("[data-etapa='contratos'] [data-importar]")).toHaveLength(0);
    expect($("[data-etapa='contratos']")!.textContent).toMatch(/A planilha de contratos e PMOC vem na última leva/);
  });

  it("atalhos só com a permissão de importar e o módulo ligado", async () => {
    await render(createElement(PainelImplantacao, etapasDe(VAZIO)), montarPermissoes({ clientes: ["criar", "editar"], equipes: ["visualizar"], veiculos: ["gerenciar"] }), ["veiculos"]);
    expect($$("[data-importar]").map((b) => b.dataset.importar)).toEqual(["clientes"]);
    expect($$("[data-modelo]").map((a) => a.dataset.modelo)).toEqual(["clientes", "unidades", "contatos"]);
    expect($("[data-etapa='colaboradores'] [data-abrir-lista]")).not.toBeNull(); // a lista continua (o portão é dela)
  });

  it("não se aplica / fazer depois: o botão marca, a etapa marcada mostra e reabre; só para quem configura", async () => {
    const pedidos: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init?: RequestInit) => { pedidos.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }));
    const e = montarEtapas({ ...CHEIO, contratos: 0, pmocs: 0, veiculos: 0 }, () => true, ["contratos"]);
    await render(createElement(PainelImplantacao, { etapas: e, progresso: progresso(e) }));
    expect($("[data-etapa='contratos']")!.dataset.etapaFeita).toBe("depois");
    expect($("[data-etapa='contratos'] [data-etapa-depois]")!.textContent).toMatch(/não se aplica \/ fazer depois/);
    expect($("[data-implantacao-progresso]")!.textContent).toMatch(/6 de 7 etapas · 1 para depois/);
    // Feita não tem botão; a pendente tem "Não se aplica"; a marcada tem "Reabrir"
    expect($("[data-etapa='clientes'] [data-acao$='-etapa']")).toBeNull();
    await act(async () => { ($("[data-etapa='veiculos'] [data-acao='dispensar-etapa']") as HTMLButtonElement).click(); });
    await act(async () => { ($("[data-etapa='contratos'] [data-acao='reabrir-etapa']") as HTMLButtonElement).click(); });
    expect(pedidos).toEqual([{ etapa: "veiculos", dispensada: true }, { etapa: "contratos", dispensada: false }]);
    act(() => root?.unmount()); caixa.remove(); document.body.innerHTML = "";
    // Sem Configurações › Gerenciar: nenhum botão de marcar
    await render(createElement(PainelImplantacao, { etapas: e, progresso: progresso(e) }), montarPermissoes({ clientes: ["criar"] }));
    expect($$("[data-acao$='-etapa']")).toHaveLength(0);
  });

  it("100%: a tela diz que está concluída", async () => {
    await render(createElement(PainelImplantacao, etapasDe(CHEIO)));
    expect($("[data-implantacao-progresso]")!.textContent).toMatch(/Implantação concluída.*100%.*o destaque no painel saiu/);
  });

  it("destaque do painel: etapas, próxima e o link da gaveta", async () => {
    await render(createElement(DestaqueImplantacao, { progresso: progresso(montarEtapas({ ...CHEIO, equipamentos: 0, veiculos: 0 }, () => true)) }));
    const a = $("[data-implantacao-destaque]")!;
    expect(a.dataset.implantacaoDestaque).toBe("71");
    expect(a.getAttribute("href")).toBe("/configuracoes?aba=conta&secao=implantacao");
    expect(a.textContent).toMatch(/Implantação: 5 de 7 etapas.*Próxima: Equipamentos.*71%/);
  });
});
