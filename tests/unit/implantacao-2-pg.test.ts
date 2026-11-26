/**
 * Implantação, leva 2 — importar equipamentos, com as rotas reais e o Prisma real num PostgreSQL real:
 *  - cliente pelo CNPJ/CPF (só da empresa), unidade pelo nome (vazia = a principal), unidade que não existe → erro;
 *  - tipo por rótulo, valor ou apelido ("split", "piso teto", tipo personalizado da empresa); vazio = Outro, com
 *    aviso; o tipo do sistema ganha o personalizado UMA vez, mesmo com várias linhas;
 *  - capacidade ("12000", "36.000 btu", "5 TR", "7,5 tr"), gás ("r-410a") e tensão ("220") normalizados;
 *  - chave id_sistema → nº de série → patrimônio/TAG (sem espaços nem maiúsculas); série repetida em 2 equipamentos
 *    → erro (não adivinha); série de equipamento de outro cliente → erro; a mesma série em OUTRA empresa não casa;
 *  - sem chave: entra com aviso e lista os possíveis duplicados (cadastrados e na própria planilha);
 *  - reimportar não duplica; baixar → editar → subir atualiza tudo pelo id_sistema;
 *  - permissão (Equipamentos › criar/editar), módulo Equipamentos desligado = 403, relatório de avisos.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/implantacao-2-pg
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { NextRequest } from "next/server";
import { montarPermissoes, permissoesTotais, type Permissoes } from "@/lib/permissoes";
import { gerarCsv, gerarXlsx, lerXlsx } from "@/lib/folha/planilha";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_implantacao2_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");

const sessao = vi.hoisted(() => ({ atual: null as any }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => sessao.atual) }));
vi.setConfig({ testTimeout: 60_000 });

const logar = (permissoes: Permissoes = permissoesTotais(), empresaId = "e1") => {
  sessao.atual = { user: { id: "u1", name: "Zé", email: "ze@x.com", empresaId, role: "OPERADOR", permissoes } };
};

const CNPJ_A = "11222333000181"; // Clínica (Principal + Anexo)
const CNPJ_B = "11444777000161"; // Mercado (Principal)
const fmt = (d: string) => d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

type Planilha = (string | number | null)[][];
const csv = (linhas: Planilha) => new File([gerarCsv(linhas.map((l) => l.map((c) => (c == null ? "" : String(c)))))], "dados.csv", { type: "text/csv" });
const xlsx = (linhas: string[][]) => new File([new Uint8Array(gerarXlsx([{ nome: "Dados", linhas }]))], "dados.xlsx");

async function importar(arquivo: File, etapa: "previa" | "confirmar", ligacoes?: unknown, entidade = "equipamentos") {
  const fd = new FormData();
  fd.append("arquivo", arquivo);
  fd.append("etapa", etapa);
  if (ligacoes !== undefined) fd.append("ligacoes", JSON.stringify(ligacoes));
  const mod = await import("@/app/api/importacao/[entidade]/route");
  const res: Response = await mod.POST(new NextRequest(`http://localhost/api/importacao/${entidade}`, { method: "POST", body: fd }), { params: Promise.resolve({ entidade }) });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const previa = (a: File, l?: unknown) => importar(a, "previa", l);
const confirmar = (a: File, l?: unknown) => importar(a, "confirmar", l);
async function baixar(tipo: "exportar" | "modelo") {
  const mod = await import(/* @vite-ignore */ `@/app/api/importacao/[entidade]/${tipo}/route`);
  const res: Response = await mod.GET(new NextRequest(`http://localhost/api/importacao/equipamentos/${tipo}`), { params: Promise.resolve({ entidade: "equipamentos" }) });
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) };
}
const linhaDa = (r: any, n: number) => r.json.analise.linhas.find((l: any) => l.linha === n);
const erroDa = (r: any, n: number) => (linhaDa(r, n)?.erros ?? []).join(" ");
const CAB = ["cnpj_cpf", "unidade", "tipo", "marca", "modelo", "capacidade", "fluido", "tensao", "ambiente", "numero_serie", "patrimonio", "id_sistema"];

describe.skipIf(!URL_PG)("Implantação, leva 2 — equipamentos (PostgreSQL real)", () => {
  let prisma: any;
  let esquecerModulos: (e?: string) => void;
  const eq = (id: string) => prisma.equipamento.findUnique({ where: { id } });

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    ({ esquecerModulos } = await import("@/lib/modulos/servidor"));
    await Promise.all(["", "/exportar", "/modelo", "/erros"].map((r) => import(/* @vite-ignore */ `@/app/api/importacao/[entidade]${r}/route`)));
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });
  beforeEach(async () => {
    await prisma.equipamento.deleteMany({});
    await prisma.tipoEquipamentoCustom.deleteMany({});
    await prisma.unidade.deleteMany({});
    await prisma.cliente.deleteMany({});
    await prisma.empresaModulo.deleteMany({});
    await prisma.empresa.deleteMany({});
    esquecerModulos();
    await prisma.empresa.createMany({ data: [{ id: "e1", nome: "Clima", cnpj: "12345678000190", email: "e@x.com" }, { id: "e2", nome: "Outra", cnpj: "98765432000110", email: "o@x.com" }] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Clínica Fictícia", cpfCnpj: fmt(CNPJ_A), tipoPessoa: "JURIDICA" },
      { id: "c2", empresaId: "e1", nome: "Mercado Fictício", cpfCnpj: fmt(CNPJ_B), tipoPessoa: "JURIDICA" },
      { id: "cB", empresaId: "e2", nome: "Cliente da Outra", cpfCnpj: fmt(CNPJ_A), tipoPessoa: "JURIDICA" },
    ] });
    await prisma.unidade.createMany({ data: [
      { id: "u1p", empresaId: "e1", clienteId: "c1", nome: "Principal", principal: true },
      { id: "u1a", empresaId: "e1", clienteId: "c1", nome: "Anexo Ágil", principal: false },
      { id: "u2p", empresaId: "e1", clienteId: "c2", nome: "Principal", principal: true },
      { id: "uB", empresaId: "e2", clienteId: "cB", nome: "Principal", principal: true },
    ] });
    await prisma.tipoEquipamentoCustom.createMany({ data: [
      { id: "t-split", empresaId: "e1", nome: "Split Hi-Wall (parede)", chaveEnum: "AR_CONDICIONADO_SPLIT" },
      { id: "t-cortina", empresaId: "e1", nome: "Cortina de ar" },
      { id: "t-velho", empresaId: "e1", nome: "Tipo antigo", ativo: false },
    ] });
    await prisma.equipamento.createMany({ data: [
      { id: "q-serie", empresaId: "e1", unidadeId: "u1p", tipo: "AR_CONDICIONADO_SPLIT", marca: "LG", modelo: "S4", numeroSerie: "LGX-0001", localizacao: "Recepção" },
      { id: "q-dup1", empresaId: "e1", unidadeId: "u1p", tipo: "OUTRO", marca: "X", modelo: "Y", numeroSerie: "DUP-9" },
      { id: "q-dup2", empresaId: "e1", unidadeId: "u1a", tipo: "OUTRO", marca: "X", modelo: "Y", numeroSerie: "dup 9" },
      { id: "q-pat", empresaId: "e1", unidadeId: "u1a", tipo: "CASSETE", marca: "Daikin", modelo: "FCQ36", patrimonio: "TAG-031" },
      { id: "q-c2", empresaId: "e1", unidadeId: "u2p", tipo: "OUTRO", marca: "Gree", modelo: "GWC", numeroSerie: "C2-123" },
      { id: "q-sem", empresaId: "e1", unidadeId: "u1p", tipo: "PISO_TETO", marca: "Midea", modelo: "MPT-60", capacidade: "5 TR", localizacao: "Auditório" },
      { id: "q-B", empresaId: "e2", unidadeId: "uB", tipo: "OUTRO", marca: "LG", modelo: "S4", numeroSerie: "LGX-0001" },
    ] });
    logar();
  });

  it("cria na unidade certa (vazia = principal), com tipo, capacidade, gás e tensão normalizados; erros claros", async () => {
    const r = await confirmar(csv([
      CAB,
      [fmt(CNPJ_A), "", "split", "LG", "S4-Q12", "12000", "r-410a", "220", "Consultório 1", "LGX-0002", "", ""], // 2
      [CNPJ_A, "anexo agil", "Cortina de ar", "Springer", "CA-1", "36.000 btu", "410a", "220/380", "Entrada", "", "TAG-100", ""], // 3
      [CNPJ_A, "", "piso teto", "Midea", "MPT-80", "7,5 tr", "R134A", "380v", "Salão", "MPT-A", "", ""], // 4
      [CNPJ_A, "", "Piso-Teto", "Midea", "MPT-90", "5 TR", "MO99", "127", "Salão 2", "MPT-B", "", ""], // 5
      [CNPJ_A, "", "", "Gree", "GWC09", "9.000 BTU/h", "R32", "", "Copa", "GR-1", "", ""], // 6: tipo vazio = Outro, com aviso
      [CNPJ_A, "Filial Norte", "split", "LG", "S4", "12000", "", "", "", "LGX-0003", "", ""], // 7: unidade que não existe
      [CNPJ_A, "", "split", "LG", "S4", "60", "", "", "", "LGX-0004", "", ""], // 8: capacidade sem unidade
      [CNPJ_A, "", "Tipo antigo", "LG", "S4", "", "", "", "", "LGX-0005", "", ""], // 9: tipo inativo
      [CNPJ_A, "", "split", "", "", "", "", "", "", "LGX-0006", "", ""], // 10: sem marca/modelo
      ["52998224725", "", "split", "LG", "S4", "", "", "", "", "LGX-0007", "", ""], // 11: cliente que não existe
    ]));
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ criados: 5, atualizados: 0, comErro: 5 });
    const erro = (n: number) => r.json.erros.find((e: any) => e.linha === n).erros.join(" ");
    expect(erro(7)).toMatch(/unidade: “Filial Norte” não existe neste cliente\. Importe a planilha de unidades antes/);
    expect(erro(8)).toMatch(/capacidade: “60” sem unidade — escreva BTU ou TR/);
    expect(erro(9)).toMatch(/tipo “Tipo antigo” não existe/);
    expect(erro(10)).toMatch(/marca: obrigatória\..*modelo: obrigatório\./);
    expect(erro(11)).toMatch(/nenhum cliente com o CPF/);

    const por = async (serie: string | null, pat?: string) => prisma.equipamento.findFirst({ where: { empresaId: "e1", ...(serie ? { numeroSerie: serie } : { patrimonio: pat }) } });
    expect(await por("LGX-0002")).toMatchObject({ unidadeId: "u1p", tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: "t-split", capacidade: "12.000 BTU/h", fluido: "R410A", tensao: "220V", localizacao: "Consultório 1", ativo: true });
    expect(await por(null, "TAG-100")).toMatchObject({ unidadeId: "u1a", tipoEquipamentoId: "t-cortina", tipo: "OUTRO", capacidade: "36.000 BTU/h", fluido: "R410A", tensao: "220/380" });
    expect(await por("MPT-A")).toMatchObject({ tipo: "PISO_TETO", capacidade: "7,5 TR", fluido: "R134a", tensao: "380V" });
    expect(await por("MPT-B")).toMatchObject({ tipo: "PISO_TETO", capacidade: "5 TR", fluido: "MO99", tensao: "127V" });
    expect(await por("GR-1")).toMatchObject({ tipo: "OUTRO", capacidade: "9.000 BTU/h" });
    // "piso teto" em 2 linhas: o tipo do sistema ganhou UM personalizado (não um por linha)
    const pisoTeto = await prisma.tipoEquipamentoCustom.findMany({ where: { empresaId: "e1", chaveEnum: "PISO_TETO" } });
    expect(pisoTeto).toHaveLength(1);
    expect((await por("MPT-A")).tipoEquipamentoId).toBe(pisoTeto[0].id);
    expect((await por("MPT-B")).tipoEquipamentoId).toBe(pisoTeto[0].id);
    // o aviso do tipo vazio veio no resultado
    expect(r.json.avisos.find((a: any) => a.linha === 6).avisos.join(" ")).toMatch(/tipo vazio: se o equipamento for novo, entra como “Outro”/);
    // a outra empresa: nada novo
    expect(await prisma.equipamento.count({ where: { empresaId: "e2" } })).toBe(1);
  });

  it("chave id_sistema → série → patrimônio/TAG (sem espaços nem maiúsculas); mudar de unidade no mesmo cliente pode", async () => {
    const r = await confirmar(csv([
      CAB,
      [CNPJ_A, "Anexo Ágil", "", "LG", "S4 novo", "", "", "", "Recepção nova", "lgx 0001", "", ""], // 2: série → q-serie (muda de unidade)
      [CNPJ_A, "anexo ágil", "", "Daikin", "FCQ36", "36000", "", "", "", "", "tag-031", ""], // 3: TAG → q-pat
      [CNPJ_A, "", "", "Midea", "MPT-60", "5 TR", "", "", "Auditório", "", "", "q-sem"], // 4: id_sistema → q-sem
    ]));
    expect(r.json).toMatchObject({ criados: 0, atualizados: 3, comErro: 0 });
    expect(await eq("q-serie")).toMatchObject({ unidadeId: "u1a", modelo: "S4 novo", localizacao: "Recepção nova", numeroSerie: "lgx 0001", tipo: "AR_CONDICIONADO_SPLIT" });
    expect(await eq("q-pat")).toMatchObject({ capacidade: "36.000 BTU/h", tipo: "CASSETE" });
    // a mesma série na OUTRA empresa ficou intacta
    expect(await eq("q-B")).toMatchObject({ modelo: "S4", numeroSerie: "LGX-0001", unidadeId: "uB" });
    expect(await prisma.equipamento.count({ where: { empresaId: "e1" } })).toBe(6);
  });

  it("série em 2 equipamentos → erro (não adivinha); série de outro cliente → erro; id de outra empresa → erro; id e série de equipamentos diferentes → erro", async () => {
    const r = await previa(csv([
      CAB,
      [CNPJ_A, "", "", "X", "Y", "", "", "", "", "DUP-9", "", ""], // 2
      [CNPJ_A, "", "", "Gree", "GWC", "", "", "", "", "C2-123", "", ""], // 3: série do Mercado
      [CNPJ_A, "", "", "LG", "S4", "", "", "", "", "", "", "q-B"], // 4: id da outra empresa
      [CNPJ_A, "", "", "LG", "S4", "", "", "", "", "LGX-0001", "", "q-sem"], // 5: id de um, série de outro
    ]));
    expect(erroDa(r, 2)).toMatch(/numero_serie: “DUP-9” já está em 2 equipamentos desta empresa — não dá para saber qual atualizar/);
    expect(erroDa(r, 3)).toMatch(/nº de série “C2-123” é de um equipamento de outro cliente/);
    expect(erroDa(r, 4)).toMatch(/id_sistema “q-B” não é de nenhum equipamento desta empresa/);
    expect(erroDa(r, 5)).toMatch(/aponta para equipamentos diferentes/);
    expect(r.json.analise.resumo).toMatchObject({ criar: 0, atualizar: 0, erros: 4 });
  });

  it("sem chave: entra com aviso e lista os possíveis duplicados (cadastrados e na própria planilha)", async () => {
    const planilha = csv([
      CAB,
      [CNPJ_A, "", "piso teto", "midea", "mpt-60", "5 tr", "", "", "Auditório", "", "", ""], // 2: igual ao q-sem
      [CNPJ_A, "", "split", "LG", "S4-Q9", "9000", "", "", "Sala 1", "", "", ""], // 3: sem chave, sem parecido cadastrado
      [CNPJ_A, "", "split", "LG", "S4-Q9", "9000", "", "", "Sala 2", "", "", ""], // 4: igual à linha 3
      [CNPJ_A, "", "split", "LG", "S4-Q9", "9000", "", "", "Sala 3", "SER-1", "", ""], // 5: com série, sem aviso
    ]);
    const p = await previa(planilha);
    expect(p.json.analise.resumo).toMatchObject({ criar: 4, erros: 0, avisos: 3 });
    expect(linhaDa(p, 2).avisos.join(" ")).toMatch(/Sem nº de série nem patrimônio\/TAG: reimportar esta linha cria outro equipamento\..*Possível duplicado — já cadastrado nesta unidade: Midea MPT-60 5 TR \(Auditório\), sem série/);
    expect(linhaDa(p, 3).avisos).toEqual(["Sem nº de série nem patrimônio/TAG: reimportar esta linha cria outro equipamento."]);
    expect(linhaDa(p, 4).avisos.join(" ")).toMatch(/Igual à linha 3 \(mesmo cliente, unidade, marca, modelo e capacidade\)/);
    expect(linhaDa(p, 5).avisos).toBeUndefined();

    const r = await confirmar(planilha);
    expect(r.json).toMatchObject({ criados: 4, comErro: 0 });
    expect(r.json.avisos.map((a: any) => a.linha)).toEqual([2, 3, 4]);

    // a planilha de avisos (para revisar): as colunas do modelo + linha + aviso
    const mod = await import("@/app/api/importacao/[entidade]/erros/route");
    const res: Response = await mod.POST(new NextRequest("http://localhost/api/importacao/equipamentos/erros", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: "avisos", erros: r.json.avisos.map((a: any) => ({ linha: a.linha, erros: a.avisos, valores: a.valores })) }),
    }), { params: Promise.resolve({ entidade: "equipamentos" }) });
    expect(res.headers.get("Content-Disposition")).toMatch(/avisos-importacao-equipamentos\.xlsx/);
    const [cab, l1] = lerXlsx(Buffer.from(await res.arrayBuffer()));
    expect(cab.slice(-2)).toEqual(["linha_original", "aviso"]);
    expect(String(l1[l1.length - 1])).toMatch(/Possível duplicado/);

    // reimportar: a linha COM série atualiza; as sem chave avisam que já existem iguais
    const p2 = await previa(planilha);
    expect(linhaDa(p2, 5).status).toBe("atualizar");
    expect(linhaDa(p2, 3).avisos.join(" ")).toMatch(/Possível duplicado — já cadastrado nesta unidade: LG S4-Q9 9.000 BTU\/h \(Sala 1\), sem série; LG S4-Q9 9.000 BTU\/h \(Sala 2\), sem série; LG S4-Q9 9.000 BTU\/h \(Sala 3\), série SER-1/);
  });

  it("baixar → editar → subir de novo: tudo atualiza pelo id_sistema (inclusive os sem série), nada duplica", async () => {
    const b = await baixar("exportar");
    expect(b.status).toBe(200);
    const tabela = lerXlsx(b.buf).map((l) => l.map((c) => (c == null ? "" : String(c))));
    expect(tabela[0]).toEqual(["cnpj_cpf", "unidade", "tipo", "marca", "modelo", "capacidade", "fluido", "tensao", "ambiente", "setor", "numero_serie", "patrimonio", "nome", "observacoes", "id_sistema"]);
    expect(tabela.length - 1).toBe(6); // só os da empresa da sessão
    const iId = tabela[0].indexOf("id_sistema"), iAmb = tabela[0].indexOf("ambiente"), iUn = tabela[0].indexOf("unidade"), iTipo = tabela[0].indexOf("tipo");
    const sem = tabela.find((l) => l[iId] === "q-sem")!;
    expect(sem[iUn]).toBe(""); // na principal: vazio (volta para a principal)
    expect(tabela.find((l) => l[iId] === "q-pat")![iUn]).toBe("Anexo Ágil");
    expect(tabela.find((l) => l[iId] === "q-serie")![iTipo]).toBe("Split Hi-Wall (parede)");
    sem[iAmb] = "Auditório principal";
    // série repetida (DUP-9 nos dois) também atualiza: o id_sistema decide
    const r = await confirmar(xlsx(tabela));
    expect(r.json).toMatchObject({ criados: 0, atualizados: 6, comErro: 0 });
    expect((await eq("q-sem")).localizacao).toBe("Auditório principal");
    expect(await prisma.equipamento.count({ where: { empresaId: "e1" } })).toBe(6);
  });

  it("permissão: criar = importar, editar = atualizar; sem ver, não baixa; módulo Equipamentos desligado = 403", async () => {
    logar(montarPermissoes({ equipamentos: ["visualizar"] }));
    expect((await previa(csv([CAB]))).status).toBe(403);
    expect((await baixar("modelo")).status).toBe(403);
    expect((await baixar("exportar")).status).toBe(200);

    logar(montarPermissoes({ equipamentos: ["visualizar", "criar"] }));
    const r = await previa(csv([CAB, [CNPJ_A, "", "", "LG", "S4", "", "", "", "", "LGX-0001", "", ""], [CNPJ_A, "", "", "LG", "S4", "", "", "", "", "NOVA-1", "", ""]]));
    expect(r.status).toBe(200);
    expect(erroDa(r, 2)).toMatch(/Já existe equipamento com este nº de série e você não tem permissão para editar/);
    expect(linhaDa(r, 3).status).toBe("criar");

    logar(montarPermissoes({ clientes: ["visualizar", "criar", "editar"] }));
    expect((await baixar("exportar")).status).toBe(403);

    logar();
    await prisma.empresaModulo.create({ data: { empresaId: "e1", modulo: "equipamentos", ativo: false } }); esquecerModulos();
    const d = await previa(csv([CAB]));
    expect(d.status).toBe(403);
    expect(d.json.modulo).toBe("equipamentos");
    expect((await baixar("exportar")).status).toBe(403);
    expect((await baixar("modelo")).status).toBe(403);
  });

  it("modelo: exemplo e instruções com os tipos DA EMPRESA (personalizados ativos + os do sistema); planilha de outro sistema com colunas ligadas", async () => {
    const m = await baixar("modelo");
    const linhas = lerXlsx(m.buf);
    expect(linhas[0]).toEqual(["cnpj_cpf", "unidade", "tipo", "marca", "modelo", "capacidade", "fluido", "tensao", "ambiente", "setor", "numero_serie", "patrimonio", "nome", "observacoes", "id_sistema"]);

    const outro = csv([
      ["CNPJ do cliente", "Local de atendimento", "Fabricante", "Modelo", "BTUs", "Gás", "Voltagem", "Ambiente", "Nº de série", "TAG"],
      [fmt(CNPJ_B), "", "Gree", "GWC12", "12000", "R32", "220", "Caixa", "GR-77", ""],
    ]);
    const sem = await previa(outro);
    expect(sem.status).toBe(400);
    expect(sem.json.ligar.faltando).toEqual(["cnpj_cpf"]);
    // reconhecidos sozinhos: marca (Fabricante), modelo, capacidade (BTUs), gás, tensão (voltagem), ambiente, série, TAG
    expect(sem.json.ligar.ligadas).toMatchObject({ marca: "Fabricante", modelo: "Modelo", capacidade: "BTUs", fluido: "Gás", tensao: "Voltagem", ambiente: "Ambiente", numero_serie: "Nº de série", patrimonio: "TAG" });
    const r = await confirmar(outro, { cnpj_cpf: "CNPJ do cliente", unidade: "Local de atendimento" });
    expect(r.json).toMatchObject({ criados: 1, comErro: 0 });
    expect(await prisma.equipamento.findFirst({ where: { numeroSerie: "GR-77" } })).toMatchObject({ unidadeId: "u2p", marca: "Gree", capacidade: "12.000 BTU/h", fluido: "R32", tensao: "220V", localizacao: "Caixa" });
  });

  it("a gravação confere a unidade de novo no cliente e na empresa", async () => {
    const { gravarImportacao } = await import("@/lib/importacao/servidor");
    const linha = (n: number, unidadeId: string) => ({ linha: n, status: "criar", rotulo: "X", erros: [], valores: {}, dados: { clienteId: "c1", unidadeId, marca: "Z", modelo: "Z", tipoRef: "e:OUTRO" } });
    const r = await gravarImportacao("equipamentos", { linhas: [linha(2, "u2p"), linha(3, "uB")], resumo: { total: 2, criar: 2, atualizar: 0, erros: 0, avisos: 0 }, colunasIgnoradas: [], colunas: { cabecalho: [], ligadas: {}, faltando: [] } } as any, "e1");
    expect(r.criados).toBe(0);
    expect(r.erros.map((e) => e.erros.join())).toEqual(["A unidade desta linha não foi encontrada no cliente (na sua empresa).", "A unidade desta linha não foi encontrada no cliente (na sua empresa)."]);
    expect(await prisma.equipamento.count({ where: { marca: "Z" } })).toBe(0);
  });
});
