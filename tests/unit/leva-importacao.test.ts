/**
 * Importação em massa por planilha — motor único para clientes, fornecedores, serviços e produtos.
 * Rotas reais (prévia, confirmar, modelo, planilha de erros), banco em memória com DUAS empresas.
 * Prova:
 *  - cria; atualiza duplicados (CNPJ/CPF em formatos diferentes; nome sem acento/maiúsculas);
 *    célula vazia não apaga o que já existe;
 *  - linhas com erro (campo obrigatório, CNPJ inválido, número inválido, unidade/segmento/tabela
 *    inexistente — com as opções válidas listadas) falham SEM derrubar as outras;
 *  - empresa sempre da sessão: coluna empresa_id é ignorada e o cadastro da outra empresa nem é
 *    casado nem alterado;
 *  - permissão: sem criar → 403; criar sem editar → duplicado vira erro (nada é alterado);
 *  - prévia não grava nada; confirmar grava; nunca apaga; teto de 5.000 linhas;
 *  - modelo (.xlsx/.csv) com cabeçalho + exemplo e opções; planilha de erros com o motivo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { permissoesTotais, permissoesVazias, type Permissoes } from "@/lib/permissoes";
import { gerarCsv, gerarXlsx, lerCsv, lerXlsx } from "@/lib/folha/planilha";
import { analisar, chaveNome, mapearCabecalho, MAX_LINHAS_IMPORTACAO, numero, opcao, type ContextoImportacao } from "@/lib/importacao/motor";
import { IMPORTACOES } from "@/lib/importacao/entidades";
import { cnpjValido, cpfValido, formatarDocumento, tipoDocumento } from "@/lib/documento";
import type { Banco } from "./helpers/banco-memoria";

const db = vi.hoisted(() => ({ t: {}, escritas: [], seq: 0 }) as unknown as Banco);
vi.mock("@/lib/prisma", async () => {
  const { criarPrisma } = await import("./helpers/banco-memoria");
  return { prisma: criarPrisma(db) };
});
const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
// Lista de clientes: o status financeiro (groupBy) não interessa aqui
vi.mock("@/lib/status-financeiro", async (orig) => ({ ...(await orig<object>()), calcularStatusFinanceiroEmLote: async () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
  usePathname: () => "/x", useSearchParams: () => new URLSearchParams(),
}));

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Zé", email: "ze@x.com", empresaId, role: "OPERADOR", permissoes } };
};

// CNPJs/CPFs válidos (dígitos verificadores certos)
const CNPJ_A = "11222333000181";
const CNPJ_B = "11444777000161";
const CPF_A = "52998224725";

function semear() {
  db.escritas = [];
  db.seq = 0;
  db.t = {
    cliente: [
      { id: "c-hosp", empresaId: "e1", nome: "Hospital Antigo", cpfCnpj: "11.222.333/0001-81", tipoPessoa: "JURIDICA", email: "velho@hosp.com", telefone: "3133334444", cidade: "BH", ativo: true },
      { id: "c-B", empresaId: "e2", nome: "Cliente da Outra", cpfCnpj: "11.444.777/0001-61", tipoPessoa: "JURIDICA", email: "b@b.com", ativo: true },
    ],
    tabelaPreco: [
      { id: "tp-vip", empresaId: "e1", nome: "Tabela VIP", ativo: true },
      { id: "tp-velha", empresaId: "e1", nome: "Tabela 2019", ativo: false },
      { id: "tp-B", empresaId: "e2", nome: "Tabela da Outra", ativo: true },
    ],
    fornecedor: [
      { id: "f-frig", empresaId: "e1", nome: "Frigelar", documento: CNPJ_B, telefone: "1100000000", email: null, observacoes: "antigo", ativo: true },
      { id: "f-posto", empresaId: "e1", nome: "Posto Ipiranga", documento: null, telefone: null, email: null, observacoes: null, ativo: true },
      { id: "f-B", empresaId: "e2", nome: "Leroy", documento: CNPJ_A, ativo: true },
    ],
    servico: [
      { id: "s-prev", empresaId: "e1", nome: "Manutenção Preventiva", descricao: "Limpeza", unidade: "un", valorPadrao: 200, codigoLc116: "14.01", ativo: true },
      { id: "s-B", empresaId: "e2", nome: "Instalação", unidade: "un", valorPadrao: 999, ativo: true },
    ],
    produto: [
      { id: "p-gas", empresaId: "e1", nome: "Gás R410A", descricao: "Cilindro", unidade: "kg", valorPadrao: 800, estoqueMinimo: 2, ativo: true },
      { id: "p-B", empresaId: "e2", nome: "Filtro", unidade: "un", valorPadrao: 10, ativo: true },
    ],
  };
}
beforeEach(() => { semear(); foto = JSON.stringify(db.t); logar(); });

/* ───────── Chamadas às rotas ───────── */
const rota = () => import("@/app/api/importacao/[entidade]/route");
const rotaModelo = () => import("@/app/api/importacao/[entidade]/modelo/route");
const rotaErros = () => import("@/app/api/importacao/[entidade]/erros/route");

type Planilha = (string | number | null)[][];
const xlsx = (linhas: Planilha) => new File([new Uint8Array(gerarXlsx([{ nome: "Dados", linhas: linhas.map((l) => l.map((c) => (c == null ? "" : String(c)))) }]))], "dados.xlsx");
const csv = (linhas: Planilha) => new File([gerarCsv(linhas.map((l) => l.map((c) => (c == null ? "" : String(c)))))], "dados.csv", { type: "text/csv" });

async function importar(entidade: string, arquivo: File, etapa: "previa" | "confirmar") {
  const fd = new FormData();
  fd.append("arquivo", arquivo);
  fd.append("etapa", etapa);
  const req = new NextRequest(`http://localhost/api/importacao/${entidade}`, { method: "POST", body: fd });
  const res: Response = await (await rota()).POST(req, { params: Promise.resolve({ entidade }) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const previa = (e: string, a: File) => importar(e, a, "previa");
const confirmar = (e: string, a: File) => importar(e, a, "confirmar");

const linha = (m: string, id: string) => db.t[m].find((r) => r.id === id)!;
const daEmpresa = (m: string, empresaId: string) => db.t[m].filter((r) => r.empresaId === empresaId);
const porNome = (m: string, nome: string) => db.t[m].find((r) => r.nome === nome);
let foto = "";
/** Algo mudou no banco desde o semear()? (compara o estado inteiro) */
const escreveu = () => db.escritas.length > 0 || JSON.stringify(db.t) !== foto;
const apagou = () => db.escritas.some((e) => /\.delete/.test(e));
const statusDa = (r: any, n: number) => r.json.analise.linhas.find((l: any) => l.linha === n);

// ═════════════════════════ Criar e atualizar ═════════════════════════
describe("clientes (dedup por CNPJ/CPF)", () => {
  const CAB = ["nome", "cnpj_cpf", "email", "cidade", "segmento", "tabela_preco"];

  it("prévia não grava; confirmar cria o novo e ATUALIZA o existente (CNPJ sem pontuação casa com o formatado)", async () => {
    const arq = xlsx([CAB,
      ["Hospital Santa Clara", CNPJ_A, "novo@hosp.com", "", "Saúde", "tabela vip"],
      ["João da Silva", "529.982.247-25", "joao@x.com", "Contagem", "residencial", ""],
    ]);
    const p = await previa("clientes", arq);
    expect(p.status).toBe(200);
    expect(p.json.analise.resumo).toEqual({ total: 2, criar: 1, atualizar: 1, erros: 0 });
    expect(statusDa(p, 2).status).toBe("atualizar");
    expect(statusDa(p, 3).status).toBe("criar");
    expect(p.json.analise.linhas[0]).not.toHaveProperty("dados");
    expect(p.json.analise.linhas[0]).not.toHaveProperty("existenteId");
    expect(p.json.analise.linhas[0]).not.toHaveProperty("chave");
    expect(escreveu()).toBe(false);

    const c = await confirmar("clientes", arq);
    expect(c.status).toBe(200);
    expect(c.json).toMatchObject({ ok: true, criados: 1, atualizados: 1, comErro: 0 });
    // Atualizado: o que veio preenchido mudou; o vazio (cidade) ficou como estava
    expect(linha("cliente", "c-hosp")).toMatchObject({ nome: "Hospital Santa Clara", email: "novo@hosp.com", cidade: "BH", telefone: "3133334444", segmento: "SAUDE", tabelaPrecoId: "tp-vip", cpfCnpj: "11.222.333/0001-81", empresaId: "e1" });
    // Criado: documento formatado, tipo pela quantidade de dígitos, empresa da sessão, ativo
    expect(porNome("cliente", "João da Silva")).toMatchObject({ empresaId: "e1", ativo: true, cpfCnpj: "529.982.247-25", tipoPessoa: "FISICA", segmento: "RESIDENCIAL", cidade: "Contagem" });
    expect(daEmpresa("cliente", "e1")).toHaveLength(2);
    expect(apagou()).toBe(false);
  });

  it("CSV com ; e cabeçalho por apelido (CPF/CNPJ, Razão Social) também funciona", async () => {
    const arq = new File([`Razão Social;CPF/CNPJ;UF\nPadaria Pão Quente;${formatarDocumento(CNPJ_B)};mg\n`], "x.csv");
    const p = await previa("clientes", arq);
    expect(p.status).toBe(200);
    // CNPJ_B existe só na OUTRA empresa: aqui vira "criar", nunca "atualizar" o cadastro dela
    expect(p.json.analise.resumo).toMatchObject({ criar: 1, atualizar: 0, erros: 0 });
    const c = await confirmar("clientes", arq);
    expect(c.json.criados).toBe(1);
    expect(porNome("cliente", "Padaria Pão Quente")).toMatchObject({ empresaId: "e1", estado: "MG" });
    expect(linha("cliente", "c-B")).toMatchObject({ nome: "Cliente da Outra", email: "b@b.com" });
  });

  it("linhas com erro não derrubam as outras e o motivo é claro (obrigatório, CNPJ inválido, segmento e tabela inexistentes)", async () => {
    const arq = xlsx([CAB,
      ["", CNPJ_A, "", "", "", ""],
      ["Sem documento", "", "", "", "", ""],
      ["CNPJ errado", "11.222.333/0001-82", "", "", "", ""],
      ["Segmento ruim", CPF_A, "", "", "Aeroespacial", ""],
      ["Tabela velha", "12345678909", "", "", "", "Tabela 2019"],
      ["Tabela da outra", "11144477735", "", "", "", "Tabela da Outra"],
      ["Email ruim", "01438784000105", "nao-e-email", "", "", ""],
      ["Bom", "39053344705", "", "", "", ""],
    ]);
    const p = await previa("clientes", arq);
    expect(p.json.analise.resumo).toEqual({ total: 8, criar: 1, atualizar: 0, erros: 7 });
    expect(statusDa(p, 2).erros).toContain("nome: obrigatório.");
    expect(statusDa(p, 3).erros).toContain("cnpj_cpf: obrigatório.");
    expect(statusDa(p, 4).erros[0]).toMatch(/cnpj_cpf: “11\.222\.333\/0001-82” não é um CNPJ/);
    expect(statusDa(p, 5).erros[0]).toMatch(/segmento “Aeroespacial” não existe\. Opções válidas: .*Saúde.*Residencial/);
    // Tabela inativa e tabela de outra empresa: não existem para esta importação; lista só as válidas
    expect(statusDa(p, 6).erros[0]).toBe("tabela_preco “Tabela 2019” não existe. Opções válidas: Tabela VIP.");
    expect(statusDa(p, 7).erros[0]).toBe("tabela_preco “Tabela da Outra” não existe. Opções válidas: Tabela VIP.");
    expect(statusDa(p, 8).erros[0]).toMatch(/email: “nao-e-email” não é um e-mail válido/);
    const c = await confirmar("clientes", arq);
    expect(c.json).toMatchObject({ criados: 1, atualizados: 0, comErro: 7 });
    expect(c.json.erros.map((e: any) => e.linha)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(porNome("cliente", "Bom")).toBeTruthy();
    expect(daEmpresa("cliente", "e1")).toHaveLength(2);
    // Nada de "lixo": nenhuma tabela/segmento criado
    expect(db.t.tabelaPreco).toHaveLength(3);
  });

  it("documento repetido na própria planilha: a 2ª vira erro (com formatação diferente)", async () => {
    const p = await previa("clientes", xlsx([CAB, ["A", CPF_A, "", "", "", ""], ["B", "529.982.247-25", "", "", "", ""]]));
    expect(p.json.analise.resumo).toMatchObject({ criar: 1, erros: 1 });
    expect(statusDa(p, 3).erros).toEqual(["Repete a linha 2 (mesmo CNPJ/CPF)."]);
  });

  it("tipo_pessoa que não combina com o documento é erro", async () => {
    const p = await previa("clientes", xlsx([["nome", "cnpj_cpf", "tipo_pessoa"], ["X", CPF_A, "Jurídica"], ["Y", CNPJ_A, "PJ"]]));
    expect(statusDa(p, 2).erros[0]).toMatch(/tipo_pessoa: “Jurídica” não combina com o documento \(CPF = pessoa física\)/);
    expect(statusDa(p, 3).status).toBe("atualizar");
  });
});

describe("fornecedores (dedup por CNPJ/CPF; sem documento, pelo nome)", () => {
  it("atualiza pelo documento e, sem documento, pelo nome (sem acento/maiúsculas); cria o resto", async () => {
    const arq = csv([["nome", "cnpj_cpf", "telefone", "email", "observacoes"],
      ["Frigelar Distribuidora SA", "11.444.777/0001-61", "", "VENDAS@FRIG.COM", ""],
      ["  posto   IPIRANGA ", "", "1199999999", "", ""],
      ["Leroy Merlin", CNPJ_A, "", "", "Material"],
    ]);
    const p = await previa("fornecedores", arq);
    expect(p.json.analise.resumo).toEqual({ total: 3, criar: 1, atualizar: 2, erros: 0 });
    const c = await confirmar("fornecedores", arq);
    expect(c.json).toMatchObject({ criados: 1, atualizados: 2, comErro: 0 });
    expect(linha("fornecedor", "f-frig")).toMatchObject({ nome: "Frigelar Distribuidora SA", documento: CNPJ_B, email: "vendas@frig.com", telefone: "1100000000", observacoes: "antigo" });
    expect(linha("fornecedor", "f-posto")).toMatchObject({ nome: "Posto Ipiranga", telefone: "1199999999" });
    // CNPJ_A existe só na outra empresa: cria na e1 e não mexe na e2
    expect(porNome("fornecedor", "Leroy Merlin")).toMatchObject({ empresaId: "e1", documento: CNPJ_A, ativo: true });
    expect(linha("fornecedor", "f-B")).toMatchObject({ nome: "Leroy", empresaId: "e2" });
    expect(apagou()).toBe(false);
  });

  it("CPF inválido é erro e não derruba a linha boa", async () => {
    const p = await previa("fornecedores", csv([["nome", "cnpj_cpf"], ["Zé Gás", "111.111.111-11"], ["Bom", ""]]));
    expect(statusDa(p, 2).erros[0]).toMatch(/não é um CNPJ \(14 dígitos\) nem um CPF \(11 dígitos\) válido/);
    expect(statusDa(p, 3).status).toBe("criar");
  });
});

describe("serviços e produtos (dedup pelo nome; números validados)", () => {
  it("serviço: atualiza pelo nome (sem acento/maiúsculas), cria o novo com os padrões do cadastro", async () => {
    const arq = xlsx([["nome", "descricao", "unidade", "valor_padrao", "aliquota_iss"],
      ["manutencao preventiva", "", "", "R$ 1.250,50", "5"],
      ["Carga de gás", "Completar fluido", "", "350", ""],
    ]);
    const c = await confirmar("servicos", arq);
    expect(c.json).toMatchObject({ criados: 1, atualizados: 1, comErro: 0 });
    // Casou pelo nome: a grafia da planilha não renomeia; descrição vazia NÃO apagou; unidade vazia não mudou
    expect(linha("servico", "s-prev")).toMatchObject({ nome: "Manutenção Preventiva", descricao: "Limpeza", unidade: "un", valorPadrao: 1250.5, aliquotaISS: 5, codigoLc116: "14.01" });
    expect(porNome("servico", "Carga de gás")).toMatchObject({ empresaId: "e1", ativo: true, unidade: "un", valorPadrao: 350 });
    expect(linha("servico", "s-B").valorPadrao).toBe(999);
  });

  it("produto: número inválido, estoque não inteiro e unidade inexistente são erro (com as opções); as outras linhas entram", async () => {
    const arq = xlsx([["nome", "unidade", "valor_padrao", "estoque_minimo"],
      ["Filtro secador", "caixa", "10", "1"],
      ["Tubo de cobre", "metro", "dez reais", ""],
      ["Fita", "un", "5", "2,5"],
      ["GÁS r410a", "quilo", "1.234,56", "3"],
      ["Capacitor", "", "", ""],
    ]);
    const p = await previa("produtos", arq);
    expect(p.json.analise.resumo).toEqual({ total: 5, criar: 1, atualizar: 1, erros: 3 });
    expect(statusDa(p, 2).erros[0]).toBe("unidade “caixa” não existe. Opções válidas: Unidade (un), Quilograma (kg), Metro linear (m), Metro quadrado (m²).");
    expect(statusDa(p, 3).erros).toEqual(["valor_padrao: “dez reais” não é um número."]);
    expect(statusDa(p, 4).erros).toEqual(["estoque_minimo: use um número inteiro (veio 2.5)."]);
    const c = await confirmar("produtos", arq);
    expect(c.json).toMatchObject({ criados: 1, atualizados: 1, comErro: 3 });
    expect(linha("produto", "p-gas")).toMatchObject({ nome: "Gás R410A", unidade: "kg", valorPadrao: 1234.56, estoqueMinimo: 3, descricao: "Cilindro" });
    expect(porNome("produto", "Capacitor")).toMatchObject({ empresaId: "e1", unidade: "un", ativo: true });
    // "Filtro" existe na outra empresa e não foi tocado; nada de unidade nova
    expect(linha("produto", "p-B")).toMatchObject({ valorPadrao: 10 });
    expect(porNome("produto", "Filtro secador")).toBeUndefined();
  });

  it("valor negativo é recusado pelo MESMO schema do cadastro", async () => {
    const p = await previa("produtos", xlsx([["nome", "valor_padrao"], ["X", "-5"]]));
    expect(statusDa(p, 2).status).toBe("erro");
  });
});

// ═════════════════════════ Empresa da sessão ═════════════════════════
describe("empresa sempre da sessão", () => {
  it("coluna empresa_id/id/ativo é ignorada; grava na empresa da sessão", async () => {
    const arq = xlsx([["nome", "empresa_id", "id", "ativo"], ["Novo X", "e2", "p-B", "false"], ["Filtro", "e2", "", ""]]);
    const p = await previa("produtos", arq);
    expect(p.json.analise.colunasIgnoradas).toEqual(["empresa_id", "id", "ativo"]);
    const c = await confirmar("produtos", arq);
    expect(c.json).toMatchObject({ criados: 2, atualizados: 0 });
    expect(porNome("produto", "Novo X")).toMatchObject({ empresaId: "e1", ativo: true });
    // "Filtro" da e2 não foi casado nem alterado
    expect(db.t.produto.filter((r) => r.nome === "Filtro").map((r) => r.empresaId).sort()).toEqual(["e1", "e2"]);
    expect(linha("produto", "p-B")).toMatchObject({ empresaId: "e2", nome: "Filtro", valorPadrao: 10, ativo: true });
  });

  it("logado na empresa 2, o mesmo arquivo atualiza só o cadastro da empresa 2", async () => {
    logar(permissoesTotais(), "e2");
    const c = await confirmar("servicos", xlsx([["nome", "valor_padrao"], ["instalação", "1000"]]));
    expect(c.json).toMatchObject({ criados: 0, atualizados: 1 });
    expect(linha("servico", "s-B").valorPadrao).toBe(1000);
    expect(linha("servico", "s-prev").valorPadrao).toBe(200);
  });

  it("gravação confere a empresa de novo: se o registro mudou de empresa entre a análise e a gravação, vira erro", async () => {
    const { gravarImportacao } = await import("@/lib/importacao/servidor");
    const analise = analisar([["nome"], ["Gás R410A"]], IMPORTACOES.produtos, { existentes: new Map([["nome:gas r410a", "p-B"]]), refs: {}, podeAtualizar: true });
    const r = await gravarImportacao("produtos", analise, "e1");
    expect(r).toMatchObject({ criados: 0, atualizados: 0 });
    expect(r.erros[0].erros[0]).toMatch(/não foi encontrado na sua empresa/);
    expect(linha("produto", "p-B").nome).toBe("Filtro");
  });
});

// ═════════════════════════ Permissão ═════════════════════════
describe("permissão por cadastro", () => {
  const SO_VER: Permissoes = { ...permissoesVazias(), clientes: { visualizar: true }, configuracoes: { visualizar: true }, financeiro: { visualizar: true } };
  const CRIA_CLIENTE: Permissoes = { ...permissoesVazias(), clientes: { visualizar: true, criar: true } };
  const LANCA_CONTAS: Permissoes = { ...permissoesVazias(), financeiro: { visualizar: true, fluxoCaixa: true } };

  it("sem permissão de criar → 403 em todas as rotas (importar, modelo, erros); sem sessão → 401", async () => {
    logar(SO_VER);
    for (const e of ["clientes", "fornecedores", "servicos", "produtos"]) {
      expect((await previa(e, xlsx([["nome"], ["X"]]))).status).toBe(403);
      expect((await confirmar(e, xlsx([["nome"], ["X"]]))).status).toBe(403);
      const m = await (await rotaModelo()).GET(new NextRequest(`http://localhost/api/importacao/${e}/modelo`), { params: Promise.resolve({ entidade: e }) });
      expect(m.status).toBe(403);
      const er = await (await rotaErros()).POST(new NextRequest(`http://localhost/x`, { method: "POST", body: JSON.stringify({ erros: [] }) }), { params: Promise.resolve({ entidade: e }) });
      expect(er.status).toBe(403);
    }
    expect(escreveu()).toBe(false);
    sessao.atual = null;
    expect((await previa("produtos", xlsx([["nome"], ["X"]]))).status).toBe(401);
  });

  it("cadastro fora da lista → 404", async () => {
    expect((await previa("usuarios", xlsx([["nome"], ["X"]]))).status).toBe(404);
  });

  it("criar sem editar: duplicado vira erro explicando, nada é alterado; o novo entra", async () => {
    logar(CRIA_CLIENTE);
    const arq = xlsx([["nome", "cnpj_cpf"], ["Hospital Renomeado", CNPJ_A], ["Novo", CPF_A]]);
    const p = await previa("clientes", arq);
    expect(p.json.podeAtualizar).toBe(false);
    expect(statusDa(p, 2).erros[0]).toBe("Já existe cliente com este CNPJ/CPF e você não tem permissão para editar — não dá para atualizar.");
    const c = await confirmar("clientes", arq);
    expect(c.json).toMatchObject({ criados: 1, atualizados: 0, comErro: 1 });
    expect(linha("cliente", "c-hosp").nome).toBe("Hospital Antigo");
  });

  it("fornecedor segue a permissão do cadastro (lançar contas a pagar pode importar); serviço exige configurações", async () => {
    logar(LANCA_CONTAS);
    expect((await confirmar("fornecedores", csv([["nome"], ["Novo Forn"]]))).json.criados).toBe(1);
    expect((await previa("servicos", csv([["nome"], ["X"]]))).status).toBe(403);
  });
});

// ═════════════════════════ Limites e formatos ═════════════════════════
describe("limites, cabeçalho e arquivo", () => {
  it("mais de 5.000 linhas → 400 e nada gravado", async () => {
    const linhas: Planilha = [["nome"], ...Array.from({ length: MAX_LINHAS_IMPORTACAO + 1 }, (_, i) => [`P${i}`])];
    const r = await confirmar("produtos", csv(linhas));
    expect(r.status).toBe(400);
    expect(r.json.erro).toMatch(/limite é 5000/);
    expect(escreveu()).toBe(false);
  });

  it("5.000 linhas exatas: grava todas em lotes", async () => {
    const linhas: Planilha = [["nome", "valor_padrao"], ...Array.from({ length: MAX_LINHAS_IMPORTACAO }, (_, i) => [`Item ${i}`, String(i)])];
    const r = await confirmar("produtos", csv(linhas));
    expect(r.json).toMatchObject({ criados: 5000, atualizados: 0, comErro: 0 });
  }, 30000);

  it("falta coluna obrigatória / planilha vazia / sem arquivo / nada válido → 400 com motivo", async () => {
    expect((await previa("clientes", xlsx([["nome", "email"], ["A", "a@a.com"]]))).json.erro).toMatch(/Faltam colunas obrigatórias: cnpj_cpf/);
    expect((await previa("produtos", csv([["nome"]]))).json.erro).toMatch(/nenhuma linha preenchida/);
    expect((await previa("produtos", new File([""], "v.csv"))).status).toBe(400);
    const fd = new FormData(); fd.append("etapa", "previa");
    const res = await (await rota()).POST(new NextRequest("http://localhost/x", { method: "POST", body: fd }), { params: Promise.resolve({ entidade: "produtos" }) });
    expect(res.status).toBe(400);
    const nada = await confirmar("produtos", csv([["nome", "valor_padrao"], ["X", "abc"]]));
    expect(nada.status).toBe(400);
    expect(nada.json.erro).toMatch(/Nenhuma linha válida/);
    expect(escreveu()).toBe(false);
  });

  it("arquivo acima de 5 MB → 400", async () => {
    const r = await previa("produtos", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "g.csv"));
    expect(r.status).toBe(400);
    expect(r.json.erro).toMatch(/5 MB/);
  });

  it("arquivo de 3 MB (acima do limite da folha, dentro dos 5 MB) é aceito", async () => {
    const enchimento = "x".repeat(700);
    const linhas: Planilha = [["nome", "coluna_extra"], ...Array.from({ length: 4500 }, (_, i) => [`Item ${i}`, enchimento])];
    const arq = csv(linhas);
    expect(arq.size).toBeGreaterThan(3 * 1024 * 1024);
    const r = await previa("produtos", arq);
    expect(r.status).toBe(200);
    expect(r.json.analise.resumo.criar).toBe(4500);
  }, 30000);

  it("a planilha de erros pode voltar como está (colunas linha_original/motivo_do_erro são aceitas e ignoradas)", async () => {
    const p = await previa("produtos", csv([["nome", "valor_padrao", "linha_original", "motivo_do_erro"], ["Corrigido", "10", "3", "valor_padrao: ..."]]));
    expect(p.json.analise.colunasIgnoradas).toEqual([]);
    expect(p.json.analise.resumo.criar).toBe(1);
  });
});

// ═════════════════════════ Modelo e planilha de erros ═════════════════════════
describe("modelo e planilha de erros", () => {
  const baixarModelo = async (e: string, formato: string) =>
    (await rotaModelo()).GET(new NextRequest(`http://localhost/api/importacao/${e}/modelo?formato=${formato}`), { params: Promise.resolve({ entidade: e }) });

  it("modelo .xlsx: cabeçalho + 1 exemplo + aba de instruções com obrigatórias e opções (tabelas ATIVAS da empresa)", async () => {
    const r = await baixarModelo("clientes", "xlsx");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Disposition")).toContain("modelo-clientes.xlsx");
    const buf = Buffer.from(await r.arrayBuffer());
    const t = lerXlsx(buf);
    expect(t[0]).toEqual(IMPORTACOES.clientes.colunas.map((c) => c.titulo));
    expect(t).toHaveLength(2);
    expect(t[1][0]).toBe("Hospital Santa Clara Ltda");
    // O exemplo do modelo passa na própria validação
    const ctx: ContextoImportacao = { existentes: new Map(), refs: {}, podeAtualizar: true };
    expect(analisar(t, IMPORTACOES.clientes, ctx).resumo).toMatchObject({ criar: 1, erros: 0 });
    // Instruções: 2ª aba (o leitor só lê a 1ª; conferimos que ela existe no pacote)
    expect(buf.toString("latin1")).toContain("xl/worksheets/sheet2.xml");
  });

  it("modelo de cada cadastro: o exemplo é válido; CSV também", async () => {
    for (const e of ["fornecedores", "servicos", "produtos"] as const) {
      const r = await baixarModelo(e, "csv");
      expect(r.status).toBe(200);
      const t = lerCsv(await r.text());
      expect(t[0]).toEqual(IMPORTACOES[e].colunas.map((c) => c.titulo));
      expect(analisar(t, IMPORTACOES[e], { existentes: new Map(), refs: {}, podeAtualizar: true }).resumo).toMatchObject({ total: 1, erros: 0 });
    }
  });

  it("instruções listam as opções de tabela da empresa da sessão (não as da outra nem as inativas)", async () => {
    const { linhasModelo } = await import("@/lib/importacao/motor");
    const { carregarContexto } = await import("@/lib/importacao/servidor");
    const ctx = await carregarContexto("clientes", "e1", true);
    const tab = linhasModelo(IMPORTACOES.clientes, ctx.refs).instrucoes.find((l) => l[0] === "tabela_preco")!;
    expect(tab[3]).toBe("Tabela VIP");
    expect(linhasModelo(IMPORTACOES.produtos).instrucoes.find((l) => l[0] === "unidade")![3]).toContain("Quilograma (kg)");
    expect(linhasModelo(IMPORTACOES.clientes).instrucoes.find((l) => l[0] === "nome")![1]).toBe("sim");
  });

  it("planilha de erros: linhas que falharam + linha original + motivo", async () => {
    const c = await confirmar("produtos", xlsx([["nome", "valor_padrao"], ["Ok", "1"], ["Ruim", "abc"]]));
    const r = await (await rotaErros()).POST(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ erros: c.json.erros }) }), { params: Promise.resolve({ entidade: "produtos" }) });
    expect(r.status).toBe(200);
    const t = lerXlsx(Buffer.from(await r.arrayBuffer()));
    expect(t[0]).toEqual([...IMPORTACOES.produtos.colunas.map((x) => x.titulo), "linha_original", "motivo_do_erro"]);
    // Colunas do modelo: codigo, nome, descricao, unidade, valor_padrao, estoque_minimo, id_sistema
    expect(t[1].map((c) => c ?? "")).toEqual(["", "Ruim", "", "", "abc", "", "", "3", "valor_padrao: “abc” não é um número."]);
    expect(t).toHaveLength(2);
  });
});

// ═════════════════════════ Motor (puro) ═════════════════════════
describe("motor", () => {
  it("numero: BR e EN; vazio = undefined; texto = NaN", () => {
    expect(numero("1.234,56")).toBe(1234.56);
    expect(numero("1,234.56")).toBe(1234.56);
    expect(numero("12,5")).toBe(12.5);
    expect(numero("12.5")).toBe(12.5);
    expect(numero("R$ 350")).toBe(350);
    expect(numero("1.234")).toBe(1234);
    expect(numero(7)).toBe(7);
    expect(numero("")).toBeUndefined();
    expect(numero(null)).toBeUndefined();
    expect(numero("abc")).toBeNaN();
    expect(numero("1,2,3")).toBeNaN();
  });

  it("opcao: valor, rótulo ou apelido, sem acento/maiúsculas; senão erro com a lista", () => {
    const o = [{ valor: "m2", rotulo: "Metro quadrado (m²)", aceitos: ["metro quadrado"] }];
    expect(opcao("M2", o, "unidade")).toEqual({ valor: "m2" });
    expect(opcao("metro QUADRADO", o, "unidade")).toEqual({ valor: "m2" });
    expect(opcao("", o, "unidade")).toEqual({});
    expect(opcao("lata", o, "unidade").erro).toBe("unidade “lata” não existe. Opções válidas: Metro quadrado (m²).");
    expect(opcao("x", [], "tabela").erro).toContain("(nenhuma cadastrada)");
  });

  it("cabeçalho: título, chave ou apelido; coluna repetida e desconhecida vão para ignoradas", () => {
    const { mapa, ignoradas } = mapearCabecalho(["Razão Social", "CPF", "Nome", "Cor favorita"], IMPORTACOES.clientes.colunas);
    expect(mapa.get("nome")).toBe(0);
    expect(mapa.get("cnpj_cpf")).toBe(1);
    expect(ignoradas).toEqual(["Nome", "Cor favorita"]);
  });

  it("cabeçalho pode não estar na 1ª linha (linhas vazias antes) e a numeração segue a planilha", () => {
    const a = analisar([[], ["nome"], ["A"], [], ["B"]], IMPORTACOES.produtos, { existentes: new Map(), refs: {}, podeAtualizar: true });
    expect(a.linhas.map((l) => l.linha)).toEqual([3, 5]);
  });

  it("erro inesperado na validação de uma linha não derruba as outras", () => {
    const def = { ...IMPORTACOES.produtos, validar: (v: any) => { if (v.nome === "boom") throw new Error("x"); return IMPORTACOES.produtos.validar(v, { existentes: new Map(), refs: {}, podeAtualizar: true }); } };
    const a = analisar([["nome"], ["boom"], ["ok"]], def, { existentes: new Map(), refs: {}, podeAtualizar: true });
    expect(a.linhas.map((l) => l.status)).toEqual(["erro", "criar"]);
    expect(a.linhas[0].erros).toEqual(["Não foi possível ler esta linha."]);
  });

  it("chaveNome: sem acento, minúsculas, espaços simples", () => {
    expect(chaveNome("  Manutenção   PREVENTIVA ")).toBe("manutencao preventiva");
  });

  it("documento: dígitos verificadores de CPF e CNPJ", () => {
    expect(cpfValido(CPF_A)).toBe(true);
    expect(cpfValido("52998224726")).toBe(false);
    expect(cpfValido("11111111111")).toBe(false);
    expect(cnpjValido(CNPJ_A)).toBe(true);
    expect(cnpjValido("11222333000182")).toBe(false);
    expect(cnpjValido("00000000000000")).toBe(false);
    expect(tipoDocumento("529.982.247-25")).toBe("cpf");
    expect(tipoDocumento("11.222.333/0001-81")).toBe("cnpj");
    expect(tipoDocumento("123")).toBeNull();
    expect(formatarDocumento(CNPJ_A)).toBe("11.222.333/0001-81");
    expect(formatarDocumento(CPF_A)).toBe("529.982.247-25");
  });
});

// ═════════════════════════ Telas: botão na própria lista, conforme a permissão ═════════════════════════
describe("botão “Importar planilha” nas listas", () => {
  const tela = async (entidade: string, permissoes: Permissoes) => {
    const { CadastroPadrao } = await import("@/components/cadastros/cadastro-padrao");
    const { PermissoesProvider } = await import("@/components/providers/permissoes-provider");
    return renderToStaticMarkup(createElement(PermissoesProvider, { role: "OPERADOR", permissoes, children: createElement(CadastroPadrao, { entidade: entidade as any }) }));
  };
  const GESTOR: Permissoes = { ...permissoesVazias(), configuracoes: { visualizar: true, gerenciar: true } };
  const SO_VER_CONFIG: Permissoes = { ...permissoesVazias(), configuracoes: { visualizar: true }, financeiro: { visualizar: true } };

  it("fornecedores, serviços e produtos: aparece com permissão de criar; some sem ela", async () => {
    for (const e of ["fornecedores", "servicos", "produtos"]) {
      expect(await tela(e, GESTOR)).toContain('data-acao="importar-planilha"');
      expect(await tela(e, SO_VER_CONFIG)).not.toContain('data-acao="importar-planilha"');
    }
  });

  it("cadastros fora da importação não ganham o botão", async () => {
    const html = await tela("cargos", permissoesTotais());
    expect(html).toContain("Novo cargo"); // pode criar cargo…
    expect(html).not.toContain('data-acao="importar-planilha"'); // …mas cargo não tem importação
  });

  it("clientes: botão no cabeçalho da lista só para quem pode criar", async () => {
    const { default: Pagina } = await import("@/app/(dashboard)/clientes/page");
    db.t.cliente = []; // só o cabeçalho interessa
    const render = async () => renderToStaticMarkup(await Pagina({ searchParams: Promise.resolve({}) }));
    logar({ ...permissoesVazias(), clientes: { visualizar: true, criar: true } });
    expect(await render()).toContain('data-acao="importar-planilha"');
    logar({ ...permissoesVazias(), clientes: { visualizar: true, editar: true } });
    expect(await render()).not.toContain('data-acao="importar-planilha"');
  });
});
