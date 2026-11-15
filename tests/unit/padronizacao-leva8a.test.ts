/**
 * Leva 8A — Financeiro (pagar e receber): guardas de FONTE.
 *
 * O que não pode voltar com um "refactor distraído":
 *  - o que mexe em dinheiro (registrar pagamento, editar, cancelar, criar conta, criar cobrança) só
 *    aparece para quem tem a permissão — na ficha, no ⋮ da lista e na própria rota da tela;
 *  - quando o servidor recusa, a tela NÃO muda: o cancelamento lê a resposta antes de atualizar;
 *  - toda gravação confirma por toast; o erro de validação fica na tela;
 *  - ⓘ no título das telas desta leva, e nenhuma instrução solta em parágrafo;
 *  - conta é razão: nenhuma tela ou rota apaga conta ou pagamento — cancelar deixa a conta no
 *    histórico, e o que foi pago continua registrado;
 *  - os seletores de fornecedor, categoria e centro de custo criam e editam no contexto.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

const INDICE = "app/(dashboard)/financeiro/page.tsx";
const FLUXO = "app/(dashboard)/financeiro/fluxo-caixa/page.tsx";
const FICHA = "app/(dashboard)/financeiro/contas-pagar/[id]/page.tsx";
const EDITAR = "app/(dashboard)/financeiro/contas-pagar/[id]/editar/page.tsx";
const NOVA = "app/(dashboard)/financeiro/contas-pagar/nova/page.tsx";
const COBRANCA = "app/(dashboard)/financeiro/contas-receber/nova/page.tsx";
const TELAS = [INDICE, FLUXO, FICHA, EDITAR, NOVA, COBRANCA];

const ACOES = "components/financeiro/conta-pagar-acoes.tsx";
const FORM = "components/financeiro/conta-pagar-form.tsx";
const COBRANCA_FORM = "components/financeiro/cobranca-form.tsx";

const ROTA_CONTAS = "app/api/contas-pagar/route.ts";
const ROTA_CONTA = "app/api/contas-pagar/[id]/route.ts";
const ROTA_PAGAMENTOS = "app/api/contas-pagar/[id]/pagamentos/route.ts";
const ROTA_RECEBER = "app/api/contas-receber/route.ts";

describe("o ⓘ e o vocabulário", () => {
  it("as seis telas explicam no ⓘ, não em parágrafo de instrução", () => {
    for (const arq of TELAS) {
      const src = ler(arq);
      expect(src, arq).toMatch(/^const AJUDA =/m);
      expect(src, arq).toMatch(/<Dica texto=\{AJUDA\}|dica=\{AJUDA\}/);
    }
  });

  it("o ⓘ da ficha conta a regra do dinheiro: parcial é aceito e conta não se apaga", () => {
    const ajuda = ler(FICHA).match(/^const AJUDA = "(.*)";$/m)![1];
    expect(ajuda).toMatch(/parcial/i);
    expect(ajuda).toMatch(/não se apaga/i);
    expect(ajuda).toMatch(/cancel/i);
  });

  it("nenhuma tela desta leva usa emoji nem plural abreviado", () => {
    const abreviado = /(conta|pagamento|parcela|cobrança|fornecedor|boleto)\((s|ns|es|is)\)/i;
    for (const arq of [...TELAS, ACOES, FORM, COBRANCA_FORM]) {
      const src = ler(arq);
      expect(src, arq).not.toMatch(abreviado);
      expect(src, arq).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u);
    }
  });
});

describe("prioridade 1: o que mexe em dinheiro só aparece para quem pode", () => {
  it("a ficha e o ⋮ da lista escondem pagar, editar e cancelar sem Financeiro › fluxo de caixa", () => {
    const src = ler(ACOES);
    expect(src).toContain('import { usePermissoes } from "@/components/providers/permissoes-provider";');
    expect(src).toContain('const podeMexer = usePermissoes().pode("financeiro", "fluxoCaixa");');
    // os três itens do ⋮ e os três botões da ficha, todos atrás da permissão
    expect(src.match(/\{podeMexer &&/g) ?? []).toHaveLength(6);
    // histórico e "ver detalhes" são leitura: continuam para quem só visualiza
    expect(src).toMatch(/<ItemMenu icone=\{Eye\}/);
    expect(src).toMatch(/data-historico-pagamentos/);
  });

  it("o botão de criar conta na lista também depende da permissão (e não leva a um beco sem saída)", () => {
    const src = ler("components/financeiro/contas-pagar-view.tsx");
    expect(src).toMatch(/\{podeLote && \(\s*<Link href="\/financeiro\/contas-pagar\/nova"/);
    expect(src).toContain("data-nova-conta");
    expect(src).toContain("Nova conta"); // caixa de frase, como o resto
  });

  it("criar conta, editar conta e criar cobrança barram na própria rota da tela", () => {
    expect(ler(NOVA)).toContain('if (!pode(u.permissoes, "financeiro", "fluxoCaixa", u.role)) redirect("/sem-permissao");');
    expect(ler(EDITAR)).toContain('if (!pode(u.permissoes, "financeiro", "fluxoCaixa", u.role)) redirect("/sem-permissao");');
    expect(ler(COBRANCA)).toContain('if (!pode(u.permissoes, "financeiro", "contasReceber", u.role)) redirect("/sem-permissao");');
  });

  it("cada rota de dinheiro exige a mesma permissão que a tela", () => {
    for (const [arq, marca] of [
      [ROTA_CONTAS, 'exigirPermissao("financeiro", "fluxoCaixa")'],
      [ROTA_CONTA, 'exigirPermissao("financeiro", "fluxoCaixa")'],
      [ROTA_PAGAMENTOS, 'exigirPermissao("financeiro", "fluxoCaixa")'],
      [ROTA_RECEBER, 'exigirPermissao("financeiro", "contasReceber")'],
    ] as const) {
      expect(ler(arq), arq).toContain(marca);
    }
  });
});

describe("quando o servidor recusa, a tela não muda", () => {
  it("cancelar lê a resposta antes de atualizar a tela (403 não vira refresh)", () => {
    const src = ler(ACOES);
    const cancelar = src.slice(src.indexOf("async function cancelar"), src.indexOf("return (\n    <>"));
    expect(cancelar).toMatch(/if \(!res\.ok\)/);
    // o refresh vem DEPOIS do if, nunca antes
    expect(cancelar.indexOf("if (!res.ok)")).toBeLessThan(cancelar.indexOf("router.refresh()"));
    expect(cancelar).toMatch(/toast\(d\.erro \?\? "Não foi possível cancelar a conta\.", "erro"\)/);
  });

  it("o pagamento mostra o erro na tela e não confirma nada", () => {
    const src = ler(ACOES);
    expect(src).toMatch(/if \(!res\.ok\) \{ const e = await res\.json\(\)[^;]*; setErro\(/);
  });
});

describe("toda gravação confirma por toast", () => {
  it("pagamento: toast com o valor e o saldo que fica", () => {
    const src = ler(ACOES);
    expect(src).toContain('import { confirmar, toast } from "@/components/ui/avisos";');
    expect(src).toMatch(/Pagamento de \$\{formatarMoeda\(valorNum\)\} registrado\./);
    expect(src).toMatch(/Conta quitada\./);
  });

  it("cancelar, conta nova/editada e cobrança nova também confirmam por toast", () => {
    expect(ler(ACOES)).toMatch(/toast\(`Conta \$\{conta\.numero\} cancelada\.`\)/);
    expect(ler(FORM)).toMatch(/toast\(salva\?\.numero \? `Conta \$\{salva\.numero\} \$\{fim\}\.`/);
    expect(ler(COBRANCA_FORM)).toMatch(/toast\(parcelado \? "Cobrança criada em parcelas\." : "Cobrança criada\."\)/);
  });
});

describe("conta é razão: não há porta de saída", () => {
  it("cancelar não apaga: a rota faz update de status, e nenhuma rota tem DELETE de pagamento", () => {
    const conta = ler(ROTA_CONTA);
    expect(conta).toMatch(/data: \{ status: "CANCELADO" \}/);
    expect(conta).not.toMatch(/contaPagar\.delete/);
    const pag = ler(ROTA_PAGAMENTOS);
    expect(pag).not.toMatch(/export async function (DELETE|PUT|PATCH)/);
    expect(pag).not.toMatch(/pagamentoContaPagar\.delete/);
  });

  it("nenhuma tela desta leva oferece excluir conta ou pagamento", () => {
    for (const arq of [FICHA, ACOES, FORM]) {
      const src = ler(arq);
      expect(src, arq).not.toMatch(/Excluir (conta|pagamento|lançamento)/i);
      expect(src, arq).not.toMatch(/\bapagar\b/i);
    }
    // o botão perigoso da ficha é "Cancelar conta", e ele diz o que acontece
    expect(ler(ACOES)).toMatch(/A conta fica no histórico como cancelada/);
  });

  it("a ficha mostra os pagamentos já feitos (é o histórico que não se perde)", () => {
    const src = ler(FICHA);
    expect(src).toContain("data-pagamento={p.id}");
    expect(src).toMatch(/Pagamentos · \{formatarMoeda\(Number\(conta\.valorPago\)\)\} pagos/);
  });
});

describe("cadastro inline e editar no contexto", () => {
  it("fornecedor, categoria e centro de custo abrem o cadastro rápido e o lápis", () => {
    const src = ler(FORM);
    const seletores = [...src.matchAll(/<SeletorCadastro entidade="(fornecedores|categorias-financeiras|centros-custo)"[^>]*>/g)];
    expect(seletores).toHaveLength(3);
    for (const [tag, entidade] of seletores) expect(tag, entidade).toContain(" editavel ");
  });

  it("a cobrança nova também edita no contexto (categoria, conta bancária, centro de custo)", () => {
    const src = ler(COBRANCA_FORM);
    const seletores = [...src.matchAll(/<SeletorCadastro entidade="(categorias-financeiras|contas-bancarias|centros-custo)"[^>]*>/g)];
    expect(seletores).toHaveLength(3);
    for (const [tag, entidade] of seletores) expect(tag, entidade).toContain(" editavel ");
  });
});

describe("o ⓘ do card não fica por cima do ícone do card", () => {
  it("com ⓘ, o ícone do card abre espaço para ele (nos dois estados do card)", () => {
    // O ⓘ é posicionado no canto (absolute top-1.5 right-2); sem a margem, os dois se sobrepõem.
    // O estado "ativo" (X) já reservava o espaço — faltava o estado normal.
    const src = ler("components/listagem/periodo-cards.tsx");
    const linha = src.split("\n").find((l) => l.includes("ativo ?") && l.includes("<Icone"))!;
    expect(linha).toContain('dica && "mr-5"');
    expect(linha.match(/dica && "mr-5"/g)).toHaveLength(2);
    expect(src).toContain('<span className="absolute top-1.5 right-2">');
  });
});

describe("os números na cara da casa", () => {
  it("valor da conta e do pagamento usam os tokens PLANILHA", () => {
    expect(ler(FORM)).toContain("className={PLANILHA.numero}");
    expect(ler(FICHA)).toContain("PLANILHA.numero");
  });
});
