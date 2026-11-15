/**
 * Leva 7B — Comprar (notas de compra e pedidos): guardas de FONTE.
 *
 * O que não pode voltar com um "refactor distraído":
 *  - ⓘ no título das cinco telas, e nenhuma instrução solta em parágrafo;
 *  - as duas listas (notas e pedidos) na tabela da casa, com cartões no celular — nada de <table>
 *    escrita à mão; a planilha de trabalho da conciliação continua sendo formulário, não lista;
 *  - todo botão sensível depende de permissão NA TELA (importar NF, conciliar e lançar, editar e
 *    cancelar pedido, enviar ao fornecedor, desvincular nota, novo pedido avulso) e o servidor
 *    recusa de novo (401/403) em cada rota;
 *  - gravação confirma por toast (importar, rascunho, lançar, desvincular, enviar);
 *  - o vínculo nota↔estoque↔conta a pagar não tem porta de saída: nenhuma rota apaga nota lançada,
 *    movimento de estoque ou conta a pagar gerada — corrigir é estorno/ajuste, como na leva 7A;
 *  - a sugestão do pedido avulso usa as regras puras (nada de SQL solto na tela) e só aparece onde
 *    faz sentido.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

const NOTAS = "app/(dashboard)/estoque/notas/page.tsx";
const NOTA = "app/(dashboard)/estoque/notas/[id]/page.tsx";
const PEDIDOS = "app/(dashboard)/compras/pedidos/page.tsx";
const PEDIDO = "app/(dashboard)/compras/pedidos/[id]/page.tsx";
const NOVO = "app/(dashboard)/compras/pedidos/novo/page.tsx";
const TELAS = [NOTAS, NOTA, PEDIDOS, PEDIDO, NOVO];

const IMPORTAR = "components/compras/importar-nota.tsx";
const CONCILIACAO = "components/compras/conciliacao-nota.tsx";
const PAINEL = "components/compras/pedido-painel.tsx";
const EDITOR = "components/compras/editor-pedido.tsx";
const SUGESTOES = "components/compras/sugestoes-compra.tsx";

const ROTA_NOTAS = "app/api/compras/notas/route.ts";
const ROTA_RASCUNHO = "app/api/compras/notas/[id]/conciliacao/route.ts";
const ROTA_VINCULOS = "app/api/compras/notas/[id]/vinculos/route.ts";
const ROTA_LANCAR = "app/api/compras/notas/[id]/lancar/route.ts";
const ROTA_PEDIDOS = "app/api/pedidos-compra/route.ts";
const ROTA_PEDIDO = "app/api/pedidos-compra/[id]/route.ts";
const ROTA_ENVIAR = "app/api/pedidos-compra/[id]/enviar/route.ts";
const ROTA_CANCELAR = "app/api/pedidos-compra/[id]/cancelar/route.ts";
const ROTA_SUGESTOES = "app/api/compras/sugestoes/route.ts";

describe("o ⓘ e o vocabulário", () => {
  it("as cinco telas explicam no ⓘ, não em parágrafo de instrução", () => {
    for (const arq of TELAS) {
      const src = ler(arq);
      expect(src, arq).toMatch(/^const AJUDA =/m);
      // ou o ⓘ ao lado do <h1>, ou o do PageHeader — os dois são o mesmo componente
      expect(src, arq).toMatch(/<Dica texto=\{AJUDA\}|dica=\{AJUDA\}/);
    }
  });

  it("o ⓘ das notas conta o vínculo (estoque + conta a pagar) e que nota lançada não se apaga", () => {
    for (const arq of [NOTAS, NOTA]) {
      const ajuda = ler(arq).match(/^const AJUDA = "(.*)";$/m)![1];
      expect(ajuda, arq).toMatch(/entrada no estoque/i);
      expect(ajuda, arq).toMatch(/conta a pagar/i);
      expect(ajuda, arq).toMatch(/não se apaga|não se apagam/i);
    }
  });

  it("o ⓘ dos pedidos conta o ciclo e onde a NF entra", () => {
    for (const arq of [PEDIDOS, PEDIDO]) {
      const ajuda = ler(arq).match(/^const AJUDA = "(.*)";$/m)![1];
      expect(ajuda, arq).toMatch(/Solicitado/);
      expect(ajuda, arq).toMatch(/Concluído/);
      expect(ajuda, arq).toMatch(/Notas de compra/);
    }
  });

  it("nenhuma das telas usa emoji nem plural abreviado", () => {
    // "entrada(s)", "item(ns)": o plural é escrito, como nas levas anteriores
    const abreviado = /(nota|item|entrada|conta|pedido|produto|fornecedor|unidade)\((s|ns|es|is)\)/i;
    for (const arq of [...TELAS, IMPORTAR, CONCILIACAO, PAINEL, EDITOR, SUGESTOES]) {
      const src = ler(arq);
      expect(src, arq).not.toMatch(abreviado);
      expect(src, arq).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u);
    }
  });
});

describe("as duas listas na tabela da casa", () => {
  for (const [arq, tela] of [[NOTAS, "notas-compra"], [PEDIDOS, "pedidos-compra"]] as const) {
    it(`${tela}: TabelaProUrl com cartões no celular, e nenhuma <table> à mão`, () => {
      const src = ler(arq);
      expect(src, arq).toContain('from "@/components/listagem/lista-url"');
      expect(src, arq).toContain(`<TabelaProUrl`);
      expect(src, arq).toContain(`tela="${tela}"`);
      expect(src, arq).toContain("cartoes={");
      expect(src, arq).toContain("data-cartoes");
      expect(src, arq).not.toMatch(/<table[\s>]/);
      expect(src, arq).not.toMatch(/<thead[\s>]/);
      // lista vazia no padrão (a das notas não tem busca; a de pedidos usa a faixa com Limpar busca)
      expect(src, arq).toMatch(/<ListaVazia |data-lista-vazia/);
    });
  }

  it("a conciliação e o editor são FORMULÁRIO: tokens PLANILHA, nunca TabelaPro", () => {
    for (const arq of [CONCILIACAO, EDITOR]) {
      const src = ler(arq);
      expect(src, arq).toContain('from "@/lib/planilha"');
      expect(src, arq).not.toContain("TabelaPro");
    }
    // o código do item da nota na mesma fonte de código do resto do sistema
    expect(ler(CONCILIACAO)).toContain("className={PLANILHA.codigo}");
    // quantidade e valor do pedido alinhados pelos algarismos, como numa planilha
    expect(ler(EDITOR).match(/className=\{PLANILHA\.numero\}/g)).toHaveLength(2);
  });

  it("a coluna do número usa o token de código (mesma fonte do resto do sistema)", () => {
    for (const arq of [NOTAS, PEDIDOS]) {
      expect(ler(arq), arq).toContain("PLANILHA.codigo");
    }
  });
});

describe("prioridade 1: botão sensível só com permissão", () => {
  it("importar NF só aparece para quem lança estoque", () => {
    const src = ler(NOTAS);
    expect(src).toContain('const podeImportar = pode(u.permissoes, "estoque", "gerenciar", u.role);');
    expect(src).toContain("{podeImportar && <ImportarNota");
  });

  it("a tela da nota passa cada poder adiante (lançar, precificar, vincular pedido)", () => {
    const src = ler(NOTA);
    expect(src).toContain('pode(u.permissoes, "estoque", "gerenciar", u.role)');
    expect(src).toContain('pode(u.permissoes, "financeiro", "fluxoCaixa", u.role)');
    expect(src).toContain('pode(u.permissoes, "compras", "gerenciar", u.role)');
    expect(src).toMatch(/podeLancar=\{/);
    expect(src).toMatch(/podePrecificar=\{/);
  });

  it("conciliar e lançar: sem o poder, o botão fica travado e a tela diz por quê", () => {
    const src = ler(CONCILIACAO);
    expect(src).toMatch(/disabled=\{[^}]*!podeLancar/);
    expect(src).toContain("data-sem-lancar");
  });

  it("novo pedido avulso: botão só com Compras › gerenciar, e a página também barra", () => {
    expect(ler(PEDIDOS)).toContain("{podeCriar && (");
    expect(ler(NOVO)).toContain('if (!pode(u.permissoes, "compras", "gerenciar", u.role)) redirect("/sem-permissao");');
  });

  it("no painel do pedido, cada ação depende do poder que veio do servidor", () => {
    const src = ler(PAINEL);
    for (const [flag, marca] of [
      ["pedido.podeEnviar", "data-baixar-pc"],
      ["pedido.podeEditar", "data-editar-pedido"],
      ["pedido.podeEditar", "data-cancelar-pedido"],
      ["pedido.podeDesvincular", "data-desvincular-nota"],
    ] as const) {
      expect(src, marca).toContain(marca);
      expect(src, flag).toContain(`{${flag} &&`);
    }
  });

  it("a tela do pedido só abre para quem pode vê-lo", () => {
    expect(ler(PEDIDO)).toContain('if (!podeVerPedido(u, pedido)) redirect("/sem-permissao");');
  });
});

describe("prioridade 1: o servidor recusa de novo", () => {
  it("cada rota de compra tem a sua guarda (401 sem sessão, 403 sem a permissão)", () => {
    for (const [arq, marca] of [
      [ROTA_NOTAS, 'exigirPermissao("estoque", "gerenciar")'],
      [ROTA_RASCUNHO, 'exigirPermissao("estoque", "gerenciar")'],
      [ROTA_VINCULOS, 'exigirPermissao("compras", "gerenciar")'],
      [ROTA_LANCAR, 'exigirPermissao("estoque", "gerenciar")'],
      [ROTA_SUGESTOES, 'exigirPermissao("compras", "gerenciar")'],
    ] as const) {
      expect(ler(arq), arq).toContain(marca);
    }
    for (const [arq, marca] of [
      [ROTA_PEDIDOS, 'pode(p, "compras", "gerenciar", u.role)'],
      [ROTA_PEDIDO, "podeEditarPedido(u, pedido)"],
      [ROTA_ENVIAR, "podeEnviarPedido(u, pedido)"],
      [ROTA_CANCELAR, "podeEditarPedido(u, pedido)"],
    ] as const) {
      const src = ler(arq);
      expect(src, arq).toContain(marca);
      expect(src, arq).toMatch(/status: 403/);
      expect(src, arq).toMatch(/Não autorizado|naoAutorizado/);
    }
  });
});

describe("toda gravação confirma por toast", () => {
  it("importar a NF: toast com a nota e quantos itens já vieram com produto", () => {
    const src = ler(IMPORTAR);
    expect(src).toContain('import { toast } from "@/components/ui/avisos";');
    expect(src).toMatch(/toast\(`NF \$\{j\.nota\.numero\}/);
    // o erro de validação continua NA TELA (não vira toast)
    expect(src).toContain('role="alert"');
  });

  it("conciliação: rascunho e lançamento viram toast; a tela fica só com o erro", () => {
    const src = ler(CONCILIACAO);
    expect(src).toContain('import { toast } from "@/components/ui/avisos";');
    expect(src).toMatch(/toast\(acao === "salvar"/);
    expect(src).toMatch(/Nota lançada: entrada no estoque e conta a pagar criadas\./);
    expect(src).not.toMatch(/setMsg\(\{ tipo: "ok"/);
  });

  it("o painel do pedido já confirmava por toast — e continua, com confirmação antes do que desfaz", () => {
    const src = ler(PAINEL);
    expect(src).toContain('import { confirmar, toast } from "@/components/ui/avisos";');
    expect(src).toMatch(/await confirmar\(\{/);
  });
});

describe("o vínculo nota↔estoque↔conta a pagar não tem porta de saída", () => {
  it("nenhuma rota apaga a nota, o movimento de estoque ou a conta a pagar", () => {
    for (const arq of [ROTA_NOTAS, ROTA_LANCAR]) {
      expect(ler(arq), arq).not.toMatch(/export async function (DELETE|PUT|PATCH)/);
    }
    // o rascunho tem PUT (é rascunho), mas fecha quando a nota é lançada
    expect(ler(ROTA_RASCUNHO)).toMatch(/export async function PUT/);
    expect(ler(ROTA_RASCUNHO)).not.toMatch(/export async function DELETE/);
    expect(ler("lib/compras/notas.ts")).toContain('throw new ErroNota("Nota já lançada: os vínculos não mudam mais.", 409)');
    // o único DELETE do fluxo desfaz o VÍNCULO com o pedido (reversível, e vai para o histórico)
    const conc = ler(ROTA_VINCULOS);
    expect(conc).toMatch(/export async function DELETE/);
    expect(conc).toContain("desvincularNota");
    expect(conc).not.toMatch(/notaCompra\.delete|movimentacaoEstoque\.delete|contaPagar\.delete/);
  });

  it("lançar duas vezes é recusado (o estoque e as contas não dobram)", () => {
    expect(ler("lib/compras/notas.ts")).toMatch(/já foi lançada/i);
  });

  it("a nota lançada entra no estoque e no financeiro na MESMA transação", () => {
    const src = ler("lib/compras/notas.ts");
    expect(src).toMatch(/\$transaction/);
    expect(src).toMatch(/movimentar\(/);
    expect(src).toMatch(/contaPagar/);
  });

  it("desvincular nota de pedido é o único desfazer, e pede confirmação antes", () => {
    const src = ler(PAINEL);
    expect(src).toMatch(/Desvincular/);
    expect(src).toMatch(/perigo: true/);
  });
});

describe("a sugestão do pedido avulso", () => {
  it("a faixa usa as regras puras e a rota própria (nada de SQL na tela)", () => {
    const src = ler(SUGESTOES);
    expect(src).toContain('from "@/lib/compras/sugestao-compra"');
    expect(src).toContain('fetch("/api/compras/sugestoes"');
    expect(src).not.toContain("prisma");
  });

  it("sugere, não preenche: cada produto é um botão, e dá para dispensar a faixa", () => {
    const src = ler(SUGESTOES);
    expect(src).toContain("data-usar-sugestao-compra");
    expect(src).toContain("data-dispensar-sugestoes-compra");
    expect(src).toMatch(/onUsar\(s\)/);
  });

  it("a faixa só é buscada no pedido avulso NOVO (não ao editar, nem na OS/orçamento)", () => {
    expect(ler(EDITOR)).toContain("useSugestoesCompra(!editando && ehAvulso)");
  });

  it("falhar na sugestão não atrapalha o pedido (a lista volta vazia)", () => {
    const src = ler(SUGESTOES);
    expect(src).toMatch(/\.catch\(\(\) => \{ if \(vivo\) setItens\(VAZIO\); \}\)/);
  });

  it("o que a sugestão coloca na linha continua editável (quantidade e valor são campos)", () => {
    const src = ler(EDITOR);
    expect(src).toMatch(/function usarSugestao/);
    expect(src).toMatch(/quantidade: sg\.faltam > 0/);
    expect(src).toMatch(/valorEstimado: sg\.valorUnitario == null \? "" :/);
  });
});

describe("cadastro inline e editar no contexto nos seletores", () => {
  it("produto e fornecedor do pedido abrem o cadastro rápido e o lápis de editar", () => {
    const src = ler(EDITOR);
    expect(src).toContain('from "@/components/cadastros/seletor-cadastro"');
    const seletores = [...src.matchAll(/<SeletorCadastro entidade="(produtos|fornecedores)"[^>]*>/g)];
    expect(seletores).toHaveLength(2);
    for (const [tag, entidade] of seletores) expect(tag, entidade).toContain(" editavel ");
  });

  it("a conciliação cria o produto na hora, no contexto da linha da nota", () => {
    expect(ler(CONCILIACAO)).toContain("data-criar-novo");
  });
});
