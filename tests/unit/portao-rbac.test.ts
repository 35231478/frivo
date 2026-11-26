/**
 * O PORTÃO DE ACESSO (middleware) × a permissão que cada tela pede de verdade.
 *
 * O bug que este arquivo existe para não voltar: o middleware exige "visualizar" do módulo do
 * endereço. Quando a tela é de quem tem uma AÇÃO que não depende de "visualizar" — o módulo nem tem
 * essa ação (Admissão digital, Documentos do colaborador), ou a ação é de outro módulo (o App do
 * colaborador mora em /equipes e pede "Configurações › Gerenciar") — o menu mostrava o item e o
 * middleware barrava quem tinha a permissão. Só o administrador master passava.
 *
 * O que se prova:
 *  - a regra estrutural: todo módulo que o portão exige TEM a ação "visualizar"; todo item de menu
 *    marcado "a ação basta sozinha" fica FORA do portão; toda tela fora do portão se guarda sozinha;
 *  - perfil por perfil: quem tem só a ação entra, quem não tem continua barrado — pelo portão ou
 *    pela página (o portão não é a única defesa, e não virou porta aberta);
 *  - Configurações: quem tem só a permissão de um item chega à página, e o resto continua exigindo
 *    "Configurações › Visualizar".
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  CONFIG_COM_PERMISSAO_PROPRIA, MODULOS, PRESETS, moduloDaRota, montarPermissoes, permissoesTotais, permissoesVazias, pode, portaoBarra,
} from "@/lib/permissoes";
import { ITENS_CONFIGURACOES, podeVerItemConfig, secoesVisiveis } from "@/lib/navegacao/configuracoes";

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (arquivo: string) => readFileSync(path.join(RAIZ, arquivo), "utf8");
const PAINEL = path.join(RAIZ, "app/(dashboard)");

/** Os itens do menu, lidos do código do menu (href, módulo, ação e "a ação basta sozinha"). */
const itensDoMenu = fonte("components/layout/sidebar.tsx").split("\n")
  .filter((l) => /^\s*\{ href: "\//.test(l))
  .map((l) => ({
    href: /href: "([^"]+)"/.exec(l)![1],
    modulo: /modulo: "([^"]+)"/.exec(l)?.[1],
    acao: /acao: "([^"]+)"/.exec(l)?.[1],
    somenteAcao: /somenteAcao: true/.test(l),
  }));

const RH = montarPermissoes({ admissao: ["gerenciar"] });
const ENVIA = montarPermissoes({ documentos: ["enviar"] });
const CONFIGURA = montarPermissoes({ configuracoes: ["gerenciar"] });
const FISCAL = montarPermissoes({ financeiro: ["fiscal"] });
const MODELOS = montarPermissoes({ documentos: ["gerenciar"] });
const NADA = permissoesVazias();

describe("o portão do middleware: a regra estrutural", () => {
  // Mudou de propósito (leva 1, 26/11): antes a regra era "todo módulo do portão TEM visualizar", e
  // as telas de módulos sem "visualizar" ficavam FORA do mapa (exceção escrita à mão). Agora a regra
  // está no próprio portão (podeEntrarNoModulo): ele nunca exige uma ação que o módulo não tem —
  // módulo sem "visualizar" abre com qualquer ação dele. As telas voltaram ao mapa e quem não tem
  // NADA do módulo é barrado já no portão; a página continua conferindo a ação certa.
  it("o portão nunca exige uma ação que o módulo não tem: com qualquer ação de um módulo sem \"visualizar\" se entra", () => {
    const pastas = readdirSync(PAINEL).filter((p) => statSync(path.join(PAINEL, p)).isDirectory());
    expect(pastas.length).toBeGreaterThan(15);
    let semVisualizarNoMapa = 0;
    for (const p of pastas) {
      const m = moduloDaRota(`/${p}`);
      const def = m ? MODULOS.find((x) => x.id === m) : null;
      if (!def || def.acoes.includes("visualizar")) continue;
      semVisualizarNoMapa++;
      for (const a of def.acoes) {
        expect(portaoBarra(`/${p}`, montarPermissoes({ [m!]: [a] }), "OPERADOR"), `/${p} com só ${m}.${a}`).toBe(false);
      }
      expect(portaoBarra(`/${p}`, NADA, "OPERADOR"), `/${p} sem nada do módulo`).toBe(true);
    }
    expect(semVisualizarNoMapa, "/admissoes e /documentacao-equipe").toBe(2);
    // os dois módulos sem "visualizar" são exatamente os das telas que se guardam sozinhas
    expect(MODULOS.filter((m) => !m.acoes.includes("visualizar")).map((m) => m.id).sort()).toEqual(["admissao", "documentos"]);
  });

  it("todo item do menu em que \"a ação basta sozinha\" deixa passar quem só tem a ação", () => {
    const soAcao = itensDoMenu.filter((i) => i.somenteAcao);
    expect(soAcao.map((i) => i.href).sort()).toEqual([
      "/admissoes", "/documentacao-equipe", "/equipes/app-colaborador", "/estoque/devolucao", "/estoque/separacao",
      "/ordens/cumprimento",
    ]);
    for (const i of soAcao) {
      // ou fica fora do portão, ou o portão é do PRÓPRIO módulo da ação e ele não tem "visualizar"
      const m = moduloDaRota(i.href);
      if (m !== null) {
        expect(m, i.href).toBe(i.modulo);
        expect(MODULOS.find((x) => x.id === m)!.acoes, i.href).not.toContain("visualizar");
      }
      const soAAcao = montarPermissoes({ [i.modulo!]: [i.acao as never] });
      expect(pode(soAAcao, i.modulo!, i.acao as never), i.href).toBe(true);
      expect(portaoBarra(i.href, soAAcao, "OPERADOR"), `${i.href}: quem tem só a ação não é barrado`).toBe(false);
    }
  });

  it("todo item do menu que NÃO é \"só a ação\" continua atrás do portão do módulo dele", () => {
    // (o Dashboard é de todo mundo: `pode` libera sempre)
    const comPortao = itensDoMenu.filter((i) => !i.somenteAcao && moduloDaRota(i.href) && moduloDaRota(i.href) !== "dashboard");
    expect(comPortao.length).toBeGreaterThan(20);
    for (const i of comPortao) {
      expect(portaoBarra(i.href, NADA, "OPERADOR"), `${i.href}: perfil vazio é barrado`).toBe(true);
      expect(portaoBarra(i.href, permissoesTotais(), "OPERADOR"), `${i.href}: perfil completo passa`).toBe(false);
    }
  });

  it("toda tela fora do portão se guarda sozinha: a página confere a permissão e manda para /sem-permissao", () => {
    const paginas: [string, string][] = [
      ["app/(dashboard)/admissoes/page.tsx", 'if (!pode(user.permissoes, "admissao", "gerenciar", user.role)) redirect("/sem-permissao");'],
      ["app/(dashboard)/documentacao-equipe/page.tsx", 'if (!pode(user.permissoes, "documentos", "enviar", user.role)) redirect("/sem-permissao");'],
      ["app/(dashboard)/documentacao-equipe/novo/page.tsx", 'if (!pode(user.permissoes, "documentos", "enviar", user.role)) redirect("/sem-permissao");'],
      ["app/(dashboard)/equipes/app-colaborador/page.tsx", 'if (!pode(u.permissoes, "configuracoes", "gerenciar", u.role)) redirect("/sem-permissao");'],
      ["app/(dashboard)/estoque/separacao/page.tsx", 'if (!pode(u.permissoes, "estoque", "separar", u.role)) redirect("/sem-permissao");'],
      ["app/(dashboard)/estoque/devolucao/page.tsx", 'if (!pode(u.permissoes, "estoque", "separar", u.role)) redirect("/sem-permissao");'],
      ["app/(dashboard)/configuracoes/page.tsx", 'if (visiveis.length === 0) redirect("/sem-permissao");'],
      ["app/(dashboard)/compras/pedidos/[id]/page.tsx", 'if (!podeVerPedido(u, pedido)) redirect("/sem-permissao");'],
    ];
    for (const [arquivo, guarda] of paginas) expect(fonte(arquivo), arquivo).toContain(guarda);
  });

  it("o middleware usa a mesma função do portão (não há uma segunda regra escondida)", () => {
    const m = fonte("middleware.ts");
    expect(m).toContain("if (portaoBarra(pathname, user?.permissoes, user?.role)) {");
    expect(m, "nenhuma conferência de permissão solta além do portão").not.toMatch(/\bpode\(|moduloDaRota\(/);
    // quem o portão barra leva o endereço junto: /sem-permissao confere se o acesso foi concedido depois do login
    expect(m).toContain("NextResponse.redirect(new URL(destinoSemPermissao(pathname), req.url))");
  });
});

describe("Admissões: a lista é de quem gerencia admissão", () => {
  it("o RH que só tem \"Admissão digital › Gerenciar\" passa pelo portão — antes só o administrador master passava", () => {
    expect(portaoBarra("/admissoes", RH, "OPERADOR")).toBe(false);
    expect(portaoBarra("/admissoes?situacao=ASSINADO".split("?")[0], RH, "OPERADOR")).toBe(false);
    // o perfil "Administrador" (todas as permissões, sem ser o master) também era barrado
    expect(pode(PRESETS.ADMINISTRADOR, "admissao", "visualizar"), "a ação que o portão pedia nem existe").toBe(false);
    expect(portaoBarra("/admissoes", PRESETS.ADMINISTRADOR, "OPERADOR")).toBe(false);
  });

  it("quem não tem nada da admissão é barrado já no portão; e a página confere a ação de novo", () => {
    for (const perfil of [NADA, ENVIA, PRESETS.SUPERVISOR, montarPermissoes({ equipes: ["visualizar", "gerenciar", "excluir"] })]) {
      expect(pode(perfil, "admissao", "gerenciar", "OPERADOR")).toBe(false);
      expect(portaoBarra("/admissoes", perfil, "OPERADOR")).toBe(true);
    }
    const pagina = fonte("app/(dashboard)/admissoes/page.tsx");
    const guarda = pagina.indexOf('redirect("/sem-permissao")');
    expect(guarda).toBeGreaterThan(0);
    expect(guarda, "a guarda vem antes de qualquer consulta ao banco").toBeLessThan(pagina.indexOf("admissoesDaEmpresa(empresaId"));
  });

  it("gerenciar admissão não abre a ficha do colaborador nem a lista de colaboradores", () => {
    expect(portaoBarra("/colaboradores", RH, "OPERADOR")).toBe(true);
    expect(portaoBarra("/colaboradores/t1/editar", RH, "OPERADOR")).toBe(true);
    expect(portaoBarra("/equipes", RH, "OPERADOR")).toBe(true);
  });
});

describe("Documentação da equipe e App do colaborador", () => {
  it("\"Documentos › Enviar ao cliente\" abre o histórico e o novo envio, e mais nada de Equipes", () => {
    expect(portaoBarra("/documentacao-equipe", ENVIA, "OPERADOR")).toBe(false);
    expect(portaoBarra("/documentacao-equipe/novo", ENVIA, "OPERADOR")).toBe(false);
    expect(portaoBarra("/colaboradores", ENVIA, "OPERADOR")).toBe(true);
    // gerar documento na ficha passa pelo portão de "Documentos", mas a página exige "Enviar ao cliente"
    expect(portaoBarra("/documentacao-equipe", MODELOS, "OPERADOR")).toBe(false);
    expect(portaoBarra("/documentacao-equipe", NADA, "OPERADOR")).toBe(true);
    expect(pode(MODELOS, "documentos", "enviar", "OPERADOR")).toBe(false);
  });

  it("App do colaborador: \"Configurações › Gerenciar\" basta — o endereço mora em /equipes, mas não pede \"Equipes › Visualizar\"", () => {
    expect(portaoBarra("/equipes/app-colaborador", CONFIGURA, "OPERADOR")).toBe(false);
    expect(portaoBarra("/equipes", CONFIGURA, "OPERADOR"), "a lista de equipes continua atrás do portão").toBe(true);
    expect(portaoBarra("/equipes/eq1", CONFIGURA, "OPERADOR")).toBe(true);
    // e quem vê equipes não ganha a tela: a página exige a ação de configurar
    expect(pode(montarPermissoes({ equipes: ["visualizar", "gerenciar"] }), "configuracoes", "gerenciar", "OPERADOR")).toBe(false);
  });
});

describe("Configurações: quem tem a permissão de um item chega ao item dele", () => {
  it("a lista de itens com permissão própria é a dos cartões que não pedem \"Configurações\"", () => {
    const proprios = ITENS_CONFIGURACOES
      .filter((i) => i.modulo && i.modulo !== "configuracoes" && i.href.startsWith("/configuracoes/"))
      .map((i) => i.href.split("/")[2]);
    expect(proprios.sort()).toEqual([...CONFIG_COM_PERMISSAO_PROPRIA].sort());
  });

  it("nenhum cartão fica sem dono: sair do portão não tornou nenhum item visível a qualquer um", () => {
    // Os cartões comuns (Empresa, Preferências…) decidem quem vê pelo módulo da rota: por isso o
    // módulo de /configuracoes continua "configuracoes" — a exceção é do portão, não do módulo.
    expect(moduloDaRota("/configuracoes")).toBe("configuracoes");
    for (const i of ITENS_CONFIGURACOES) {
      if (moduloDaRota(i.href) === null) expect(i.modulo, `${i.id}: sem módulo próprio seria visível a qualquer um`).toBeTruthy();
      expect(podeVerItemConfig(i, NADA, "OPERADOR"), `${i.id}: perfil vazio não vê`).toBe(false);
      if (!i.modulo) expect(podeVerItemConfig(i, RH, "OPERADOR"), `${i.id}: o RH não vê cartão comum`).toBe(false);
    }
  });

  it("a página de Configurações sai do portão; os itens comuns continuam pedindo \"Configurações › Visualizar\"", () => {
    for (const perfil of [RH, FISCAL, MODELOS]) expect(portaoBarra("/configuracoes", perfil, "OPERADOR")).toBe(false);
    for (const item of CONFIG_COM_PERMISSAO_PROPRIA) {
      expect(portaoBarra(`/configuracoes/${item}`, NADA, "OPERADOR"), `${item}: a rota antiga só redireciona para a página, que confere`).toBe(false);
      expect(portaoBarra(`/configuracoes/${item}/qualquer`, NADA, "OPERADOR"), `${item}: só a rota do item, não o que vier depois`).toBe(true);
    }
    for (const comum of ["tipos-os", "usuarios", "perfis", "email", "produtos", "integracoes"]) {
      expect(moduloDaRota(`/configuracoes/${comum}`), comum).toBe("configuracoes");
      expect(portaoBarra(`/configuracoes/${comum}`, RH, "OPERADOR"), comum).toBe(true);
    }
    expect(moduloDaRota("/configuracoes/checklists-veiculo"), "a exceção da frota continua").toBe("veiculos");
  });

  it("cada perfil vê só o cartão dele — o RH não ganha usuários, perfis nem o resto", () => {
    const ids = (p: ReturnType<typeof montarPermissoes>) => secoesVisiveis(p, "OPERADOR").flatMap((s) => s.subgrupos.flatMap((g) => g.itens.map((i) => i.id)));
    expect(ids(RH)).toEqual(["admissao"]);
    expect(ids(FISCAL)).toEqual(["dados-fiscais"]);
    expect(ids(MODELOS)).toEqual(["modelos-documento"]);
    expect(ids(NADA), "sem nenhum cartão a página manda para /sem-permissao").toEqual([]);
    expect(ids(ENVIA), "enviar documentação ao cliente não é configurar nada").toEqual([]);
  });
});
