/**
 * Loja de Módulos — PR 1, as regras puras do catálogo (lib/modulos/catalogo.ts):
 *  - o NÚCLEO nunca desliga, aconteça o que acontecer com o banco;
 *  - AUSÊNCIA DE LINHA = LIGADO (a regra que faz este recurso não mudar nada para quem não mexeu);
 *  - DEPENDÊNCIA respeitada nos dois sentidos: desligar arrasta quem depende, ligar exige quem falta;
 *  - o gate só alcança os módulos JÁ MIGRADOS (`gateAtivo`) — a migração é módulo a módulo;
 *  - a TRAVA: o catálogo é coerente com o resto do sistema (ids únicos, rotas e permissões que existem).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MODULOS_CATALOGO, MODULOS_COM_GATE, MODULOS_NUCLEO, MODULOS_OPCIONAIS, MSG_MODULO_DESLIGADO,
  avisoDependencia, dependenciasFaltando, dependentesLigados, ehModuloNucleo, empresaTemModulo,
  moduloCatalogo, moduloDaPermissao, moduloDaRotaModular, rotuloModulo,
} from "@/lib/modulos/catalogo";
import { MODULOS as MODULOS_RBAC } from "@/lib/permissoes";

const desligados = (...ids: string[]) => new Set(ids);

/* ═════════ o núcleo ═════════ */

describe("O núcleo nunca desliga", () => {
  it("é a lista combinada — e é a mesma em `ehModuloNucleo`", () => {
    expect([...MODULOS_NUCLEO].sort()).toEqual(
      ["calendario", "clientes", "configuracoes", "dashboard", "equipes", "ordens", "relatorio-os"].sort());
    for (const id of MODULOS_NUCLEO) expect(ehModuloNucleo(id), id).toBe(true);
  });

  it("nem uma linha no banco derruba o núcleo: desligado na tabela, a resposta continua 'tem'", () => {
    // o pior caso: alguém roda um UPDATE na mão desligando tudo
    const tudoFora = desligados(...MODULOS_CATALOGO.map((m) => m.id));
    for (const id of MODULOS_NUCLEO) expect(empresaTemModulo(tudoFora, id), id).toBe(true);
    // e os opcionais, esses sim, ficam fora
    for (const id of MODULOS_OPCIONAIS) expect(empresaTemModulo(tudoFora, id), id).toBe(false);
  });

  it("núcleo não aparece como desligável nem no catálogo nem no gate", () => {
    for (const id of MODULOS_NUCLEO) {
      expect(MODULOS_OPCIONAIS).not.toContain(id);
      expect(moduloCatalogo(id)!.gateAtivo).toBeUndefined();
    }
  });
});

/* ═════════ ausência = ligado ═════════ */

describe("Ausência de linha = módulo ligado", () => {
  it("sem nada desligado, tudo responde 'tem' — é o estado de quem nunca mexeu", () => {
    for (const m of MODULOS_CATALOGO) expect(empresaTemModulo(new Set(), m.id), m.id).toBe(true);
    expect(empresaTemModulo(null, "veiculos")).toBe(true);
    expect(empresaTemModulo(undefined, "compras")).toBe(true);
  });

  it("id desconhecido nunca bloqueia: dado velho na tabela não esconde tela que existe", () => {
    expect(empresaTemModulo(desligados("modulo-que-nao-existe"), "modulo-que-nao-existe")).toBe(true);
    expect(empresaTemModulo(desligados("veiculos"), "modulo-que-nao-existe")).toBe(true);
  });

  it("só o módulo desligado some — os outros seguem ligados", () => {
    const d = desligados("veiculos");
    expect(empresaTemModulo(d, "veiculos")).toBe(false);
    expect(empresaTemModulo(d, "compras")).toBe(true);
    expect(empresaTemModulo(d, "estoque")).toBe(true);
  });
});

/* ═════════ dependências ═════════ */

describe("Dependência: Compras não vive sem Estoque", () => {
  it("o catálogo declara a dependência (é dela que sai todo o resto)", () => {
    expect(moduloCatalogo("compras")!.dependeDe).toEqual(["estoque"]);
  });

  it("desligar Estoque ARRASTA Compras — um pedido de compra sem estoque não tem onde dar entrada", () => {
    expect(dependentesLigados(new Set(), "estoque")).toContain("compras");
  });

  it("desligar Compras não arrasta Estoque (a dependência tem um sentido só)", () => {
    expect(dependentesLigados(new Set(), "compras")).toEqual([]);
  });

  it("quem já está desligado não é arrastado de novo", () => {
    expect(dependentesLigados(desligados("compras"), "estoque")).not.toContain("compras");
  });

  it("ligar Compras com Estoque desligado: o que falta é dito pelo nome", () => {
    expect(dependenciasFaltando(desligados("estoque"), "compras")).toEqual(["estoque"]);
    expect(dependenciasFaltando(new Set(), "compras")).toEqual([]);
  });

  it("a cascata vale em cadeia (NFS-e depende do Financeiro)", () => {
    expect(dependentesLigados(new Set(), "financeiro")).toEqual(expect.arrayContaining(["fiscal", "folha"]));
    expect(dependenciasFaltando(desligados("financeiro"), "fiscal")).toEqual(["financeiro"]);
  });

  it("o aviso é escrito em português de gente, e diz que nada é apagado", () => {
    expect(avisoDependencia([])).toBe("");
    expect(avisoDependencia(["compras"])).toBe(
      "Compras depende deste módulo e será desligado junto. Nada é apagado: religando, tudo volta como estava.");
    expect(avisoDependencia(["fiscal", "folha"])).toContain("NFS-e e Custo de pessoal dependem");
  });
});

/* ═════════ o gate só alcança o que já foi migrado ═════════ */

describe("A migração é módulo a módulo", () => {
  it("nesta fase, Frota, Compras e Estoque têm as 3 camadas de gate", () => {
    expect([...MODULOS_COM_GATE].sort()).toEqual(["compras", "estoque", "veiculos"]);
  });

  it("Estoque entrou com a dependência já fechada: Compras cai junto e não liga sem ele", () => {
    expect(dependentesLigados(new Set(), "estoque")).toEqual(["compras"]);
    expect(dependenciasFaltando(desligados("estoque"), "compras")).toEqual(["estoque"]);
    // os dois lados da cascata estão no gate: a regra virou alcançável pela tela
    expect(MODULOS_COM_GATE).toContain("estoque");
    expect(MODULOS_COM_GATE).toContain("compras");
  });

  it("a permissão de um módulo migrado leva ao módulo; a de um não migrado, a lugar nenhum", () => {
    expect(moduloDaPermissao("veiculos")).toBe("veiculos");
    expect(moduloDaPermissao("veiculos", "checklist")).toBe("veiculos");
    expect(moduloDaPermissao("compras", "gerenciar")).toBe("compras");
    expect(moduloDaPermissao("estoque", "separar")).toBe("estoque");
    // ainda não migrados: a API deles continua exatamente como sempre foi
    expect(moduloDaPermissao("financeiro", "fiscal")).toBeNull();
    expect(moduloDaPermissao("equipamentos")).toBeNull();
    // núcleo nunca entra no gate
    expect(moduloDaPermissao("ordens")).toBeNull();
    expect(moduloDaPermissao("clientes", "criar")).toBeNull();
  });

  it("a rota de um módulo migrado é reconhecida pelo prefixo mais longo", () => {
    expect(moduloDaRotaModular("/veiculos")).toBe("veiculos");
    expect(moduloDaRotaModular("/veiculos/abc/editar")).toBe("veiculos");
    expect(moduloDaRotaModular("/configuracoes/checklists-veiculo")).toBe("veiculos");
    expect(moduloDaRotaModular("/compras/pedidos/novo")).toBe("compras");
    expect(moduloDaRotaModular("/estoque")).toBe("estoque");
    expect(moduloDaRotaModular("/estoque/notas/abc")).toBe("estoque");
    expect(moduloDaRotaModular("/estoque/separacao")).toBe("estoque");
    // a rota do núcleo e a do módulo não migrado passam direto
    expect(moduloDaRotaModular("/ordens")).toBeNull();
    expect(moduloDaRotaModular("/equipamentos")).toBeNull();
    expect(moduloDaRotaModular("/configuracoes")).toBeNull();
  });

  it("/configuracoes só cai na Frota no caminho dos checklists (o resto das Configurações é núcleo)", () => {
    expect(moduloDaRotaModular("/configuracoes/usuarios")).toBeNull();
    expect(moduloDaRotaModular("/configuracoes/checklists-veiculo/novo")).toBe("veiculos");
  });
});

/* ═════════ a trava do catálogo ═════════ */

describe("O catálogo é coerente com o resto do sistema", () => {
  const RAIZ = path.resolve(__dirname, "../..");
  const ler = (arq: string) => readFileSync(path.join(RAIZ, arq), "utf8");

  it("ids únicos, nome e descrição em todos", () => {
    const ids = MODULOS_CATALOGO.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MODULOS_CATALOGO) {
      expect(m.nome.length, m.id).toBeGreaterThan(2);
      expect(m.descricao.length, m.id).toBeGreaterThan(15); // explica o que se perde, não repete o nome
      expect(m.descricao, m.id).toMatch(/\.$/);
    }
  });

  it("toda permissão citada existe de verdade no RBAC (nada de módulo fantasma)", () => {
    const rbac = new Map(MODULOS_RBAC.map((m) => [m.id, m.acoes as readonly string[]]));
    for (const m of MODULOS_CATALOGO) {
      for (const [modulo, acao] of m.permissoes ?? []) {
        expect(rbac.has(modulo), `${m.id} → ${modulo}`).toBe(true);
        if (acao) expect(rbac.get(modulo), `${m.id} → ${modulo}.${acao}`).toContain(acao);
      }
    }
  });

  it("toda dependência aponta para um módulo que existe, e nenhum depende de si mesmo", () => {
    for (const m of MODULOS_CATALOGO) {
      for (const d of m.dependeDe ?? []) {
        expect(moduloCatalogo(d), `${m.id} → ${d}`).not.toBeNull();
        expect(d).not.toBe(m.id);
      }
    }
  });

  it("módulo com gate declara rota E permissão — sem isso o gate não tem como agir", () => {
    for (const id of MODULOS_COM_GATE) {
      const m = moduloCatalogo(id)!;
      expect(m.rotas?.length, id).toBeGreaterThan(0);
      expect(m.permissoes?.length, id).toBeGreaterThan(0);
    }
  });

  it("as páginas dos módulos migrados CHAMAM o portão com o módulo certo (não basta importar)", () => {
    const paginas: [arquivo: string, modulo: string][] = [
      ["app/(dashboard)/veiculos/page.tsx", "veiculos"],
      ["app/(dashboard)/configuracoes/checklists-veiculo/page.tsx", "veiculos"],
      ["app/(dashboard)/compras/pedidos/page.tsx", "compras"],
      ["app/(dashboard)/estoque/page.tsx", "estoque"],
      ["app/(dashboard)/estoque/[produtoId]/page.tsx", "estoque"],
      ["app/(dashboard)/estoque/notas/page.tsx", "estoque"],
      ["app/(dashboard)/estoque/notas/[id]/page.tsx", "estoque"],
      ["app/(dashboard)/estoque/separacao/page.tsx", "estoque"],
      ["app/(dashboard)/estoque/separacao/[osId]/page.tsx", "estoque"],
      ["app/(dashboard)/estoque/devolucao/page.tsx", "estoque"],
      ["app/(dashboard)/estoque/devolucao/[osId]/page.tsx", "estoque"],
    ];
    for (const [arquivo, modulo] of paginas) {
      expect(ler(arquivo), arquivo).toContain(`exigirModuloNaPagina("${modulo}")`);
    }
  });

  it("os CAMPOS-PONTE perguntam à lib dos módulos (o padrão das levas: some o campo do módulo off)", () => {
    // Cada um destes é uma tela do NÚCLEO que mostra um campo de um módulo opcional. O padrão é
    // perguntar `useModulos().tem(...)` e esconder o campo — nunca deixá-lo vazio e órfão.
    const pontes: [arquivo: string, modulo: string][] = [
      ["components/forms/equipe-form.tsx", "veiculos"],
      ["components/forms/colaborador-form.tsx", "veiculos"],
      ["components/os/seletor-execucao.tsx", "veiculos"],
      ["components/compras/compras-secao.tsx", "compras"],
      ["components/os/os-detalhe.tsx", "estoque"],
    ];
    for (const [arquivo, modulo] of pontes) {
      const src = ler(arquivo);
      expect(src, arquivo).toContain("useModulos");
      expect(src, `${arquivo} → ${modulo}`).toContain(`tem("${modulo}")`);
    }
    // e a central da OS repassa ao painel de material (senão a ponte do Estoque não chega lá)
    expect(ler("components/os/os-detalhe.tsx")).toContain("temEstoque={temEstoque}");
  });

  it("quem decide o entitlement é um arquivo só — a tela e a API perguntam, não decidem", () => {
    // `empresaTemModulo` é a única porta; ninguém compara a lista de desligados na mão
    const fontes = ["lib/permissoes-server.ts", "lib/modulos/pagina.ts", "components/providers/modulos-provider.tsx"];
    for (const f of fontes) {
      expect(ler(f), f).not.toMatch(/desligados\.(has|includes)\(/);
    }
    expect(ler("lib/modulos/servidor.ts")).toMatch(/import \{[^}]*empresaTemModulo/);
  });

  it("a mensagem do módulo desligado diz o nome e o caminho da solução", () => {
    const msg = MSG_MODULO_DESLIGADO("veiculos");
    expect(msg).toContain("Frota");
    expect(msg).toContain("Configurações");
    expect(rotuloModulo("compras")).toBe("Compras");
    expect(rotuloModulo("inexistente")).toBe("inexistente"); // nunca quebra
  });
});
