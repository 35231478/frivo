/**
 * Lentidão da tela de OS (Leva F) — o carregamento novo dá EXATAMENTE o mesmo resultado do antigo, no PostgreSQL real:
 *  - a lista de OS (lib/os/lista-server › carregarListaOs, em duas ondas de consultas planas) é comparada linha a linha
 *    com a consulta antiga da página (os `include` aninhados), em várias ordenações, filtros e páginas — inclusive a
 *    página além da última e a lista vazia;
 *  - o cadastro conferido em toda página e API (lib/sessao-ativa › lerUsuario, agora em paralelo) tem o mesmo formato
 *    da consulta aninhada antiga: com e sem perfil, a empresa do token diferente da do cadastro, e o usuário removido;
 *  - menos idas ao banco EM FILA: as consultas da lista contadas por onda (o antes e o depois em ms estão no PR).
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/os-lista-desempenho-pg
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { instanteBR } from "@/lib/fuso";

const URL_PG = process.env.PG_TESTE_URL;
const SCHEMA = `teste_lista_os_${process.pid}`;
const RAIZ = path.resolve(__dirname, "../..");
vi.setConfig({ testTimeout: 60_000 });
const AGORA = instanteBR(2026, 10, 27, 12);

describe.skipIf(!URL_PG)("lista de OS e sessão: o mesmo resultado, menos idas ao banco (PostgreSQL real)", () => {
  let prisma: any;
  let lista: typeof import("@/lib/os/lista-server");

  /** A consulta ANTIGA da página /ordens (origin/master antes da Leva F), para comparar */
  async function listaAntiga(empresaId: string, sp: Record<string, string | undefined>) {
    const { periodoOrdens } = await import("@/lib/listas/filtros");
    const { whereOrdensDaLista } = await import("@/lib/listas/filtros-server");
    const { periodoTela } = await import("@/lib/periodo");
    const { janela, lerPaginacao, paginaValida } = await import("@/lib/listagem");
    const { comparaNatural } = await import("@/lib/utils");
    const pe = await import("@/lib/os/prazo-execucao");
    const { textoPrazo } = await import("@/lib/os/prazos");
    const { resumoStatus } = await import("@/lib/os/status");
    const sort = sp.sort && lista.SORT_ORDENS[sp.sort] ? sp.sort : "criadoEm";
    const dir: "asc" | "desc" = sp.dir === "asc" ? "asc" : "desc";
    const where = await whereOrdensDaLista(empresaId, sp, AGORA);
    const periodo = periodoTela(periodoOrdens(sp, AGORA));
    const { pagina: pedida, porPagina } = lerPaginacao(sp);
    const total = await prisma.ordemServico.count({ where });
    const pagina = paginaValida(pedida, porPagina, total);
    const ordens = await prisma.ordemServico.findMany({
      where,
      include: {
        cliente: { select: { id: true, nome: true, nomeFantasia: true, logo: true } },
        unidade: { select: { nome: true } },
        responsavel: { select: { nome: true } },
        atividades: { select: {
          status: true, dataAgendada: true,
          tecnico: { select: { id: true, nome: true, avatar: true } },
          tecnicosEquipe: { select: { tecnico: { select: { id: true, nome: true, avatar: true } } } },
        } },
        medicaoItens: { select: { medicao: { select: { status: true } } } },
      },
      orderBy: [lista.SORT_ORDENS[sort](dir), { id: "asc" }],
      ...janela(pagina, porPagina),
    });
    const linhas = ordens.map((o: any) => {
      const tecnicos = Array.from(new Map(o.atividades.flatMap((a: any) => [a.tecnico, ...a.tecnicosEquipe.map((t: any) => t.tecnico)]).filter(Boolean).map((t: any) => [t.id, t])).values() as Iterable<any>)
        .sort((a: any, b: any) => comparaNatural(a.nome, b.nome));
      const situacao = pe.situacaoPrazoExecucao(o, AGORA);
      return {
        id: o.id, numero: o.numero, chamadoNumero: o.chamadoNumero, origem: o.origem,
        cliente: o.cliente.nomeFantasia ?? o.cliente.nome, clienteLogo: o.cliente.logo ?? null,
        unidade: o.unidade?.nome ?? null, responsavel: o.responsavel?.nome ?? null, atividades: o.atividades.length,
        tecnicos: tecnicos.map((t: any) => ({ id: t.id, nome: t.nome, avatar: t.avatar ?? null })),
        status: o.status,
        estagio: resumoStatus({ status: o.status, statusManual: o.statusManual, previsaoConclusao: o.previsaoConclusao, atividades: o.atividades, medicoes: o.medicaoItens.map((m: any) => m.medicao) }).exibido,
        prioridade: o.prioridade, criadoEm: o.criadoEm.toISOString(), previsaoConclusao: o.previsaoConclusao ? o.previsaoConclusao.toISOString() : null,
        prazo: pe.prazoEfetivo(o)?.toISOString() ?? null, prazoProprio: pe.temPrazoProprio(o), prazoSituacao: situacao.situacao,
        prazoTexto: textoPrazo(situacao, true), atrasoJustificado: pe.atrasoJustificado(o) ? pe.rotuloMotivoAtraso(o.atrasoJustificadoMotivo) || "Justificado" : null,
      };
    });
    return { total, pagina, porPagina, periodo, linhas };
  }

  beforeAll(async () => {
    const url = `${URL_PG}${URL_PG!.includes("?") ? "&" : "?"}schema=${SCHEMA}&connection_limit=10`;
    execFileSync(path.join(RAIZ, "node_modules/.bin/prisma"), ["db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"], { cwd: RAIZ, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    process.env.DATABASE_URL = url;
    (globalThis as any).prisma = undefined;
    ({ prisma } = await import("@/lib/prisma"));
    lista = await import("@/lib/os/lista-server");

    await prisma.empresa.createMany({ data: [
      { id: "e1", nome: "Clima Total", cnpj: "12.345.678/0001-90", email: "e@x.com" },
      { id: "e2", nome: "Outra", cnpj: "98.765.432/0001-10", email: "o@x.com", ativo: false },
    ] });
    await prisma.configuracao.createMany({ data: [{ empresaId: "e1", appUmDispositivo: true }, { empresaId: "e2" }] });
    await prisma.perfilAcesso.create({ data: { id: "pf1", empresaId: "e1", nome: "Atendimento", permissoes: { ordens: { visualizar: true } } } });
    await prisma.usuario.createMany({ data: [
      { id: "uA", empresaId: "e1", nome: "Ana Souza", email: "ana@x.com", senha: "x", role: "ADMIN" },
      { id: "uB", empresaId: "e1", nome: "Bruno Dias", email: "bruno@x.com", senha: "y", perfilAcessoId: "pf1", sessaoAtiva: "s1" },
      { id: "uC", empresaId: "e2", nome: "Carla", email: "carla@x.com", senha: "z", ativo: false },
    ] });
    await prisma.tecnico.createMany({ data: [
      { id: "t1", empresaId: "e1", nome: "Zeca Lima", cpf: "1", telefone: "1", email: "z@x.com", avatar: "data:image/png;base64,AAA" },
      { id: "t2", empresaId: "e1", nome: "álvaro Reis", cpf: "2", telefone: "2", email: "a@x.com" },
      { id: "t3", empresaId: "e1", nome: "Beatriz Melo", cpf: "3", telefone: "3", email: "b@x.com" },
    ] });
    await prisma.cliente.createMany({ data: [
      { id: "c1", empresaId: "e1", nome: "Mercado Bom Preço LTDA", nomeFantasia: "Bom Preço", cpfCnpj: "1", logo: "data:image/png;base64,LOGO" },
      { id: "c2", empresaId: "e1", nome: "Hospital Santa Luzia", cpfCnpj: "2" },
      { id: "c3", empresaId: "e2", nome: "Padaria", cpfCnpj: "3" },
    ] });
    await prisma.unidade.createMany({ data: [{ id: "un1", empresaId: "e1", clienteId: "c1", nome: "Matriz" }, { id: "un2", empresaId: "e1", clienteId: "c2", nome: "Bloco B" }] });
    const status = ["ABERTA", "AGENDADA", "EM_ANDAMENTO", "CONCLUIDA", "CANCELADA", "PAUSADA", "AGUARDANDO_PECA"];
    const prioridade = ["BAIXA", "NORMAL", "ALTA", "URGENTE"];
    await prisma.ordemServico.createMany({ data: Array.from({ length: 17 }, (_, i) => ({
      id: `os${String(i).padStart(2, "0")}`, empresaId: "e1", numero: `OS-2026-${String(300 + i).padStart(4, "0")}`, chamadoNumero: i % 5 === 0 ? `CH-${i}` : null,
      clienteId: i % 3 ? "c1" : "c2", unidadeId: i % 4 ? (i % 3 ? "un1" : "un2") : null, criadoPorId: "uA", responsavelId: i % 2 ? "uB" : null,
      descricao: "Manutenção", status: status[i % status.length], prioridade: prioridade[i % prioridade.length], origem: i % 6 === 0 ? "PORTAL_CLIENTE" : "MANUAL",
      criadoEm: instanteBR(2026, 10, 1 + i, 9), previsaoConclusao: i % 2 ? new Date(Date.UTC(2026, 10, 5 + i)) : null,
      prazoExecucao: i % 5 === 1 ? new Date(Date.UTC(2026, 10, 10)) : null, statusManual: i === 7,
      atrasoJustificadoEm: i === 6 ? AGORA : null, atrasoJustificadoMotivo: i === 6 ? "CLIENTE" : null,
    })) });
    await prisma.ordemServico.create({ data: { id: "osOutra", empresaId: "e2", numero: "OS-9", clienteId: "c3", criadoPorId: "uC", descricao: "x" } });
    const atividades: any[] = [];
    for (let i = 0; i < 17; i++) {
      if (i % 4 === 3) continue; // algumas OS sem atividade
      atividades.push({ id: `a${i}a`, empresaId: "e1", ordemServicoId: `os${String(i).padStart(2, "0")}`, titulo: "Visita", status: i % 2 ? "CONCLUIDA" : "AGENDADA", tecnicoId: i % 3 ? "t1" : null, dataAgendada: instanteBR(2026, 10, 2 + i, 8) });
      if (i % 2 === 0) atividades.push({ id: `a${i}b`, empresaId: "e1", ordemServicoId: `os${String(i).padStart(2, "0")}`, titulo: "Retorno", status: "EM_ANDAMENTO", tecnicoId: "t3" });
    }
    await prisma.atividadeOs.createMany({ data: atividades });
    await prisma.atividadeTecnico.createMany({ data: [
      { atividadeId: "a0a", tecnicoId: "t2" }, { atividadeId: "a0a", tecnicoId: "t3" }, { atividadeId: "a4b", tecnicoId: "t1" }, { atividadeId: "a9a", tecnicoId: "t2" },
    ] });
    await prisma.medicao.createMany({ data: [
      { id: "m1", empresaId: "e1", clienteId: "c1", numero: "MED-1", tokenPublico: "tk-m1", status: "APROVADA" },
      { id: "m2", empresaId: "e1", clienteId: "c1", numero: "MED-2", tokenPublico: "tk-m2" },
    ] }).catch(async () => prisma.medicao.createMany({ data: [
      { id: "m1", empresaId: "e1", clienteId: "c1", numero: "MED-1", tokenPublico: "tk-m1" },
      { id: "m2", empresaId: "e1", clienteId: "c1", numero: "MED-2", tokenPublico: "tk-m2" },
    ] }));
    const item = (id: string, medicaoId: string, os: string) => ({ id, medicaoId, ordemServicoId: os, descricao: "Serviço", valorUnitario: 10, valorTotal: 10 });
    await prisma.medicaoItem.createMany({ data: [item("mi1", "m1", "os01"), item("mi2", "m2", "os01"), item("mi3", "m1", "os05"), item("mi4", "m1", "os05")] });
  }, 180_000);
  afterAll(async () => {
    await prisma?.$disconnect();
    execFileSync("psql", [URL_PG!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`], { stdio: "pipe" });
  });

  const CASOS: Record<string, string | undefined>[] = [
    { periodo: "todos" },
    {}, // o padrão: o mês atual
    { periodo: "todos", sort: "cliente", dir: "asc" },
    { periodo: "todos", sort: "numero", dir: "asc", por: "25" },
    { periodo: "todos", sort: "status", por: "10", pagina: "2" },
    { periodo: "todos", sort: "prioridade", dir: "asc", por: "10", pagina: "9" }, // além da última: volta à última
    { periodo: "todos", sort: "previsaoConclusao" },
    { periodo: "todos", status: "CONCLUIDA" },
    { periodo: "todos", tecnico: "sem" },
    { periodo: "todos", clienteId: "c2", responsavelId: "uB" },
    { periodo: "todos", prazo: "atrasadas" },
    { periodo: "todos", numero: "nada-disso" }, // vazia
    { mes: "2026-10" },
  ];

  it("a lista de OS: o mesmo resultado do carregamento antigo, linha a linha, em cada filtro, ordem e página", async () => {
    for (const sp of CASOS) {
      const novo = await lista.carregarListaOs("e1", sp, AGORA);
      const antigo = await listaAntiga("e1", sp);
      // O pedido do cliente (PC-1) chegou depois: esta empresa não exige pedido, então nada disso aparece
      const { opcoes, resumoPedido, ...semOpcoes } = novo;
      expect(resumoPedido).toBeNull();
      expect(semOpcoes.linhas.every((l) => l.pedidoCliente === null), JSON.stringify(sp)).toBe(true);
      const semPedido = { ...semOpcoes, linhas: semOpcoes.linhas.map(({ pedidoCliente, ...l }) => l) };
      expect(semPedido, JSON.stringify(sp)).toEqual(antigo);
    }
    // o cenário cobre o que importa: equipe com técnico repetido, técnicos em ordem pt-BR, faturada, sem atividade, outra empresa fora
    const todas = await lista.carregarListaOs("e1", { periodo: "todos", sort: "numero", dir: "asc", por: "25" }, AGORA);
    expect(todas.total).toBe(15); // 17 menos as 2 canceladas
    expect(todas.linhas.find((l) => l.id === "os00")!.tecnicos.map((t) => t.nome)).toEqual(["álvaro Reis", "Beatriz Melo"]);
    expect(todas.linhas.find((l) => l.id === "os01")!.estagio).toBe("FATURADA");
    expect(todas.linhas.find((l) => l.id === "os03")!.atividades).toBe(0);
    expect(todas.linhas.some((l) => l.id === "osOutra")).toBe(false);
    expect(todas.opcoes).toMatchObject({ clientes: [{ value: "c2", label: "Hospital Santa Luzia" }, { value: "c1", label: "Bom Preço" }], usuarios: [{ value: "uA", label: "Ana Souza" }, { value: "uB", label: "Bruno Dias" }] });
  });

  it("a lista de OS: menos idas ao banco em fila (antes 8 ondas só nas linhas; agora 2)", async () => {
    // A contagem por onda e os ms são medidos no servidor de verdade (PR: antes/depois); aqui, a forma do código:
    // duas esperas em paralelo e nenhum `include` (cada relação aninhada era uma ida em fila)
    const fonte = (await import("node:fs")).readFileSync(path.join(RAIZ, "lib/os/lista-server.ts"), "utf8");
    expect(fonte.match(/await Promise\.all\(\[/g)).toHaveLength(2);
    expect(fonte).not.toMatch(/include:/);
  });

  it("a sessão: o cadastro lido em paralelo tem o mesmo formato da consulta aninhada antiga", async () => {
    const { lerUsuario } = await import("@/lib/sessao-ativa");
    const antigo = async (id: string) => (await prisma.usuario.findUnique({
      where: { id },
      select: {
        ativo: true, senha: true, sessaoAtiva: true, trocarSenha: true,
        role: true, perfilAcesso: { select: { nome: true, ativo: true, permissoes: true } },
        empresa: { select: { ativo: true, configuracao: { select: { appUmDispositivo: true } } } },
      },
    })) ?? "removido";
    for (const [id, empresaDoToken] of [["uA", "e1"], ["uB", "e1"], ["uC", "e2"], ["uB", "e2"], ["uA", null], ["naoExiste", "e1"]] as const) {
      expect(await lerUsuario(id, empresaDoToken), `${id} ${empresaDoToken}`).toEqual(await antigo(id));
    }
  });
});
