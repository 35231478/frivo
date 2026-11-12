/**
 * NFS-e PR3 — notas emitidas: o SQL de produção rodado de verdade num PostgreSQL, numa transação só
 * (como o `prisma db execute`), TRÊS vezes, num schema descartável com as tabelas referenciadas como
 * estão HOJE (só as colunas usadas): tabelas novas, CHECKs (status/origem/ambiente/valores/tipo de
 * evento), FKs (apagar empresa leva as notas; apagar medição/OS/conta/usuário solta o vínculo; cliente
 * com nota não apaga), plugnotas_id único, nada mexido nas tabelas existentes; 2ª e 3ª rodadas: nada muda.
 *   PG_TESTE_URL="postgresql://root@localhost/postgres?host=/var/run/postgresql" npx vitest run tests/unit/sql-nfse-notas
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";

const URL = process.env.PG_TESTE_URL;
const ARQUIVO = path.resolve(__dirname, "../../prisma/sql/2026-11-08_nfse_notas.sql");
const SCHEMA = `teste_sql_nfse_notas_${process.pid}`;

function psql(args: string[]) {
  return execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-At", ...args], {
    env: { ...process.env, PGOPTIONS: `--search_path=${SCHEMA} --client_min_messages=warning` },
    encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const sql = (q: string) => psql(["-c", q]);
const rodar = () => psql(["--single-transaction", "-f", ARQUIVO]);
const falha = (q: string) => { try { sql(q); return "gravou"; } catch (e) { return String((e as { stderr?: string }).stderr ?? e); } };
const nota = (id: string, extra = "") =>
  `INSERT INTO notas_fiscais (id, empresa_id, cliente_id, origem, ambiente, grupo, valor_servicos, discriminacao, tomador_cpf_cnpj, tomador_nome${extra ? ", " + extra.split("=")[0] : ""})
   VALUES ('${id}', 'e1', 'c1', 'MEDICAO', 'HOMOLOGACAO', 'g', 100, 'x', '11222333000181', 'Cliente'${extra ? ", " + extra.split("=").slice(1).join("=") : ""})`;

describe.skipIf(!URL)("SQL de produção: notas fiscais emitidas (PostgreSQL real)", () => {
  beforeAll(() => {
    execFileSync("psql", [URL!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`]);
    sql(`
      CREATE TABLE "empresas" ("id" TEXT PRIMARY KEY, "nome" TEXT NOT NULL);
      CREATE TABLE "usuarios" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "clientes" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "medicoes" ("id" TEXT PRIMARY KEY, "numero" TEXT);
      CREATE TABLE "medicao_itens" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "ordens_servico" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "contas_receber" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "servicos" ("id" TEXT PRIMARY KEY);
      INSERT INTO empresas VALUES ('e1', 'Clima Total'); INSERT INTO usuarios VALUES ('u1'); INSERT INTO clientes VALUES ('c1');
      INSERT INTO medicoes VALUES ('m1', 'MED-1'); INSERT INTO medicao_itens VALUES ('i1'); INSERT INTO ordens_servico VALUES ('os1');
      INSERT INTO contas_receber VALUES ('cr1'); INSERT INTO servicos VALUES ('s1');
    `);
    rodar();
  });
  afterAll(() => { if (!process.env.MANTER) execFileSync("psql", [URL!, "-q", "-c", `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`]); });

  const colunas = (t: string) => sql(`SELECT string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || COALESCE(column_default, '-'), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${t}'`);

  it("tabelas novas com as colunas, tipos, nulos e padrões do schema do Prisma", () => {
    expect(colunas("notas_fiscais").split(",")).toEqual([
      "id:text:NO:-", "empresa_id:text:NO:-", "medicao_id:text:YES:-", "ordem_servico_id:text:YES:-", "cliente_id:text:NO:-",
      "conta_receber_id:text:YES:-", "origem:text:NO:-", "ambiente:text:NO:-", "status:text:NO:'ENVIANDO'::text", "grupo:text:NO:-",
      "codigo_lc116:character varying:YES:-", "codigo_tributacao:text:YES:-", "aliquota_iss:numeric:YES:-", "iss_retido:boolean:NO:false",
      "valor_servicos:numeric:NO:-", "valor_desconto:numeric:NO:0", "discriminacao:text:NO:-", "tomador_cpf_cnpj:character varying:NO:-",
      "tomador_nome:text:NO:-", "plugnotas_id:text:YES:-", "protocolo:text:YES:-", "numero:text:YES:-", "codigo_verificacao:text:YES:-",
      "autorizada_em:timestamp without time zone:YES:-", "pdf_url:text:YES:-", "xml_url:text:YES:-", "motivo:text:YES:-",
      "consultas:integer:NO:0", "ultima_consulta_em:timestamp without time zone:YES:-", "emitida_por_id:text:YES:-",
      "criado_em:timestamp without time zone:NO:CURRENT_TIMESTAMP", "atualizado_em:timestamp without time zone:NO:CURRENT_TIMESTAMP",
    ]);
    expect(colunas("notas_fiscais_itens").split(",")).toEqual([
      "id:text:NO:-", "nota_id:text:NO:-", "medicao_item_id:text:YES:-", "servico_id:text:YES:-", "descricao:text:NO:-",
      "quantidade:numeric:NO:-", "valor_total:numeric:NO:-", "valor_desconto:numeric:NO:0",
    ]);
    expect(colunas("notas_fiscais_eventos").split(",")).toEqual([
      "id:text:NO:-", "nota_id:text:NO:-", "usuario_id:text:YES:-", "tipo:text:NO:-", "status:text:YES:-", "mensagem:text:YES:-",
      "criado_em:timestamp without time zone:NO:CURRENT_TIMESTAMP",
    ]);
    // nenhuma tabela existente ganhou coluna (empresas: id, nome; clientes: id; medicoes: id, numero)
    expect(sql(`SELECT count(*) FROM information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name IN ('medicoes', 'clientes', 'empresas')`)).toBe("5");
  });

  it("CHECKs: status, origem, ambiente, valores (> 0, desconto entre 0 e o valor) e tipo de evento", () => {
    expect(falha(nota("n1"))).toBe("gravou");
    expect(sql(`SELECT status || '|' || valor_desconto || '|' || iss_retido || '|' || consultas FROM notas_fiscais WHERE id = 'n1'`)).toBe("ENVIANDO|0.00|false|0");
    for (const s of ["PROCESSANDO", "CONCLUIDO", "REJEITADO", "CANCELADO", "INTERROMPIDO"]) expect(falha(`UPDATE notas_fiscais SET status = '${s}' WHERE id = 'n1'`)).toBe("gravou");
    expect(falha(`UPDATE notas_fiscais SET status = 'AUTORIZADA' WHERE id = 'n1'`)).toContain("notas_fiscais_status_check");
    expect(falha(`UPDATE notas_fiscais SET origem = 'CONTRATO' WHERE id = 'n1'`)).toContain("notas_fiscais_origem_check");
    expect(falha(`UPDATE notas_fiscais SET origem = 'OS' WHERE id = 'n1'`)).toBe("gravou");
    expect(falha(`UPDATE notas_fiscais SET ambiente = 'TESTE' WHERE id = 'n1'`)).toContain("notas_fiscais_ambiente_check");
    expect(falha(`UPDATE notas_fiscais SET valor_servicos = 0 WHERE id = 'n1'`)).toContain("notas_fiscais_valores_check");
    expect(falha(`UPDATE notas_fiscais SET valor_desconto = -1 WHERE id = 'n1'`)).toContain("notas_fiscais_valores_check");
    expect(falha(`UPDATE notas_fiscais SET valor_desconto = 100.01 WHERE id = 'n1'`)).toContain("notas_fiscais_valores_check");
    expect(falha(`UPDATE notas_fiscais SET valor_desconto = 100 WHERE id = 'n1'`)).toBe("gravou");
    expect(falha(`INSERT INTO notas_fiscais_eventos (id, nota_id, tipo) VALUES ('ev1', 'n1', 'ENVIO')`)).toBe("gravou");
    for (const t of ["CONSULTA", "STATUS", "ERRO"]) expect(falha(`INSERT INTO notas_fiscais_eventos (id, nota_id, tipo) VALUES ('ev-${t}', 'n1', '${t}')`)).toBe("gravou");
    expect(falha(`INSERT INTO notas_fiscais_eventos (id, nota_id, tipo) VALUES ('ev2', 'n1', 'OUTRO')`)).toContain("notas_fiscais_eventos_tipo_check");
  });

  it("FKs: empresa/cliente/medição/OS/conta/usuário/item/serviço precisam existir; plugnotas_id é único (vários nulos valem)", () => {
    expect(falha(nota("n2", "medicao_id='mX'"))).toContain("notas_fiscais_medicao_id_fkey");
    expect(falha(nota("n3", "ordem_servico_id='osX'"))).toContain("notas_fiscais_ordem_servico_id_fkey");
    expect(falha(nota("n4", "conta_receber_id='crX'"))).toContain("notas_fiscais_conta_receber_id_fkey");
    expect(falha(nota("n5", "emitida_por_id='uX'"))).toContain("notas_fiscais_emitida_por_id_fkey");
    expect(falha(`INSERT INTO notas_fiscais (id, empresa_id, cliente_id, origem, ambiente, grupo, valor_servicos, discriminacao, tomador_cpf_cnpj, tomador_nome) VALUES ('n6', 'eX', 'c1', 'OS', 'HOMOLOGACAO', 'g', 1, 'x', '1', 'c')`)).toContain("notas_fiscais_empresa_id_fkey");
    expect(falha(`INSERT INTO notas_fiscais (id, empresa_id, cliente_id, origem, ambiente, grupo, valor_servicos, discriminacao, tomador_cpf_cnpj, tomador_nome) VALUES ('n7', 'e1', 'cX', 'OS', 'HOMOLOGACAO', 'g', 1, 'x', '1', 'c')`)).toContain("notas_fiscais_cliente_id_fkey");
    expect(falha(`INSERT INTO notas_fiscais_itens (id, nota_id, descricao, quantidade, valor_total) VALUES ('it0', 'nX', 'd', 1, 1)`)).toContain("notas_fiscais_itens_nota_id_fkey");
    expect(falha(`INSERT INTO notas_fiscais_itens (id, nota_id, medicao_item_id, descricao, quantidade, valor_total) VALUES ('it0', 'n1', 'iX', 'd', 1, 1)`)).toContain("notas_fiscais_itens_medicao_item_id_fkey");
    expect(falha(`INSERT INTO notas_fiscais_itens (id, nota_id, servico_id, descricao, quantidade, valor_total) VALUES ('it0', 'n1', 'sX', 'd', 1, 1)`)).toContain("notas_fiscais_itens_servico_id_fkey");
    expect(falha(`INSERT INTO notas_fiscais_eventos (id, nota_id, usuario_id, tipo) VALUES ('evX', 'n1', 'uX', 'ENVIO')`)).toContain("notas_fiscais_eventos_usuario_id_fkey");
    expect(falha(`UPDATE notas_fiscais SET plugnotas_id = 'pn1' WHERE id = 'n1'`)).toBe("gravou");
    expect(falha(nota("n8", "plugnotas_id='pn1'"))).toContain("notas_fiscais_plugnotas_id_key");
    expect(falha(nota("n9"))).toBe("gravou");
    expect(falha(nota("n10"))).toBe("gravou");
  });

  it("apagar medição/OS/conta/usuário/item/serviço solta o vínculo; cliente com nota não apaga; empresa apagada leva tudo", () => {
    sql(`
      INSERT INTO medicoes VALUES ('m2', 'MED-2'); INSERT INTO ordens_servico VALUES ('os2'); INSERT INTO contas_receber VALUES ('cr2');
      INSERT INTO usuarios VALUES ('u2'); INSERT INTO medicao_itens VALUES ('i2'); INSERT INTO servicos VALUES ('s2');
    `);
    sql(nota("n20", "medicao_id, ordem_servico_id, conta_receber_id, emitida_por_id='m2', 'os2', 'cr2', 'u2'"));
    sql(`INSERT INTO notas_fiscais_itens (id, nota_id, medicao_item_id, servico_id, descricao, quantidade, valor_total) VALUES ('it20', 'n20', 'i2', 's2', 'd', 1, 100)`);
    sql(`INSERT INTO notas_fiscais_eventos (id, nota_id, usuario_id, tipo) VALUES ('ev20', 'n20', 'u2', 'STATUS')`);
    sql(`DELETE FROM medicoes WHERE id = 'm2'; DELETE FROM ordens_servico WHERE id = 'os2'; DELETE FROM contas_receber WHERE id = 'cr2';
         DELETE FROM usuarios WHERE id = 'u2'; DELETE FROM medicao_itens WHERE id = 'i2'; DELETE FROM servicos WHERE id = 's2';`);
    expect(sql(`SELECT concat_ws('|', COALESCE(medicao_id, 'null'), COALESCE(ordem_servico_id, 'null'), COALESCE(conta_receber_id, 'null'), COALESCE(emitida_por_id, 'null')) FROM notas_fiscais WHERE id = 'n20'`)).toBe("null|null|null|null");
    expect(sql(`SELECT concat_ws('|', COALESCE(medicao_item_id, 'null'), COALESCE(servico_id, 'null')) FROM notas_fiscais_itens WHERE id = 'it20'`)).toBe("null|null");
    expect(sql(`SELECT COALESCE(usuario_id, 'null') FROM notas_fiscais_eventos WHERE id = 'ev20'`)).toBe("null");
    expect(falha(`DELETE FROM clientes WHERE id = 'c1'`)).toContain("notas_fiscais_cliente_id_fkey");
    sql(`INSERT INTO empresas VALUES ('e9', 'Outra'); INSERT INTO clientes VALUES ('c9')`);
    sql(`INSERT INTO notas_fiscais (id, empresa_id, cliente_id, origem, ambiente, grupo, valor_servicos, discriminacao, tomador_cpf_cnpj, tomador_nome) VALUES ('n90', 'e9', 'c9', 'OS', 'HOMOLOGACAO', 'g', 1, 'x', '1', 'c')`);
    sql(`INSERT INTO notas_fiscais_itens (id, nota_id, descricao, quantidade, valor_total) VALUES ('it90', 'n90', 'd', 1, 1); INSERT INTO notas_fiscais_eventos (id, nota_id, tipo) VALUES ('ev90', 'n90', 'ENVIO')`);
    sql(`DELETE FROM empresas WHERE id = 'e9'`);
    expect(sql(`SELECT (SELECT count(*) FROM notas_fiscais WHERE id = 'n90') + (SELECT count(*) FROM notas_fiscais_itens WHERE id = 'it90') + (SELECT count(*) FROM notas_fiscais_eventos WHERE id = 'ev90')`)).toBe("0");
  });

  it("2ª e 3ª rodadas não mudam nada (dados ficam; nenhuma constraint ou índice em dobro)", () => {
    const contar = () => sql(`SELECT (SELECT count(*) FROM notas_fiscais) || '|' || (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = '${SCHEMA}' AND c.conrelid::regclass::text LIKE 'notas_fiscais%') || '|' || (SELECT count(*) FROM pg_indexes WHERE schemaname = '${SCHEMA}' AND tablename LIKE 'notas_fiscais%')`);
    const antes = contar();
    rodar();
    rodar();
    expect(contar()).toBe(antes);
    expect(antes.split("|").slice(1)).toEqual(["19", "12"]);
  });
});
