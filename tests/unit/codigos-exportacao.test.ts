/**
 * Códigos de produto/serviço e planilha de ida e volta — regras puras:
 *  - código do serviço: 4 letras do nome (sem acento) + sequencial do prefixo, continuando do maior;
 *    digitado: normalizado (maiúsculas, sem espaço/acento), só letras e números; produto: inteiro;
 *  - seletores mostram "15 · Gás"; a busca acha pelo código (número exato / início do código);
 *  - motor: chave que precisa existir (id_sistema, código do produto), linha que aponta para dois
 *    cadastros diferentes = erro, mensagens dizem QUAL chave casou;
 *  - exportação = MESMAS colunas do modelo, valores no formato que a importação lê de volta: exportar e
 *    analisar a própria planilha dá só "atualizar" com os mesmos dados (round-trip), nunca "criar".
 */
import { describe, expect, it } from "vitest";
import {
  casaCodigo, codigoServico, normalizarCodigoProduto, normalizarCodigoServico, prefixoCodigoServico, proximoCodigoServico, rotuloComCodigo,
} from "@/lib/cadastros/codigos";
import { opcoesCadastro } from "@/lib/cadastros/opcoes";
import { CADASTROS, whereCadastro } from "@/lib/cadastros/registro";
import { analisar, descreverChave, linhasExportacao, linhasModelo, tipoChave, type ContextoImportacao } from "@/lib/importacao/motor";
import { IMPORTACOES, PERMISSOES_EXPORTACAO } from "@/lib/importacao/entidades";

const ctx = (existentes: Record<string, string> = {}, refs = {}, podeAtualizar = true): ContextoImportacao =>
  ({ existentes: new Map(Object.entries(existentes)), refs, podeAtualizar });
const ID_P = "cmprodutoaaaaaaaaaaaa1";
const ID_Q = "cmprodutobbbbbbbbbbbb2";

describe("código do serviço", () => {
  it("prefixo: 4 letras do nome, sem acento; poucas letras ficam; sem letras = SRV", () => {
    expect(prefixoCodigoServico("Limpeza de Filtro")).toBe("LIMP");
    expect(prefixoCodigoServico("Manutenção")).toBe("MANU");
    expect(prefixoCodigoServico("Ícaro")).toBe("ICAR");
    expect(prefixoCodigoServico("Ar")).toBe("AR");
    expect(prefixoCodigoServico("  1 a 2 b ")).toBe("AB");
    expect(prefixoCodigoServico("123 #")).toBe("SRV");
  });
  it("número com 2 dígitos (cresce sem cortar)", () => {
    expect(codigoServico("LIMP", 1)).toBe("LIMP01");
    expect(codigoServico("LIMP", 99)).toBe("LIMP99");
    expect(codigoServico("LIMP", 100)).toBe("LIMP100");
  });
  it("próximo: continua do MAIOR do mesmo prefixo; outros prefixos/formatos não contam", () => {
    expect(proximoCodigoServico("Limpeza", [])).toBe("LIMP01");
    expect(proximoCodigoServico("Limpeza", ["LIMP01", "LIMP07", "LIMP03", null, undefined])).toBe("LIMP08");
    expect(proximoCodigoServico("Limpeza", ["LIMPA9", "XLIMP05", "LIMP", "MANU09", "LIMP0001234567"])).toBe("LIMP01");
    expect(proximoCodigoServico("Ar", ["AR01", "ARX02"])).toBe("AR02");
  });
  it("digitado: maiúsculas, sem espaço e acento; vazio = gerar; só letras e números até 20", () => {
    expect(normalizarCodigoServico(" limp 07 ")).toEqual({ codigo: "LIMP07" });
    expect(normalizarCodigoServico("Ação1")).toEqual({ codigo: "ACAO1" });
    expect(normalizarCodigoServico("")).toEqual({ codigo: null });
    expect(normalizarCodigoServico("   ")).toEqual({ codigo: null });
    expect(normalizarCodigoServico(null)).toEqual({ codigo: null });
    expect(normalizarCodigoServico(undefined)).toEqual({ codigo: null });
    expect(normalizarCodigoServico("LIMP-01").erro).toBe("Código “LIMP-01”: use só letras e números (ex.: LIMP01).");
    expect(normalizarCodigoServico("A".repeat(20))).toEqual({ codigo: "A".repeat(20) });
    expect(normalizarCodigoServico("A".repeat(21)).erro).toBe("Código: no máximo 20 caracteres.");
  });
});

describe("código do produto, rótulo e busca", () => {
  it("produto: inteiro positivo; vazio = nenhum", () => {
    expect(normalizarCodigoProduto("15")).toEqual({ codigo: 15 });
    expect(normalizarCodigoProduto(15)).toEqual({ codigo: 15 });
    expect(normalizarCodigoProduto(" 7 ")).toEqual({ codigo: 7 });
    expect(normalizarCodigoProduto("")).toEqual({ codigo: null });
    expect(normalizarCodigoProduto(undefined)).toEqual({ codigo: null });
    for (const v of ["0", "-3", "1.5", "abc", "2000000001"]) expect(normalizarCodigoProduto(v).erro, v).toContain("número inteiro");
  });
  it("rótulo com código (sem código, só o nome)", () => {
    expect(rotuloComCodigo(15, "Gás")).toBe("15 · Gás");
    expect(rotuloComCodigo("LIMP01", "Limpeza")).toBe("LIMP01 · Limpeza");
    expect(rotuloComCodigo(null, "X")).toBe("X");
    expect(rotuloComCodigo("", "X")).toBe("X");
    expect(rotuloComCodigo(0, "X")).toBe("0 · X");
  });
  it("busca pelo código: produto = número exato; serviço = começo do código (sem maiúsculas)", () => {
    expect(casaCodigo(15, "15")).toBe(true);
    expect(casaCodigo(15, " 15 ")).toBe(true);
    expect(casaCodigo(15, "1")).toBe(false);
    expect(casaCodigo(15, "15a")).toBe(false);
    expect(casaCodigo("LIMP01", "limp")).toBe(true);
    expect(casaCodigo("LIMP01", "IMP")).toBe(false);
    expect(casaCodigo("LIMP01", "")).toBe(false);
    expect(casaCodigo(null, "1")).toBe(false);
  });
  it("seletor mostra o código antes do nome (e o inativo atual continua marcado)", () => {
    const ops = opcoesCadastro([{ id: "p1", nome: "Gás", codigo: 15, ativo: true }, { id: "p2", nome: "Velho", codigo: 2, ativo: false }, { id: "c", nome: "Sem código" }], ["p2"]);
    expect(ops.map((o) => o.rotulo)).toEqual(["15 · Gás", "2 · Velho (inativo)", "Sem código"]);
  });
  it("lista: digitar só o número acha o produto pelo código; serviço busca o código como texto", () => {
    expect(whereCadastro(CADASTROS.produtos, "e1", { ativo: "todos", q: "15" }).OR).toContainEqual({ codigo: 15 });
    expect(whereCadastro(CADASTROS.produtos, "e1", { ativo: "todos", q: "gás 15" }).OR).not.toContainEqual(expect.objectContaining({ codigo: expect.anything() }));
    expect(whereCadastro(CADASTROS.servicos, "e1", { ativo: "todos", q: "LIMP" }).OR).toContainEqual({ codigo: { contains: "LIMP", mode: "insensitive" } });
    expect(whereCadastro(CADASTROS.cargos, "e1", { ativo: "todos", q: "15" }).OR).not.toContainEqual({ codigo: 15 });
  });
  it("código na lista (1ª coluna, ordenável) e no formulário só do serviço", () => {
    expect(CADASTROS.produtos.colunas[0]).toMatchObject({ key: "codigo", formato: "codigo", ordenar: "codigo" });
    expect(CADASTROS.servicos.colunas[0]).toMatchObject({ key: "codigo", formato: "codigo", ordenar: "codigo" });
    expect(CADASTROS.servicos.campos.some((c) => c.key === "codigo")).toBe(true);
    expect(CADASTROS.produtos.campos.some((c) => c.key === "codigo")).toBe(false);
    // O produto não aceita código pelo corpo (o sistema gera)
    expect(CADASTROS.produtos.schemaCriar.safeParse({ nome: "X", codigo: 5 }).success).toBe(false);
  });
});

describe("motor: chave que precisa existir, conflito e mensagens", () => {
  const tab = (...linhas: (string | null)[][]) => [IMPORTACOES.produtos.colunas.map((c) => c.titulo), ...linhas];
  const linhaP = (o: { codigo?: string; nome?: string; id?: string }) => [o.codigo ?? "", o.nome ?? "", "", "", "", "", o.id ?? ""];

  it("id_sistema de outra empresa / inexistente = erro (não cria); código de produto inexistente = erro", () => {
    const a = analisar(tab(linhaP({ nome: "A", id: "cmdeoutraempresa00000000" }), linhaP({ nome: "B", codigo: "99" })), IMPORTACOES.produtos, ctx({ [`id:${ID_P}`]: ID_P, "cod:1": ID_P }));
    expect(a.linhas.map((l) => l.status)).toEqual(["erro", "erro"]);
    expect(a.linhas[0].erros[0]).toBe("id_sistema “cmdeoutraempresa00000000” não é de nenhum produto desta empresa. Não altere essa coluna; para cadastrar um novo, deixe-a vazia.");
    expect(a.linhas[1].erros[0]).toBe("codigo: não há produto com o código 99 nesta empresa. Para um produto novo, deixe o código vazio (o sistema gera).");
  });
  it("id_sistema de um e código de outro = erro (não adivinha qual atualizar)", () => {
    const a = analisar(tab(linhaP({ codigo: "2", nome: "A", id: ID_P })), IMPORTACOES.produtos, ctx({ [`id:${ID_P}`]: ID_P, "cod:1": ID_P, "cod:2": ID_Q }));
    expect(a.linhas[0].status).toBe("erro");
    expect(a.linhas[0].erros[0]).toBe(`Esta linha aponta para produtos diferentes: o id_sistema ${ID_P} e o código 2 são de cadastros distintos. Confira a planilha.`);
  });
  it("id_sistema + código do MESMO produto = atualizar esse; nome editado não importa", () => {
    const a = analisar(tab(linhaP({ codigo: "1", nome: "Nome NOVO", id: ID_P })), IMPORTACOES.produtos, ctx({ [`id:${ID_P}`]: ID_P, "cod:1": ID_P, "nome:nome novo": ID_Q }));
    expect(a.linhas[0]).toMatchObject({ status: "atualizar", existenteId: ID_P, chave: `id:${ID_P}` });
  });
  it("só o código: casa pelo código (o nome mudado NÃO cria outro); sem id e sem código: pelo nome", () => {
    const a = analisar(tab(linhaP({ codigo: "1", nome: "Renomeado" }), linhaP({ nome: "gás" }), linhaP({ nome: "Novo" })), IMPORTACOES.produtos, ctx({ "cod:1": ID_P, "nome:gas": ID_Q }));
    expect(a.linhas.map((l) => [l.status, l.existenteId, l.chave])).toEqual([["atualizar", ID_P, "cod:1"], ["atualizar", ID_Q, "nome:gas"], ["criar", undefined, undefined]]);
  });
  it("repetida na planilha e sem permissão de editar: a mensagem diz QUAL chave", () => {
    const a = analisar(tab(linhaP({ codigo: "1", nome: "A" }), linhaP({ codigo: "1", nome: "B" })), IMPORTACOES.produtos, ctx({ "cod:1": ID_P }));
    expect(a.linhas[1].erros).toEqual(["Repete a linha 2 (mesmo código)."]);
    const b = analisar(tab(linhaP({ codigo: "1", nome: "A" })), IMPORTACOES.produtos, ctx({ "cod:1": ID_P }, {}, false));
    expect(b.linhas[0].erros).toEqual(["Já existe produto com este código e você não tem permissão para editar — não dá para atualizar."]);
    expect(tipoChave("doc:1")).toBe("CNPJ/CPF");
    expect(tipoChave("nome:x")).toBe("nome");
    expect(tipoChave("zz:1")).toBe("identificador");
    expect(descreverChave("cod:LIMP01")).toBe("o código LIMP01");
  });
  it("serviço: código novo cria com ele; código existente atualiza; código inválido = erro; vazio pelo nome", () => {
    const cab = IMPORTACOES.servicos.colunas.map((c) => c.titulo);
    const l = (codigo: string, nome: string) => [codigo, nome, "", "", "", "", "", "", ""];
    const a = analisar([cab, l("limp 09", "Limpeza nova"), l("MANU01", "Manutenção renomeada"), l("MAN-1", "X"), l("", "Recarga")], IMPORTACOES.servicos, ctx({ "cod:MANU01": "s1", "nome:recarga": "s2" }));
    expect(a.linhas.map((x) => x.status)).toEqual(["criar", "atualizar", "erro", "atualizar"]);
    expect(a.linhas[0].dados).toMatchObject({ codigo: "LIMP09", nome: "Limpeza nova" });
    expect(a.linhas[1]).toMatchObject({ existenteId: "s1", dados: { codigo: "MANU01", nome: "Manutenção renomeada" } });
    expect(a.linhas[2].erros[0]).toContain("codigo: Código “MAN-1”: use só letras e números");
    expect(a.linhas[3].chave).toBe("nome:recarga");
  });
  it("cliente com id_sistema que não é desta empresa = erro (mesmo com CNPJ novo, não cria)", () => {
    const cab = IMPORTACOES.clientes.colunas.map((c) => c.titulo);
    const linha = cab.map((t) => ({ nome: "Hospital", cnpj_cpf: "11.222.333/0001-81", id_sistema: "cmdeoutraempresa00000000" } as Record<string, string>)[t] ?? "");
    const a = analisar([cab, linha], IMPORTACOES.clientes, ctx());
    expect(a.linhas[0].status).toBe("erro");
    expect(a.linhas[0].erros[0]).toBe("id_sistema “cmdeoutraempresa00000000” não é de nenhum cliente desta empresa. Não altere essa coluna; para cadastrar um novo, deixe-a vazia.");
  });
  it("fornecedores sem CNPJ com o MESMO nome: cada um pelo seu id_sistema (não é linha repetida)", () => {
    const cab = IMPORTACOES.fornecedores.colunas.map((c) => c.titulo);
    const l = (nome: string, id: string) => [nome, "", "", "", "", id];
    const a = analisar([cab, l("Posto", "f1"), l("Posto", "f2")], IMPORTACOES.fornecedores, ctx({ "id:f1": "f1", "id:f2": "f2", "nome:posto": "f1" }));
    expect(a.linhas.map((x) => [x.status, x.existenteId, x.erros])).toEqual([["atualizar", "f1", []], ["atualizar", "f2", []]]);
  });
  it("id_sistema mexido (texto qualquer) = erro claro; a coluna 'id' de outro sistema é ignorada", () => {
    const a = analisar(tab(linhaP({ nome: "A", id: "abc def" }), linhaP({ nome: "B", id: "abc" })), IMPORTACOES.produtos, ctx());
    expect(a.linhas[0].erros[0]).toBe("id_sistema: “abc def” não é um identificador do sistema. Não altere essa coluna (linha nova: deixe vazia).");
    expect(a.linhas[1].erros[0]).toBe("id_sistema “abc” não é de nenhum produto desta empresa. Não altere essa coluna; para cadastrar um novo, deixe-a vazia.");
    const b = analisar([["nome", "id"], ["A", ID_P]], IMPORTACOES.produtos, ctx());
    expect(b.colunasIgnoradas).toEqual(["id"]);
    expect(b.linhas[0].status).toBe("criar");
  });
});

describe("exportação = mesmas colunas, lidas de volta (round-trip)", () => {
  const refs = { tabela_preco: [{ valor: "tp1", rotulo: "Tabela VIP" }] };
  const REG = {
    produtos: [
      { id: ID_P, codigo: 1, nome: "Gás R410A", descricao: "Cilindro; 11 kg", unidade: "kg", valorPadrao: "1250.5", estoqueMinimo: 2, ativo: true },
      { id: ID_Q, codigo: 2, nome: "Filtro", descricao: null, unidade: "un", valorPadrao: null, estoqueMinimo: null, ativo: false },
    ],
    servicos: [{ id: "cmservicoaaaaaaaaaa1", codigo: "LIMP01", nome: "Limpeza", descricao: "", unidade: "hora", valorPadrao: 80, codigoMunicipal: "1401", codigoLc116: "14.01", aliquotaISS: 2.5, ativo: true }],
    fornecedores: [
      { id: "cmfornaaaaaaaaaaaaa1", nome: "Frigelar", documento: "11444777000161", telefone: "1133334444", email: "v@f.com", observacoes: null },
      { id: "cmfornbbbbbbbbbbbbb2", nome: "Posto sem CNPJ", documento: null, telefone: null, email: null, observacoes: "x" },
    ],
    clientes: [{
      id: "cmclienteaaaaaaaaaa1", nome: "Hospital", cpfCnpj: "11.222.333/0001-81", nomeFantasia: "HSC", tipoPessoa: "JURIDICA", inscricaoEstadual: null,
      email: "a@b.com", telefone: null, celular: "31999990000", contato: "Ana", cep: "30140-000", endereco: "Av. X", numero: "10", complemento: null,
      bairro: "Centro", cidade: "BH", estado: "MG", segmento: "SAUDE", origem: "INDICACAO", tabelaPrecoId: "tp1", observacoes: null,
    }],
  } as const;
  const chaves: Record<string, (r: any) => string[]> = {
    produtos: (r) => [`id:${r.id}`, `cod:${r.codigo}`],
    servicos: (r) => [`id:${r.id}`, `cod:${r.codigo}`],
    fornecedores: (r) => [`id:${r.id}`, ...(r.documento ? [`doc:${r.documento}`] : [])],
    clientes: (r) => [`id:${r.id}`, `doc:${r.cpfCnpj.replace(/\D/g, "")}`],
  };

  for (const ent of ["produtos", "servicos", "fornecedores", "clientes"] as const) {
    it(`${ent}: cabeçalho = modelo; reimportar a própria planilha só ATUALIZA, cada linha o seu registro`, () => {
      const def = IMPORTACOES[ent];
      const regs = REG[ent] as unknown as Record<string, unknown>[];
      const linhas = linhasExportacao(def, regs, refs);
      expect(linhas[0]).toEqual(linhasModelo(def, refs).cabecalho);
      expect(linhas).toHaveLength(regs.length + 1);
      const existentes = Object.fromEntries(regs.flatMap((r) => chaves[ent](r).map((k) => [k, String(r.id)])));
      const a = analisar(linhas, def, ctx(existentes, refs));
      expect(a.linhas.map((l) => [l.status, l.existenteId, l.erros])).toEqual(regs.map((r) => ["atualizar", r.id, []]));
    });
  }

  it("valores no formato da importação (e voltam iguais)", () => {
    const [cab, gas, filtro] = linhasExportacao(IMPORTACOES.produtos, REG.produtos as any);
    const v = Object.fromEntries(cab.map((c, i) => [c, gas[i]]));
    expect(v).toEqual({ codigo: "1", nome: "Gás R410A", descricao: "Cilindro; 11 kg", unidade: "Quilograma (kg)", valor_padrao: "1250,50", estoque_minimo: "2", id_sistema: ID_P });
    expect(filtro).toEqual(["2", "Filtro", "", "Unidade (un)", "", "", ID_Q]);
    const a = analisar([cab, gas], IMPORTACOES.produtos, ctx({ [`id:${ID_P}`]: ID_P, "cod:1": ID_P }));
    expect(a.linhas[0].dados).toMatchObject({ nome: "Gás R410A", descricao: "Cilindro; 11 kg", unidade: "kg", valorPadrao: 1250.5, estoqueMinimo: 2 });
    const [, s] = linhasExportacao(IMPORTACOES.servicos, REG.servicos as any);
    expect(s).toEqual(["LIMP01", "Limpeza", "", "Hora (h)", "80,00", "1401", "14.01", "2,5", "cmservicoaaaaaaaaaa1"]);
    const [cc, c] = linhasExportacao(IMPORTACOES.clientes, REG.clientes as any, refs);
    const vc = Object.fromEntries(cc.map((k, i) => [k, c[i]]));
    expect(vc).toMatchObject({ tipo_pessoa: "Jurídica", segmento: "Saúde", origem: "Indicação", tabela_preco: "Tabela VIP", id_sistema: "cmclienteaaaaaaaaaa1", cnpj_cpf: "11.222.333/0001-81" });
    const [, f1, f2] = linhasExportacao(IMPORTACOES.fornecedores, REG.fornecedores as any);
    expect(f1).toEqual(["Frigelar", "11.444.777/0001-61", "1133334444", "v@f.com", "", "cmfornaaaaaaaaaaaaa1"]);
    expect(f2[1]).toBe("");
  });

  it("cada valor vai na coluna do seu título (a ordem é a das colunas, não a do exportar; faltou = vazio)", () => {
    const def = { ...IMPORTACOES.produtos, exportar: () => ({ id_sistema: "X1", nome: "Gás", codigo: "7" }) };
    const [cab, l] = linhasExportacao(def, [{}]);
    expect(cab).toEqual(["codigo", "nome", "descricao", "unidade", "valor_padrao", "estoque_minimo", "id_sistema"]);
    expect(l).toEqual(["7", "Gás", "", "", "", "", "X1"]);
  });

  it("instruções: a planilha exportada explica o id_sistema; o modelo, a linha de exemplo; nada é apagado", () => {
    const exp = linhasModelo(IMPORTACOES.produtos, {}, { exportada: true }).instrucoes.flat().join(" ");
    expect(exp).toContain("Esta planilha veio do sistema");
    expect(exp).not.toContain("linha de exemplo");
    const mod = linhasModelo(IMPORTACOES.produtos).instrucoes.flat().join(" ");
    expect(mod).toContain("A linha de exemplo (linha 2)");
    for (const t of [exp, mod]) expect(t).toContain("Linha apagada da planilha NÃO apaga nada");
  });

  it("permissão de baixar: ver o módulo da lista", () => {
    expect(PERMISSOES_EXPORTACAO).toEqual({
      clientes: [["clientes", "visualizar"]], fornecedores: [["financeiro", "visualizar"], ["configuracoes", "visualizar"]],
      servicos: [["configuracoes", "visualizar"]], produtos: [["configuracoes", "visualizar"]],
    });
  });
});
