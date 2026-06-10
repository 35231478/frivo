/**
 * Seed avulso e idempotente — cria os 5 perfis de acesso padrão para TODAS as
 * empresas que ainda não os possuem. Seguro para rodar em banco já populado.
 *
 * Rodar com: npx ts-node --project tsconfig.seed.json prisma/seed-perfis.ts
 */
import { PrismaClient } from "@prisma/client";
import { PRESETS, CORES_PERFIL } from "../lib/permissoes";

const prisma = new PrismaClient();

const PERFIS = [
  { nome: "Administrador", tipo: "ADMINISTRADOR", descricao: "Acesso total ao sistema" },
  { nome: "Supervisor de Manutenção", tipo: "SUPERVISOR", descricao: "OS, clientes, equipes e relatórios" },
  { nome: "Financeiro", tipo: "FINANCEIRO", descricao: "Financeiro, contratos, orçamentos e clientes" },
  { nome: "Técnico de Campo", tipo: "TECNICO", descricao: "OS, equipamentos, calendário e veículos" },
  { nome: "Auxiliar Técnico", tipo: "AUXILIAR", descricao: "OS (visualizar), equipamentos e calendário" },
] as const;

async function main() {
  const empresas = await prisma.empresa.findMany({ select: { id: true, nome: true } });
  if (empresas.length === 0) { console.log("Nenhuma empresa encontrada."); return; }

  for (const empresa of empresas) {
    let criados = 0;
    for (const p of PERFIS) {
      const existe = await prisma.perfilAcesso.findFirst({
        where: { empresaId: empresa.id, nome: p.nome },
      });
      if (existe) continue;
      await prisma.perfilAcesso.create({
        data: {
          empresaId: empresa.id,
          nome: p.nome,
          descricao: p.descricao,
          tipo: p.tipo as any,
          cor: CORES_PERFIL[p.tipo] ?? "#8B5CF6",
          padraoSistema: true,
          permissoes: PRESETS[p.tipo] as any,
        },
      });
      criados++;
    }
    console.log(`[${empresa.nome}] ${criados} perfil(is) padrão criado(s).`);
  }
  console.log("\nSeed de perfis concluído.");
}

main()
  .catch((e) => { console.error("Erro:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
