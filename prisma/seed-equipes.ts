/**
 * Seed avulso e idempotente — insere Cargos e o template "Checklist Diário"
 * para TODAS as empresas que ainda não os possuem. Seguro para rodar em banco
 * já populado (guarda por count === 0 por empresa).
 *
 * Rodar com: npx ts-node --project tsconfig.seed.json prisma/seed-equipes.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CARGOS = [
  { nome: "Técnico de Refrigeração", descricao: "Manutenção e instalação de sistemas de refrigeração" },
  { nome: "Técnico de Ar Condicionado", descricao: "Manutenção e instalação de ar condicionado" },
  { nome: "Responsável Técnico", descricao: "Engenheiro responsável técnico (ART/CREA)" },
  { nome: "Motorista", descricao: "Condução de veículos da frota" },
  { nome: "Auxiliar Técnico", descricao: "Apoio às atividades técnicas em campo" },
  { nome: "Administrativo", descricao: "Atividades administrativas e de escritório" },
];

const ITENS_CHECKLIST: { categoria: string; descricao: string; tipo: "OK_NOK" | "NIVEL" | "TEXTO" | "FOTO"; opcoes: string[] }[] = [
  { categoria: "Motor", descricao: "Nível do óleo", tipo: "NIVEL", opcoes: ["OK", "Baixo", "Crítico"] },
  { categoria: "Motor", descricao: "Nível da água/arrefecimento", tipo: "NIVEL", opcoes: ["OK", "Baixo", "Crítico"] },
  { categoria: "Motor", descricao: "Nível do fluido de freio", tipo: "NIVEL", opcoes: ["OK", "Baixo", "Crítico"] },
  { categoria: "Motor", descricao: "Correia dentada", tipo: "NIVEL", opcoes: ["OK", "Verificar"] },
  { categoria: "Elétrica", descricao: "Bateria", tipo: "NIVEL", opcoes: ["OK", "Fraca", "Descarregada"] },
  { categoria: "Elétrica", descricao: "Luzes dianteiras", tipo: "NIVEL", opcoes: ["OK", "Com defeito"] },
  { categoria: "Elétrica", descricao: "Luzes traseiras", tipo: "NIVEL", opcoes: ["OK", "Com defeito"] },
  { categoria: "Elétrica", descricao: "Setas e pisca-alerta", tipo: "NIVEL", opcoes: ["OK", "Com defeito"] },
  { categoria: "Pneus e Carroceria", descricao: "Pneus dianteiros", tipo: "NIVEL", opcoes: ["OK", "Calibragem necessária", "Desgastado"] },
  { categoria: "Pneus e Carroceria", descricao: "Pneus traseiros", tipo: "NIVEL", opcoes: ["OK", "Calibragem necessária", "Desgastado"] },
  { categoria: "Pneus e Carroceria", descricao: "Estepe", tipo: "NIVEL", opcoes: ["OK", "Ausente", "Furado"] },
  { categoria: "Pneus e Carroceria", descricao: "Avarias visíveis", tipo: "TEXTO", opcoes: [] },
  { categoria: "Equipamentos", descricao: "Ferramentas completas", tipo: "OK_NOK", opcoes: ["Sim", "Não"] },
  { categoria: "Equipamentos", descricao: "EPIs no veículo", tipo: "OK_NOK", opcoes: ["Sim", "Não"] },
  { categoria: "Equipamentos", descricao: "Extintor", tipo: "NIVEL", opcoes: ["OK", "Vencido", "Ausente"] },
];

async function main() {
  const empresas = await prisma.empresa.findMany({ select: { id: true, nome: true } });
  if (empresas.length === 0) {
    console.log("Nenhuma empresa encontrada.");
    return;
  }

  for (const empresa of empresas) {
    // Cargos
    const totalCargos = await prisma.cargo.count({ where: { empresaId: empresa.id } });
    if (totalCargos === 0) {
      for (const c of CARGOS) await prisma.cargo.create({ data: { empresaId: empresa.id, ...c } });
      console.log(`[${empresa.nome}] ${CARGOS.length} cargos criados.`);
    } else {
      console.log(`[${empresa.nome}] cargos já existem (${totalCargos}) — ignorado.`);
    }

    // Checklist Diário
    const totalChecklists = await prisma.checklistTemplate.count({ where: { empresaId: empresa.id } });
    if (totalChecklists === 0) {
      await prisma.checklistTemplate.create({
        data: {
          empresaId: empresa.id,
          nome: "Checklist Diário",
          descricao: "Inspeção diária do veículo antes da saída",
          frequencia: "DIARIO",
          itens: { create: ITENS_CHECKLIST.map((it, idx) => ({ ...it, obrigatorio: it.tipo !== "TEXTO", ordem: idx })) },
        },
      });
      console.log(`[${empresa.nome}] Checklist Diário criado com ${ITENS_CHECKLIST.length} itens.`);
    } else {
      console.log(`[${empresa.nome}] checklists já existem (${totalChecklists}) — ignorado.`);
    }
  }

  console.log("\nSeed avulso concluído.");
}

main()
  .catch((e) => { console.error("Erro:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
