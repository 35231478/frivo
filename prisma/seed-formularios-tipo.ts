/**
 * Backfill idempotente do módulo "Formulários por Tipo".
 *
 * 1) Garante, para TODAS as empresas, um TipoEquipamentoCustom para cada valor
 *    do antigo enum TipoEquipamento (ancorado por `chave_enum`). Preserva tipos
 *    criados manualmente (chave_enum NULL).
 * 2) Vincula cada equipamento ao TipoEquipamentoCustom correspondente ao seu
 *    enum `tipo`, populando o novo FK canônico `tipo_equipamento_id`.
 *
 * Seguro para rodar várias vezes (guardas WHERE NOT EXISTS / IS NULL).
 * Rodar com: npx ts-node --project tsconfig.seed.json prisma/seed-formularios-tipo.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Espelha LABELS_TIPO_EQUIPAMENTO (lib/utils.ts) — chave do enum → nome amigável.
const TIPOS: Array<[string, string]> = [
  ["AR_CONDICIONADO_SPLIT", "Ar-cond. Split"],
  ["AR_CONDICIONADO_JANELA", "Ar-cond. Janela"],
  ["AR_CONDICIONADO_CENTRAL", "Ar-cond. Central"],
  ["AR_CONDICIONADO_PORTATIL", "Ar-cond. Portátil"],
  ["CHILLER", "Chiller"],
  ["TORRE_RESFRIAMENTO", "Torre de Resfriamento"],
  ["CAMARA_FRIA", "Câmara Fria"],
  ["CAMARA_CLIMATIZADA", "Câmara Climatizada"],
  ["REFRIGERADOR_COMERCIAL", "Refrigerador Comercial"],
  ["CONGELADOR_COMERCIAL", "Congelador Comercial"],
  ["VRF", "VRF"],
  ["FANCOIL", "Fan Coil"],
  ["CONDENSADORA", "Condensadora"],
  ["EVAPORADORA", "Evaporadora"],
  ["OUTRO", "Outro"],
];

async function main() {
  // VALUES list ('CHAVE','Nome'),('CHAVE','Nome'),...
  const valuesSql = TIPOS.map(([chave, nome]) => {
    const safeNome = nome.replace(/'/g, "''");
    return `('${chave}','${safeNome}')`;
  }).join(",");

  // 1) Semeia tipos padrão (idempotente por empresa + chave_enum)
  const inserted = await prisma.$executeRawUnsafe(`
    INSERT INTO tipos_equipamento_custom (id, empresa_id, nome, chave_enum, ativo, criado_em)
    SELECT gen_random_uuid()::text, em.id, v.nome, v.chave, true, now()
    FROM empresas em
    CROSS JOIN (VALUES ${valuesSql}) AS v(chave, nome)
    WHERE NOT EXISTS (
      SELECT 1 FROM tipos_equipamento_custom t
      WHERE t.empresa_id = em.id AND t.chave_enum = v.chave
    )
  `);
  console.log(`Tipos de equipamento padrão criados: ${inserted}`);

  // 2) Vincula equipamentos sem FK ao tipo custom correspondente ao enum
  const linked = await prisma.$executeRawUnsafe(`
    UPDATE equipamentos e
    SET tipo_equipamento_id = t.id
    FROM tipos_equipamento_custom t
    WHERE t.empresa_id = e.empresa_id
      AND t.chave_enum = e.tipo::text
      AND e.tipo_equipamento_id IS NULL
  `);
  console.log(`Equipamentos vinculados ao tipo custom: ${linked}`);

  // Diagnóstico: equipamentos que ainda ficaram sem FK (não deveria ocorrer)
  const orfaos = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM equipamentos WHERE tipo_equipamento_id IS NULL`
  );
  console.log(`Equipamentos sem tipo_equipamento_id: ${orfaos[0]?.count ?? 0}`);
}

main()
  .then(() => console.log("Backfill concluído ✅"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
