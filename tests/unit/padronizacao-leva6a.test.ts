/**
 * Leva 6A — Contratos: as guardas de FONTE do que não dá para montar no DOM.
 *
 *  - as páginas do servidor (`/contratos/novo`, `/contratos/[id]/editar`, `/contratos/reajustes`)
 *    checam permissão ANTES de montar o formulário — a pessoa não preenche cinco abas para tomar 403;
 *  - o ⓘ de cada tela existe (a instrução não voltou para o parágrafo acima da lista);
 *  - os seletores do formulário são os da casa, com cadastro rápido e editar no contexto — nenhum
 *    select nativo de responsável técnico, tipo de OS ou responsável da recorrência;
 *  - as tabelas próprias saíram: lista e reajustes na TabelaPro, prévia da recorrência na planilha;
 *  - o relatório gera OS só com a permissão que a rota exige.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../..");
const fonte = (p: string) => fs.readFileSync(path.join(RAIZ, p), "utf8");

const NOVO = "app/(dashboard)/contratos/novo/page.tsx";
const EDITAR = "app/(dashboard)/contratos/[id]/editar/page.tsx";
const REAJ_PAG = "app/(dashboard)/contratos/reajustes/page.tsx";
const LISTA = "components/contratos/contratos-lista-client.tsx";
const REAJ = "components/contratos/reajustes-view.tsx";
const REL = "components/contratos/relatorio-contratos-client.tsx";
const FORM = "components/forms/contrato-form.tsx";
const REC = "components/forms/recorrencia-locais.tsx";

describe("Leva 6A — a permissão é checada antes de a tela abrir", () => {
  it("/contratos/novo exige Contratos › criar (a mesma do POST)", () => {
    const f = fonte(NOVO);
    expect(f).toMatch(/pode\(session!\.user!\.permissoes, "contratos", "criar", session!\.user!\.role\)/);
    expect(f).toMatch(/redirect\("\/sem-permissao"\)/);
  });

  it("/contratos/[id]/editar abre em somente leitura para quem só visualiza (e fecha para quem não vê)", () => {
    const f = fonte(EDITAR);
    expect(f).toMatch(/const podeEditar = pode\(session!\.user!\.permissoes, "contratos", "editar"/);
    expect(f).toMatch(/const podeVer = podeEditar \|\| pode\(session!\.user!\.permissoes, "contratos", "visualizar"/);
    expect(f).toMatch(/if \(!podeVer\) redirect\("\/sem-permissao"\)/);
    expect(f).toMatch(/somenteLeitura=\{!podeEditar\}/);
  });

  it("/contratos/reajustes segue sendo de quem edita contrato", () => {
    expect(fonte(REAJ_PAG)).toMatch(/pode\(session!\.user!\.permissoes, "contratos", "editar"/);
  });

  it("o formulário em somente leitura desabilita os campos e esconde o que grava", () => {
    const f = fonte(FORM);
    expect(f).toMatch(/<fieldset disabled=\{somenteLeitura\}/);
    expect(f).toMatch(/somenteLeitura \? \(\s*\n?\s*<div className="flex items-center gap-3 flex-wrap">/);
    expect(f).toMatch(/<SomenteLeitura permissao="Contratos › editar" \/>/);
    expect(f).toMatch(/\{isEditing && !somenteLeitura \? \(/);
  });

  it("os botões que gravam checam permissão na lista, no relatório e nos reajustes", () => {
    expect(fonte(LISTA)).toMatch(/const podeCriar = pode\("contratos", "criar"\)/);
    // a rota de gerar OS aceita Ordens › criar OU Contratos › editar: a tela usa a mesma regra
    expect(fonte(REL)).toMatch(/const podeGerar = pode\("ordens", "criar"\) \|\| pode\("contratos", "editar"\)/);
    expect(fonte(REAJ)).toMatch(/const podeDecidir = pode\("contratos", "editar"\)/);
  });
});

describe("Leva 6A — a instrução fica no ⓘ do título", () => {
  it("lista, relatório e reajustes têm o ⓘ, e o texto não voltou para um parágrafo", () => {
    expect(fonte(LISTA)).toMatch(/<Dica texto=\{AJUDA\} rotulo="Contratos" lado="direita" \/>/);
    expect(fonte(REL)).toMatch(/<Dica texto=\{AJUDA\} rotulo="Relatório de manutenções" lado="direita" \/>/);
    expect(fonte(REAJ)).toMatch(/<Dica rotulo="Reajustes a aplicar"/);
    for (const p of [LISTA, REL]) {
      expect(fonte(p), `${p}: o AJUDA é uma constante, não um parágrafo na tela`).toMatch(/^const AJUDA = "/m);
    }
  });
});

describe("Leva 6A — seletores e tabelas são os componentes da casa", () => {
  it("nenhum select nativo sobrou nos seletores de cadastro do formulário", () => {
    const f = fonte(FORM);
    expect(f).not.toMatch(/<Select \{\.\.\.register\("responsavelTecnicoId"\)\}/);
    expect(f).toMatch(/entidade=\{RESPONSAVEL_TECNICO\.entidade\}/);
    expect(f).toMatch(/edicao=\{RESPONSAVEL_TECNICO\.edicao\(/);
    expect(f).toMatch(/edicao=\{CLIENTE\.edicao\(\)\}/);

    const r = fonte(REC);
    expect(r).not.toMatch(/<Select value=\{c\.tipoOsId\}/);
    expect(r).not.toMatch(/<Select value=\{c\.tecnicoId\}/);
    expect(r).toMatch(/entidade=\{TIPO_OS\.entidade\}/);
    expect(r).toMatch(/entidade=\{TECNICO\.entidade\}/);
    expect(r).toMatch(/edicao=\{c\.tipoOsId \? TIPO_OS\.edicao\(/);
    expect(r).toMatch(/edicao=\{c\.tecnicoId \? COLABORADOR\.edicao\(/);
    // o técnico novo nasce habilitado no tipo de OS já escolhido (senão sairia da própria lista)
    expect(r).toMatch(/TECNICO\.criar\(v, c\.tipoOsId \|\| undefined\)/);
    // a frequência continua um select: é escolha de uma lista fixa, não cadastro
    expect(r).toMatch(/<Select value=\{c\.frequencia\}/);
  });

  it("as tabelas próprias saíram: TabelaPro nas listas, planilha da casa na prévia", () => {
    expect(fonte(LISTA)).toMatch(/<TabelaPro\n?\s+tela="contratos"/);
    expect(fonte(REAJ)).toMatch(/tela="contratos-reajustes"/);
    for (const p of [LISTA, REAJ]) {
      expect(fonte(p), `${p}: nenhum <thead> à mão`).not.toMatch(/<thead>/);
    }
    const r = fonte(REC);
    expect(r).toMatch(/className=\{PLANILHA\.tabela\}/);
    expect(r).not.toMatch(/font-semibold text-ink-muted text-xs uppercase/);
  });

  it("a lista vazia e o contador usam o padrão (sem 'contrato(s)')", () => {
    expect(fonte(LISTA)).toMatch(/<ListaVazia mensagem="Nenhum contrato encontrado"/);
    expect(fonte(REL)).toMatch(/<ListaVazia mensagem="Nenhum contrato a atender neste mês/);
    for (const p of [LISTA, REL, REAJ]) {
      expect(fonte(p), `${p}: plural escrito, não "(s)"`).not.toMatch(/contrato\(s\)/);
    }
  });
});
