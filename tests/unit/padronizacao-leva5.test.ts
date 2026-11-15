/**
 * Leva 5 da padronização — Operação (ordens, calendário, prazos, PMOC): as REGRAS PURAS e as
 * guardas de fonte.
 *
 *  - sugestões da abertura da OS (Princípio 9: sugere, não preenche no escuro): janela de 6 meses,
 *    mínimo de 2 OS, conta OS distintas (não atividades), empate não sugere, histórico fino não
 *    sugere, a equipe tem precedência sobre o técnico e o texto diz de onde veio;
 *  - o `where` da lista de PMOC: situação, busca e inativados;
 *  - a ordenação da lista de PMOC (lista branca);
 *  - guardas: nenhuma das telas desta leva mantém tabela própria, toast próprio, parágrafo de
 *    instrução ou botão sem permissão.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  JANELA_MESES, MINIMO_OS, chaveDoExecutor, inicioDaJanela, maisUsado, notaDaSugestao,
  sugestoesDoCliente, ultimoExecutor, type AtividadeDoHistorico,
} from "@/lib/os/sugestoes";
import { filtroStatusPmoc, lerFiltrosPmoc, wherePmoc } from "@/lib/pmoc";
import { ORDEM_PMOC, ORDEM_PADRAO_PMOC } from "@/lib/listas/ordenacao";
import { lerOrdem, ordemPrisma } from "@/lib/listagem";

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (p: string) => fs.readFileSync(path.join(RAIZ, p), "utf8");

/** Atividade do histórico: por padrão a OS é a própria (uma atividade por OS). */
const at = (os: string, extra: Partial<AtividadeDoHistorico> = {}): AtividadeDoHistorico =>
  ({ ordemServicoId: os, tipoOsId: null, tecnicoId: null, equipeId: null, ...extra });

/* ═════════ sugestões da abertura da OS ═════════ */
describe("sugestões da abertura da OS: a janela e o mínimo", () => {
  it("a janela é de 6 meses e o mínimo é 2 OS (uma visita solta não vira sugestão)", () => {
    expect(JANELA_MESES).toBe(6);
    expect(MINIMO_OS).toBe(2);
  });

  it("o início da janela é 6 meses antes de agora", () => {
    expect(inicioDaJanela(new Date("2026-11-15T12:00:00.000Z")).toISOString()).toBe("2026-05-15T12:00:00.000Z");
    // vira o ano para trás sem estourar
    expect(inicioDaJanela(new Date("2026-02-10T00:00:00.000Z")).toISOString().slice(0, 7)).toBe("2025-08");
  });

  it("HISTÓRICO FINO não sugere nada: cliente novo, uma OS só, ou OS sem tipo e sem executor", () => {
    expect(sugestoesDoCliente([])).toEqual({ tipoOs: null, executor: null });
    // uma única OS, completa: ainda é fino (mínimo 2)
    expect(sugestoesDoCliente([at("os1", { tipoOsId: "tp1", tecnicoId: "t1" })])).toEqual({ tipoOs: null, executor: null });
    // duas OS, mas sem tipo e sem quem executou gravados
    expect(sugestoesDoCliente([at("os1"), at("os2")])).toEqual({ tipoOs: null, executor: null });
  });

  it("com 2 OS do mesmo tipo e do mesmo técnico, sugere as duas coisas com o número de OS", () => {
    const h = [at("os2", { tipoOsId: "tp1", tecnicoId: "t1" }), at("os1", { tipoOsId: "tp1", tecnicoId: "t1" })];
    expect(sugestoesDoCliente(h)).toEqual({
      tipoOs: { valor: "tp1", vezes: 2 },
      executor: { valor: { tipo: "tecnico", id: "t1" }, vezes: 2 },
    });
  });
});

describe("sugestão do tipo de OS: o mais usado, contando OS distintas", () => {
  it("conta OS DISTINTAS, não atividades: uma OS partida em três atividades é UM atendimento", () => {
    // os1 tem três atividades do tipo tp2; os2 e os3 são do tipo tp1 → tp1 ganha (2 OS × 1 OS)
    const h = [
      at("os1", { tipoOsId: "tp2" }), at("os1", { tipoOsId: "tp2" }), at("os1", { tipoOsId: "tp2" }),
      at("os2", { tipoOsId: "tp1" }), at("os3", { tipoOsId: "tp1" }),
    ];
    expect(maisUsado(h, (a) => a.tipoOsId)).toEqual({ valor: "tp1", vezes: 2 });
  });

  it("EMPATE no topo não sugere: não existe 'o mais usado'", () => {
    const h = [at("os1", { tipoOsId: "tp1" }), at("os2", { tipoOsId: "tp1" }), at("os3", { tipoOsId: "tp2" }), at("os4", { tipoOsId: "tp2" })];
    expect(maisUsado(h, (a) => a.tipoOsId)).toBeNull();
    // com uma OS a mais, o empate se desfaz
    expect(maisUsado([...h, at("os5", { tipoOsId: "tp2" })], (a) => a.tipoOsId)).toEqual({ valor: "tp2", vezes: 3 });
  });

  it("empate FORA do topo não atrapalha", () => {
    const h = [
      at("os1", { tipoOsId: "tp1" }), at("os2", { tipoOsId: "tp1" }), at("os3", { tipoOsId: "tp1" }),
      at("os4", { tipoOsId: "tp2" }), at("os5", { tipoOsId: "tp3" }),
    ];
    expect(maisUsado(h, (a) => a.tipoOsId)).toEqual({ valor: "tp1", vezes: 3 });
  });

  it("valor nulo é ignorado (OS sem tipo não conta como 'tipo nenhum')", () => {
    const h = [at("os1"), at("os2"), at("os3", { tipoOsId: "tp1" }), at("os4", { tipoOsId: "tp1" })];
    expect(maisUsado(h, (a) => a.tipoOsId)).toEqual({ valor: "tp1", vezes: 2 });
  });
});

describe("sugestão de quem executa: o último, se não foi de passagem", () => {
  it("a chave do executor: a EQUIPE tem precedência sobre o técnico; sem nenhum, é nulo", () => {
    expect(chaveDoExecutor(at("os1", { equipeId: "eq1", tecnicoId: "t1" }))).toBe("equipe:eq1");
    expect(chaveDoExecutor(at("os1", { tecnicoId: "t1" }))).toBe("tecnico:t1");
    expect(chaveDoExecutor(at("os1"))).toBeNull();
  });

  it("é o ÚLTIMO (a lista vem da atividade mais nova para a mais antiga), não o mais frequente", () => {
    // t2 atendeu por último (2 OS); t1 atendeu mais vezes (3) — a sugestão é t2
    const h = [
      at("os5", { tecnicoId: "t2" }), at("os4", { tecnicoId: "t2" }),
      at("os3", { tecnicoId: "t1" }), at("os2", { tecnicoId: "t1" }), at("os1", { tecnicoId: "t1" }),
    ];
    expect(ultimoExecutor(h)).toEqual({ valor: { tipo: "tecnico", id: "t2" }, vezes: 2 });
  });

  it("o último que apareceu UMA vez só não é sugerido (visita de passagem), mesmo com histórico gordo", () => {
    const h = [
      at("os9", { tecnicoId: "tNovo" }),
      at("os3", { tecnicoId: "t1" }), at("os2", { tecnicoId: "t1" }), at("os1", { tecnicoId: "t1" }),
    ];
    expect(ultimoExecutor(h)).toBeNull();
  });

  it("equipe sugerida como equipe, contando OS distintas", () => {
    const h = [
      at("os3", { equipeId: "eq1", tecnicoId: "t9" }), at("os3", { equipeId: "eq1", tecnicoId: "t8" }),
      at("os2", { equipeId: "eq1", tecnicoId: "t9" }),
    ];
    expect(ultimoExecutor(h)).toEqual({ valor: { tipo: "equipe", id: "eq1" }, vezes: 2 });
  });
});

describe("o texto da sugestão diz de onde veio (nada de cara de IA)", () => {
  it("o tipo e o executor têm motivos diferentes, com o número de OS e a janela", () => {
    expect(notaDaSugestao(3, "tipo")).toBe("O tipo mais usado neste cliente — 3 OS nos últimos 6 meses. Confira antes de salvar.");
    expect(notaDaSugestao(2, "executor")).toBe("Quem atendeu este cliente da última vez — 2 OS nos últimos 6 meses. Confira antes de salvar.");
  });

  it("não fala de IA, nem promete que já preencheu", () => {
    for (const t of [notaDaSugestao(2, "tipo"), notaDaSugestao(2, "executor")]) {
      expect(t).not.toMatch(/\b(IA|inteligência|automaticamente|preenchemos)\b/i);
      expect(t).toMatch(/Confira antes de salvar\.$/);
    }
  });
});

/* ═════════ a lista de PMOC ═════════ */
describe("PMOC: o where da lista (o mesmo da busca)", () => {
  const AGORA = new Date("2026-11-15T15:00:00.000Z");

  it("os filtros vêm da URL; o resto é ignorado", () => {
    expect(lerFiltrosPmoc({ busca: "  hospital ", status: "VIGENTE", inativos: "1", outro: "x" })).toEqual({ busca: "hospital", status: "VIGENTE", inativos: true });
    expect(lerFiltrosPmoc({})).toEqual({ busca: "", status: "", inativos: false });
    expect(lerFiltrosPmoc({ inativos: "0" }).inativos).toBe(false);
  });

  it("sem 'Mostrar inativos', o inativado (soft-delete) fica fora", () => {
    expect(wherePmoc("e1", {}, 30, AGORA)).toEqual({ empresaId: "e1", ativo: true });
    expect(wherePmoc("e1", { inativos: true }, 30, AGORA)).toEqual({ empresaId: "e1" });
  });

  it("a situação usa exatamente o mesmo filtro do selo", () => {
    expect(wherePmoc("e1", { status: "VIGENTE" }, 30, AGORA)).toMatchObject(filtroStatusPmoc("VIGENTE", AGORA, 30)!);
    expect(wherePmoc("e1", { status: "VENCENDO" }, 30, AGORA)).toMatchObject(filtroStatusPmoc("VENCENDO", AGORA, 30)!);
    // status desconhecido não filtra nada (nem derruba a lista)
    expect(wherePmoc("e1", { status: "QUALQUER" }, 30, AGORA)).toEqual({ empresaId: "e1", ativo: true });
  });

  it("a busca olha nome do plano, cliente (razão e fantasia) e local", () => {
    const w = wherePmoc("e1", { busca: "santa" }, 30, AGORA) as any;
    expect(w.OR).toEqual([
      { nome: { contains: "santa", mode: "insensitive" } },
      { cliente: { nome: { contains: "santa", mode: "insensitive" } } },
      { cliente: { nomeFantasia: { contains: "santa", mode: "insensitive" } } },
      { unidade: { nome: { contains: "santa", mode: "insensitive" } } },
    ]);
    // busca em branco não vira OR nenhum
    expect((wherePmoc("e1", { busca: "   " }, 30, AGORA) as any).OR).toBeUndefined();
  });
});

describe("PMOC: a ordenação da lista é lista branca", () => {
  it("as colunas ordenáveis são as da tabela, e o padrão é inativo no fim + vence primeiro", () => {
    expect(Object.keys(ORDEM_PMOC).sort()).toEqual(["cliente", "equipamentos", "local", "nome", "validade"]);
    expect(ORDEM_PADRAO_PMOC).toEqual([{ ativo: "desc" }, { dataExpiracao: "asc" }]);
  });

  it("coluna de fora da lista cai no padrão; a escolhida ganha o id de desempate", () => {
    expect(ordemPrisma(lerOrdem({ ordem: "inventada" }, ORDEM_PMOC), ORDEM_PMOC, ORDEM_PADRAO_PMOC))
      .toEqual([{ ativo: "desc" }, { dataExpiracao: "asc" }, { id: "asc" }]);
    expect(ordemPrisma(lerOrdem({ ordem: "cliente", dir: "desc" }, ORDEM_PMOC), ORDEM_PMOC, ORDEM_PADRAO_PMOC))
      .toEqual([{ cliente: { nome: "desc" } }, { id: "asc" }]);
  });
});

/* ═════════ guardas de fonte ═════════ */
describe("Leva 5: as telas da Operação no padrão (guardas de fonte)", () => {
  it("o calendário não tem mais toast PRÓPRIO: usa o da casa", () => {
    const f = fonte("components/calendario/calendario-grid.tsx");
    expect(f).toMatch(/import \{ toast \} from "@\/components\/ui\/avisos"/);
    expect(f).not.toMatch(/setToasts|toastSeq|type ToastMsg/);
  });

  it("o calendário pede permissão nos botões que gravam (e o cadeado continua só para OS concluída)", () => {
    const f = fonte("components/calendario/calendario-grid.tsx");
    expect(f).toMatch(/const podeCriar = pode\("ordens", "criar"\)/);
    expect(f).toMatch(/const podeReagendar = pode\("ordens", "editar"\)/);
    // sem permissão de editar, nenhum sensor de arrasto é registrado
    expect(f).toMatch(/useSensors\(\.\.\.\(podeReagendar \? \[sensorMouse, sensorToque\] : \[\]\)\)/);
    expect(f).toMatch(/if \(!podeReagendar \|\| !data \|\| !destino/);
    expect(f).toMatch(/const travada = bloqueada\(card\);/);
  });

  it("gerar OS recorrentes é ação sensível: botão só com permissão e resultado em toast", () => {
    const f = fonte("components/calendario/gerar-os-recorrentes.tsx");
    expect(f).toMatch(/if \(!pode\("ordens", "criar"\) && !pode\("contratos", "editar"\)\) return null;/);
    expect(f).toMatch(/toast\(/);
    expect(f).not.toMatch(/criada\(s\)|setFeedback/);
  });

  it("os seletores do diálogo 'Nova OS' do calendário são os do padrão (cadastro inline + editar no contexto)", () => {
    const f = fonte("components/calendario/calendario-grid.tsx");
    expect(f).toMatch(/SelectCadastroRapido/);
    expect(f).toMatch(/edicao=\{CLIENTE\.edicao\(\)\}/);
    expect(f).toMatch(/edicao=\{TIPO_OS\.edicao\(/);
    expect(f).not.toMatch(/<BuscaSelect/);
  });

  it("prazos e PMOC usam os filtros da casa: sem <form method=\"get\"> nem botão \"Filtrar\"", () => {
    for (const p of ["app/(dashboard)/prazos/page.tsx", "app/(dashboard)/pmoc/page.tsx"]) {
      const f = fonte(p);
      expect(f, p).not.toMatch(/method="get"/);
      expect(f, p).not.toMatch(/>Filtrar</);
      expect(f, p).toMatch(/FiltroSelectUrl/);
    }
  });

  it("a lista de PMOC virou TabelaPro paginada (a tabela própria e o teto de 500 saíram)", () => {
    const f = fonte("app/(dashboard)/pmoc/page.tsx");
    expect(f).toMatch(/TabelaProUrl/);
    expect(f).toMatch(/PaginacaoUrl/);
    expect(f).not.toMatch(/<table/);
    expect(f).not.toMatch(/take: 500/);
    // vocabulário: "equipamento(s)" não existe mais
    expect(f).not.toMatch(/equipamento\(s\)/);
  });

  it("a tabela de equipamentos cobertos do PMOC também é TabelaPro", () => {
    const f = fonte("components/pmoc/pmoc-editor.tsx");
    expect(f).toMatch(/<TabelaPro\s/);
    expect(f).not.toMatch(/<table/);
  });

  it("o editor do PMOC grava com toast e deixa só o erro na tela", () => {
    const f = fonte("components/pmoc/pmoc-editor.tsx");
    expect(f).toMatch(/import \{ toast \} from "@\/components\/ui\/avisos"/);
    expect(f).toMatch(/data-erro-pmoc/);
    expect(f).not.toMatch(/data-msg=/);
    expect(f).not.toMatch(/setMsg\(/);
  });

  it("o responsável técnico do PMOC usa o cadastro rápido da casa, com editar no contexto", () => {
    const f = fonte("components/pmoc/pmoc-editor.tsx");
    expect(f).toMatch(/RESPONSAVEL_TECNICO\.campos/);
    expect(f).toMatch(/RESPONSAVEL_TECNICO\.edicao\(/);
    expect(f).toMatch(/edicao=\{CLIENTE\.edicao\(\)\}/);
    expect(f).toMatch(/edicao=\{UNIDADE\.edicao</);
    expect(f).not.toMatch(/aria-label="Responsável técnico cadastrado" value=/);
  });

  it("a instrução das telas desta leva está no ⓘ, não num parágrafo na tela", () => {
    for (const p of [
      "app/(dashboard)/prazos/page.tsx", "app/(dashboard)/pmoc/page.tsx",
      "app/(dashboard)/calendario/page.tsx", "components/ordens/ordens-lista-client.tsx",
    ]) {
      const f = fonte(p);
      expect(f, p).toMatch(/<Dica texto=\{AJUDA\}/);
    }
    // a base legal do PMOC saiu do corpo da tela
    expect(fonte("app/(dashboard)/pmoc/page.tsx")).not.toMatch(/<p className="text-xs text-ink-muted">Plano de Manutenção/);
  });

  it("a rota morta /ordens/[id]/editar (que só redirecionava) não existe mais, e ninguém aponta para ela", () => {
    expect(fs.existsSync(path.join(RAIZ, "app/(dashboard)/ordens/[id]/editar"))).toBe(false);
    const procurar = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") return [];
      const p = path.join(dir, e.name);
      return e.isDirectory() ? procurar(p) : /\.tsx?$/.test(e.name) ? [p] : [];
    });
    const culpados = [...procurar(path.join(RAIZ, "app")), ...procurar(path.join(RAIZ, "components"))]
      .filter((p) => /\/ordens\/\$\{[^}]+\}\/editar|\/ordens\/\[id\]\/editar/.test(fs.readFileSync(p, "utf8")));
    expect(culpados).toEqual([]);
  });

  it("o cabeçalho da OS abre a edição de verdade (gaveta) e trava o registro fechado", () => {
    const f = fonte("components/os/central/cabecalho-os.tsx");
    expect(f).toMatch(/data-editar-os-abrir/);
    expect(f).toMatch(/data-editar-os-travado/);
    expect(f).toMatch(/<EditarOs /);
    expect(f).not.toMatch(/ordens\/\$\{os\.id\}\/editar/);
  });

  it("o servidor também trava os campos da OS fechada (não é só a tela)", () => {
    const f = fonte("app/api/ordens/[id]/route.ts");
    expect(f).toMatch(/CAMPOS_TRAVAVEIS/);
    expect(f).toMatch(/travaDasLinhasDaOs\(id\)/);
    expect(f).toMatch(/status: 409/);
  });

  it("a sugestão nunca preenche sozinha: só entra no clique em \"Usar\"", () => {
    const f = fonte("components/os/sugestao-abertura.tsx");
    expect(f).toMatch(/data-usar-sugestao/);
    expect(f).toMatch(/data-dispensar-sugestao/);
    expect(f).toMatch(/onClick=\{onUsar\}/);
    // a linha usa o texto único das regras (nada de frase paralela na tela)
    expect(f).toMatch(/notaDaSugestao\(vezes, oQue\)/);
  });
});
