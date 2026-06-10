import {
  PrismaClient, Plano, Role, TipoPessoa, TipoTecnico,
  TipoContrato, StatusContrato, Periodicidade, StatusOS, Prioridade,
  TipoCampo, StatusAtividade, ResponsavelPrazo, CanalNotificacao,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { PRESETS, CORES_PERFIL } from "../lib/permissoes";

const prisma = new PrismaClient();

async function main() {
  console.log("Iniciando seed...");

  const empresa = await prisma.empresa.upsert({
    where: { cnpj: "12.345.678/0001-90" },
    update: {},
    create: {
      nome: "Clima Total Refrigeração Ltda",
      nomeFantasia: "Clima Total",
      cnpj: "12.345.678/0001-90",
      email: "contato@climatotal.com.br",
      telefone: "(11) 3333-4444",
      cidade: "São Paulo", estado: "SP", cep: "01310-100",
      plano: Plano.PROFISSIONAL,
    },
  });

  // Configuração padrão
  await prisma.configuracao.upsert({
    where: { empresaId: empresa.id },
    update: {},
    create: { empresaId: empresa.id },
  });

  const senhaHash = await bcrypt.hash("admin123", 12);
  const admin = await prisma.usuario.upsert({
    where: { email_empresaId: { email: "admin@climatotal.com.br", empresaId: empresa.id } },
    update: {},
    create: { empresaId: empresa.id, nome: "Administrador", email: "admin@climatotal.com.br", senha: senhaHash, role: Role.ADMIN },
  });

  const respTecnico = await prisma.tecnico.upsert({
    where: { cpf_empresaId: { cpf: "987.654.321-00", empresaId: empresa.id } },
    update: {},
    create: {
      empresaId: empresa.id, nome: "Eng. Roberto Mendes", cpf: "987.654.321-00",
      telefone: "(11) 97777-2222", tipo: TipoTecnico.RESPONSAVEL_TECNICO,
      crea: "5012345-D/SP", especialidades: ["Engenharia Mecânica", "Refrigeração Industrial"],
    },
  });

  const tecnico = await prisma.tecnico.upsert({
    where: { cpf_empresaId: { cpf: "123.456.789-00", empresaId: empresa.id } },
    update: {},
    create: {
      empresaId: empresa.id, nome: "Carlos Oliveira", cpf: "123.456.789-00",
      telefone: "(11) 98888-1111", tipo: TipoTecnico.TECNICO_CAMPO,
      especialidades: ["Split", "VRF", "Câmara Fria"],
    },
  });

  const cliente = await prisma.cliente.upsert({
    where: { cpfCnpj_empresaId: { cpfCnpj: "98.765.432/0001-10", empresaId: empresa.id } },
    update: {},
    create: {
      empresaId: empresa.id, tipoPessoa: TipoPessoa.JURIDICA,
      nome: "Supermercado Bom Preço Ltda", nomeFantasia: "Bom Preço",
      cpfCnpj: "98.765.432/0001-10", email: "manutencao@bompreco.com.br",
      telefone: "(11) 2222-3333", contato: "João Silva",
      cidade: "São Paulo", estado: "SP", segmento: "COMERCIO", origem: "INDICACAO",
      responsavelTecnicoId: respTecnico.id,
    },
  });

  const unidade = await prisma.unidade.upsert({
    where: { id: "seed-unidade-matriz" },
    update: {},
    create: {
      id: "seed-unidade-matriz", empresaId: empresa.id, clienteId: cliente.id,
      nome: "Matriz", principal: true,
      logradouro: "Av. Paulista", numero: "1000", bairro: "Bela Vista",
      cidade: "São Paulo", estado: "SP", cep: "01310-100",
    },
  });

  // ======== TIPOS DE OS ========
  const tiposOs = [
    { nome: "Manutenção Preventiva", descricao: "Manutenção programada periódica", cor: "#22c55e" },
    { nome: "Manutenção Corretiva", descricao: "Reparo de falhas e defeitos", cor: "#ef4444" },
    { nome: "Instalação", descricao: "Instalação de novos equipamentos", cor: "#3b82f6" },
    { nome: "Vistoria", descricao: "Inspeção técnica do equipamento", cor: "#8b5cf6" },
    { nome: "Limpeza", descricao: "Limpeza e higienização de equipamentos", cor: "#06b6d4" },
    { nome: "Higienização", descricao: "Higienização completa com produto químico", cor: "#14b8a6" },
  ];

  const tiposOsCriados: any[] = [];
  for (const t of tiposOs) {
    const tipo = await prisma.tipoOs.create({
      data: { empresaId: empresa.id, ...t },
    });
    tiposOsCriados.push(tipo);
  }
  console.log(`Tipos de OS criados: ${tiposOsCriados.length}`);

  // ======== FORMULÁRIO DE MANUTENÇÃO PREVENTIVA ========
  const formPreventiva = await prisma.formularioTemplate.create({
    data: {
      empresaId: empresa.id,
      nome: "Checklist Manutenção Preventiva",
      descricao: "Formulário padrão para manutenção preventiva de ar condicionado",
      tipoOsId: tiposOsCriados[0].id,
      campos: {
        create: [
          { label: "Situação encontrada", tipo: TipoCampo.TEXTO_LONGO, obrigatorio: true, ordem: 1 },
          { label: "Serviços realizados", tipo: TipoCampo.TEXTO_LONGO, obrigatorio: true, ordem: 2 },
          { label: "Pressão de baixa (psi)", tipo: TipoCampo.NUMERO, obrigatorio: true, ordem: 3 },
          { label: "Pressão de alta (psi)", tipo: TipoCampo.NUMERO, obrigatorio: true, ordem: 4 },
          { label: "Temperatura de saída (°C)", tipo: TipoCampo.NUMERO, obrigatorio: true, ordem: 5 },
          { label: "Vazamento identificado", tipo: TipoCampo.SIM_NAO, obrigatorio: true, ordem: 6 },
          { label: "Observações", tipo: TipoCampo.TEXTO_LONGO, obrigatorio: false, ordem: 7 },
          { label: "Foto do equipamento", tipo: TipoCampo.FOTO, obrigatorio: true, ordem: 8 },
        ],
      },
    },
  });
  console.log(`Formulário criado: ${formPreventiva.nome}`);

  // ======== CONTRATO ========
  const contrato = await prisma.contrato.upsert({
    where: { numero_empresaId: { numero: "CT-2024-001", empresaId: empresa.id } },
    update: {},
    create: {
      empresaId: empresa.id, clienteId: cliente.id, numero: "CT-2024-001",
      tipo: TipoContrato.MANUTENCAO_COMPLETA, status: StatusContrato.ATIVO,
      periodicidade: Periodicidade.MENSAL, valorMensal: 1200.0,
      dataInicio: new Date("2024-01-01"), dataFim: new Date("2024-12-31"),
      responsavelTecnicoId: respTecnico.id,
    },
  });

  // ======== OS EXEMPLO ========
  const os = await prisma.ordemServico.upsert({
    where: { numero_empresaId: { numero: "OS-2024-0001", empresaId: empresa.id } },
    update: {},
    create: {
      empresaId: empresa.id, numero: "OS-2024-0001",
      clienteId: cliente.id, unidadeId: unidade.id,
      contratoId: contrato.id, responsavelId: admin.id, criadoPorId: admin.id,
      prioridade: Prioridade.NORMAL, status: StatusOS.ABERTA,
      descricao: "Manutenção preventiva mensal — câmara fria do depósito.",
      previsaoConclusao: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  // Atividade da OS
  await prisma.atividadeOs.create({
    data: {
      empresaId: empresa.id, ordemServicoId: os.id,
      tipoOsId: tiposOsCriados[0].id, tecnicoId: tecnico.id,
      titulo: "Manutenção preventiva — câmara fria",
      status: StatusAtividade.AGENDADA,
      dataAgendada: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      duracaoMin: 120,
    },
  });

  // Histórico
  await prisma.osHistorico.create({
    data: {
      ordemServicoId: os.id, usuarioId: admin.id,
      acao: "OS criada", detalhes: `Ordem de serviço ${os.numero} criada.`,
    },
  });

  // Item de orçamento
  await prisma.osItemOrcamento.create({
    data: {
      ordemServicoId: os.id,
      descricao: "Mão de obra — manutenção preventiva",
      quantidade: 1, valorUnitario: 350, valorTotal: 350,
    },
  });

  console.log(`OS criada: ${os.numero}`);

  // ======== TIPOS DE EQUIPAMENTO ========
  const tiposEquip = [
    "Split", "Chiller", "VRF", "Fan Coil", "Torre de Resfriamento",
    "Condensadora", "Evaporadora", "Fancolete", "Cortina de Ar",
  ];
  for (const nome of tiposEquip) {
    await prisma.tipoEquipamentoCustom.create({ data: { empresaId: empresa.id, nome } });
  }
  console.log(`Tipos de equipamento criados: ${tiposEquip.length}`);

  // ======== SERVIÇOS ========
  const servicos = [
    { nome: "Manutenção Preventiva", unidade: "un", valorPadrao: 350 },
    { nome: "Manutenção Corretiva", unidade: "un", valorPadrao: 450 },
    { nome: "Instalação", unidade: "un", valorPadrao: 800 },
    { nome: "Recarga de Gás", unidade: "un", valorPadrao: 250 },
    { nome: "Limpeza de Filtro", unidade: "un", valorPadrao: 80 },
    { nome: "Higienização", unidade: "un", valorPadrao: 180 },
  ];
  for (const s of servicos) {
    await prisma.servico.create({ data: { empresaId: empresa.id, ...s } });
  }
  console.log(`Serviços criados: ${servicos.length}`);

  // ======== PRODUTOS ========
  const produtos = [
    { nome: "Gás R410A", unidade: "kg", valorPadrao: 120, estoqueMinimo: 5 },
    { nome: "Gás R22", unidade: "kg", valorPadrao: 80, estoqueMinimo: 5 },
    { nome: "Filtro de Ar", unidade: "un", valorPadrao: 45, estoqueMinimo: 10 },
    { nome: "Capacitor", unidade: "un", valorPadrao: 35, estoqueMinimo: 5 },
    { nome: "Contactor", unidade: "un", valorPadrao: 60, estoqueMinimo: 3 },
    { nome: "Válvula de Expansão", unidade: "un", valorPadrao: 180, estoqueMinimo: 2 },
  ];
  for (const p of produtos) {
    await prisma.produto.create({ data: { empresaId: empresa.id, ...p } });
  }
  console.log(`Produtos criados: ${produtos.length}`);

  // ======== TEMPLATES DE PRAZO / SLA ========
  const msgPadrao = "OS {{os_numero}} — {{cliente_nome}}: etapa \"{{prazo_etapa}}\" iniciada. {{link}}";
  const prazoTemplates = [
    {
      nome: "Compra de Material", cor: "#F59E0B",
      descricao: "Fluxo de aquisição de material para a OS.",
      etapas: [
        { nome: "Solicitado", prazoHoras: 1, responsavel: ResponsavelPrazo.COMPRADOR },
        { nome: "Cotando", prazoHoras: 4, responsavel: ResponsavelPrazo.COMPRADOR },
        { nome: "Comprado", prazoHoras: 24, responsavel: ResponsavelPrazo.COMPRADOR },
        { nome: "Entregue", prazoHoras: 48, responsavel: ResponsavelPrazo.COMPRADOR },
      ],
    },
    {
      nome: "Atendimento Urgente", cor: "#EF4444",
      descricao: "SLA de atendimento emergencial.",
      etapas: [
        { nome: "Aberto", prazoHoras: 0.5, responsavel: ResponsavelPrazo.GESTOR },
        { nome: "Técnico Designado", prazoHoras: 1, responsavel: ResponsavelPrazo.GESTOR },
        { nome: "Em Atendimento", prazoHoras: 2, responsavel: ResponsavelPrazo.TECNICO },
        { nome: "Concluído", prazoHoras: 4, responsavel: ResponsavelPrazo.TECNICO },
      ],
    },
    {
      nome: "Instalação", cor: "#0EA5E9",
      descricao: "Fluxo de instalação de equipamento.",
      etapas: [
        { nome: "Agendado", prazoHoras: 24, responsavel: ResponsavelPrazo.GESTOR },
        { nome: "Material Separado", prazoHoras: 4, responsavel: ResponsavelPrazo.COMPRADOR },
        { nome: "Em Execução", prazoHoras: 2, responsavel: ResponsavelPrazo.TECNICO },
        { nome: "Concluído", prazoHoras: 8, responsavel: ResponsavelPrazo.TECNICO },
      ],
    },
    {
      nome: "Aprovação de Orçamento", cor: "#8B5CF6",
      descricao: "Acompanhamento da aprovação comercial.",
      etapas: [
        { nome: "Enviado", prazoHoras: 24, responsavel: ResponsavelPrazo.CLIENTE },
        { nome: "Visualizado", prazoHoras: 48, responsavel: ResponsavelPrazo.CLIENTE },
        { nome: "Aprovado/Reprovado", prazoHoras: 72, responsavel: ResponsavelPrazo.CLIENTE },
      ],
    },
  ];
  const totalPrazos = await prisma.prazoTemplate.count({ where: { empresaId: empresa.id } });
  if (totalPrazos === 0) {
    for (const t of prazoTemplates) {
      await prisma.prazoTemplate.create({
        data: {
          empresaId: empresa.id,
          nome: t.nome,
          descricao: t.descricao,
          cor: t.cor,
          etapas: {
            create: t.etapas.map((e, idx) => ({
              nome: e.nome,
              prazoHoras: e.prazoHoras,
              responsavel: e.responsavel,
              canal: CanalNotificacao.WHATSAPP,
              mensagem: msgPadrao,
              ordem: idx,
            })),
          },
        },
      });
    }
    console.log(`Templates de prazo criados: ${prazoTemplates.length}`);
  }

  // ======== TABELAS DE PREÇOS ========
  const totalTabelas = await prisma.tabelaPreco.count({ where: { empresaId: empresa.id } });
  if (totalTabelas === 0) {
    await prisma.tabelaPreco.create({
      data: { empresaId: empresa.id, nome: "Padrão", descricao: "Tabela padrão da empresa", tipo: "PADRAO" },
    });
    await prisma.tabelaPreco.create({
      data: { empresaId: empresa.id, nome: "Contrato", descricao: "Preços de contrato", tipo: "CONTRATO" },
    });
    console.log("Tabelas de preços criadas: 2 (Padrão, Contrato)");
  }

  // ======== TERMOS DE REFERÊNCIA ========
  const totalTermos = await prisma.termoReferenciaTemplate.count({ where: { empresaId: empresa.id } });
  if (totalTermos === 0) {
    const termos = [
      {
        nome: "Termo Padrão Manutenção Preventiva",
        descricao: "Modelo enxuto para contratos de manutenção preventiva mensal.",
        conteudo:
          `CONTRATO DE PRESTAÇÃO DE SERVIÇOS DE MANUTENÇÃO PREVENTIVA\n\n` +
          `A CONTRATADA prestará à {{cliente_nome}} serviços de manutenção preventiva nos equipamentos de climatização cobertos por este instrumento, ` +
          `com frequência {{frequencia}}, pelo valor mensal de {{valor_mensal}}, iniciando em {{data_inicio}} e com vigência de {{vigencia}}.\n\n` +
          `1. OBJETO\nManutenção preventiva conforme PMOC, incluindo inspeção, limpeza e verificação de desempenho dos equipamentos.\n\n` +
          `2. RESPONSÁVEL TÉCNICO\nResponsável técnico: {{responsavel_tecnico}} — ART nº {{art_numero}}.\n\n` +
          `3. OBRIGAÇÕES\nA CONTRATADA executará as visitas programadas e emitirá relatório técnico a cada atendimento.\n\n` +
          `4. VIGÊNCIA\nO presente contrato vigorará por {{vigencia}} a contar de {{data_inicio}}.`,
      },
      {
        nome: "Termo Contrato Anual",
        descricao: "Modelo completo para contratos anuais de manutenção.",
        conteudo:
          `CONTRATO ANUAL DE MANUTENÇÃO DE SISTEMAS DE CLIMATIZAÇÃO\n\n` +
          `Pelo presente instrumento, a CONTRATADA compromete-se a prestar à {{cliente_nome}} os serviços de manutenção descritos no escopo, ` +
          `pelo período de {{vigencia}} com início em {{data_inicio}}, mediante o pagamento mensal de {{valor_mensal}} e visitas com periodicidade {{frequencia}}.\n\n` +
          `CLÁUSULA 1 — DO OBJETO\nManutenção preventiva e corretiva dos equipamentos cobertos, conforme escopo e SLA anexos.\n\n` +
          `CLÁUSULA 2 — DO RESPONSÁVEL TÉCNICO\nOs serviços serão acompanhados por {{responsavel_tecnico}}, sob a ART nº {{art_numero}}.\n\n` +
          `CLÁUSULA 3 — DO VALOR E REAJUSTE\nO valor mensal de {{valor_mensal}} será reajustado anualmente conforme índice acordado entre as partes.\n\n` +
          `CLÁUSULA 4 — DA VIGÊNCIA\nEste contrato terá vigência de {{vigencia}}, iniciando-se em {{data_inicio}}, renovável mediante acordo entre as partes.`,
      },
    ];
    for (const t of termos) {
      await prisma.termoReferenciaTemplate.create({ data: { empresaId: empresa.id, ...t } });
    }
    console.log(`Termos de referência criados: ${termos.length}`);
  }

  // ───────────── Cargos ─────────────
  const totalCargos = await prisma.cargo.count({ where: { empresaId: empresa.id } });
  if (totalCargos === 0) {
    const cargos = [
      { nome: "Técnico de Refrigeração", descricao: "Manutenção e instalação de sistemas de refrigeração" },
      { nome: "Técnico de Ar Condicionado", descricao: "Manutenção e instalação de ar condicionado" },
      { nome: "Responsável Técnico", descricao: "Engenheiro responsável técnico (ART/CREA)" },
      { nome: "Motorista", descricao: "Condução de veículos da frota" },
      { nome: "Auxiliar Técnico", descricao: "Apoio às atividades técnicas em campo" },
      { nome: "Administrativo", descricao: "Atividades administrativas e de escritório" },
    ];
    for (const c of cargos) await prisma.cargo.create({ data: { empresaId: empresa.id, ...c } });
    console.log(`Cargos criados: ${cargos.length}`);
  }

  // ───────────── Checklist Diário de Veículo ─────────────
  const totalChecklists = await prisma.checklistTemplate.count({ where: { empresaId: empresa.id } });
  if (totalChecklists === 0) {
    const itensChecklist: { categoria: string; descricao: string; tipo: "OK_NOK" | "NIVEL" | "TEXTO" | "FOTO"; opcoes: string[] }[] = [
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
    await prisma.checklistTemplate.create({
      data: {
        empresaId: empresa.id,
        nome: "Checklist Diário",
        descricao: "Inspeção diária do veículo antes da saída",
        frequencia: "DIARIO",
        itens: { create: itensChecklist.map((it, idx) => ({ ...it, obrigatorio: it.tipo !== "TEXTO", ordem: idx })) },
      },
    });
    console.log("Checklist Diário criado com 15 itens");
  }

  // ───────────── Perfis de acesso padrão ─────────────
  const totalPerfis = await prisma.perfilAcesso.count({ where: { empresaId: empresa.id } });
  if (totalPerfis === 0) {
    const perfisPadrao = [
      { nome: "Administrador", tipo: "ADMINISTRADOR", descricao: "Acesso total ao sistema" },
      { nome: "Supervisor de Manutenção", tipo: "SUPERVISOR", descricao: "OS, clientes, equipes e relatórios" },
      { nome: "Financeiro", tipo: "FINANCEIRO", descricao: "Financeiro, contratos, orçamentos e clientes" },
      { nome: "Técnico de Campo", tipo: "TECNICO", descricao: "OS, equipamentos, calendário e veículos" },
      { nome: "Auxiliar Técnico", tipo: "AUXILIAR", descricao: "OS (visualizar), equipamentos e calendário" },
    ] as const;
    for (const p of perfisPadrao) {
      await prisma.perfilAcesso.create({
        data: {
          empresaId: empresa.id, nome: p.nome, descricao: p.descricao, tipo: p.tipo as any,
          cor: CORES_PERFIL[p.tipo] ?? "#8B5CF6", padraoSistema: true, permissoes: PRESETS[p.tipo] as any,
        },
      });
    }
    console.log(`Perfis de acesso padrão criados: ${perfisPadrao.length}`);
  }

  console.log("\nSeed concluído!");
  console.log("Login: admin@climatotal.com.br / admin123");
}

main()
  .catch((e) => { console.error("Erro:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
