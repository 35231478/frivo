/**
 * EMPRESA DE DEMONSTRAÇÃO para os prints da home de vendas (`npm run prints:vendas`).
 *
 * Cria, num banco LOCAL, a "Polar Climatização" com operação de um mês: clientes, técnicos, equipes,
 * equipamentos com QR, OS de preventiva/corretiva/instalação com checklist e fotos, aceite com nota,
 * PMOC com cronograma, orçamentos, contratos, estoque, financeiro, desempenho e posição no mapa.
 * Tudo inventado (scripts/vendas/demo-dados.ts). As datas são relativas a HOJE: rodar de novo deixa
 * o calendário e o painel sempre "no mês".
 *
 * Idempotente: apaga a empresa de demonstração (pelo CNPJ fictício) e cria de novo. Só roda com
 * DATABASE_URL apontando para o próprio computador (ver `exigirBancoLocal`) — nunca em produção.
 *
 *   DATABASE_URL=postgresql://…@localhost/frivo_prints npx vite-node --config vitest.config.ts scripts/vendas/seed-demo.ts
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TIPOS_PADRAO } from "@/lib/checklist/padrao";
import { CORES_PERFIL, PRESETS } from "@/lib/permissoes";
import { executarCronograma } from "@/lib/pmoc-cronograma-server";
import { maiorUsado } from "@/lib/numeracao-server";
import { descricaoDaOs } from "@/lib/orcamentos/gerar-os";
import {
  CLIENTES, EMPRESA, EQUIPES, LOGIN_GESTORA, PESSOAS, PRODUTOS, SENHA_DEMO, TIPOS_OS, TITULOS,
  cnpjFicticio, cpfFicticio, telefone, type ChaveTipo, type ChaveTipoOs,
} from "./demo-dados";
import { assinatura, fotoEquipamento } from "./demo-imagens";
import { exigirBancoLocal } from "./banco-local";

/* ───────────────────────── datas (Brasília, UTC−3) ───────────────────────── */

const BR = -3;
const agora = new Date();
const hojeBR = new Date(agora.getTime() + BR * 3600_000); // campos UTC = data/hora de Brasília
const [Y, M, D] = [hojeBR.getUTCFullYear(), hojeBR.getUTCMonth(), hojeBR.getUTCDate()];

/** Instante (UTC) de `dias` a partir de hoje, às `hora`:`min` de Brasília. */
const quando = (dias: number, hora = 8, min = 0) => new Date(Date.UTC(Y, M, D + dias, hora - BR, min));
/** Dia civil (campos @db.Date) */
const dia = (dias: number) => new Date(Date.UTC(Y, M, D + dias));
const diaDaSemana = (dias: number) => new Date(Date.UTC(Y, M, D + dias)).getUTCDay();
const util = (dias: number) => ![0, 6].includes(diaDaSemana(dias));
/** Dias desde o 1º do mês corrente (negativo) — o mês de medição do Desempenho */
const inicioDoMes = -(D - 1);

/* ───────────────────────── sorteio determinístico ───────────────────────── */

let semente = 20261126;
const sorte = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
const escolher = <T,>(xs: readonly T[]): T => xs[Math.floor(sorte() * xs.length)];
const entre = (a: number, b: number) => a + Math.floor(sorte() * (b - a + 1));
const dec = (v: number) => new Prisma.Decimal(v.toFixed(2));

/* ───────────────────────── o seed ───────────────────────── */

async function apagarDemo() {
  const antiga = await prisma.empresa.findUnique({ where: { cnpj: EMPRESA.cnpj }, select: { id: true } });
  if (!antiga) return;
  // Nem toda chave estrangeira tem cascata: apaga, em passadas, as linhas da empresa de demonstração de
  // cada tabela que tem empresa_id; o que esbarra numa dependência fica para a passada seguinte.
  const tabelas = await prisma.$queryRaw<{ t: string }[]>`
    SELECT table_name AS t FROM information_schema.columns
    WHERE column_name = 'empresa_id' AND table_schema = current_schema() AND table_name <> 'empresas'`;
  let faltam = tabelas.map((x) => x.t);
  for (let passada = 0; faltam.length && passada < 20; passada++) {
    const ainda: string[] = [];
    for (const t of faltam) {
      try { await prisma.$executeRawUnsafe(`DELETE FROM "${t}" WHERE empresa_id = $1`, antiga.id); } catch { ainda.push(t); }
    }
    faltam = ainda;
  }
  await prisma.$executeRawUnsafe(`DELETE FROM empresas WHERE id = $1`, antiga.id);
}

async function main() {
  exigirBancoLocal();
  await apagarDemo();
  console.log(`Empresa de demonstração — hoje ${hojeBR.toISOString().slice(0, 10)} (Brasília)`);

  const empresa = await prisma.empresa.create({
    data: {
      nome: EMPRESA.nome, nomeFantasia: EMPRESA.nomeFantasia, cnpj: EMPRESA.cnpj, email: EMPRESA.email,
      telefone: telefone(1), cidade: EMPRESA.cidade, estado: EMPRESA.estado, bairro: EMPRESA.bairro,
      endereco: EMPRESA.endereco, numero: EMPRESA.numero, latitude: EMPRESA.latitude, longitude: EMPRESA.longitude, plano: "PROFISSIONAL",
    },
  });
  const empresaId = empresa.id;
  await prisma.configuracao.create({ data: { empresaId, appRastrearLocalizacao: true } });

  const senha = await bcrypt.hash(SENHA_DEMO, 10);
  const gestora = await prisma.usuario.create({ data: { empresaId, nome: LOGIN_GESTORA.nome, email: LOGIN_GESTORA.email, senha, role: "ADMIN" } });
  const usuarioId = gestora.id;

  /* ── pessoas ── */
  const cargos = new Map<string, string>();
  for (const nome of [...new Set(PESSOAS.map((p) => p.cargo))]) {
    cargos.set(nome, (await prisma.cargo.create({ data: { empresaId, nome } })).id);
  }
  const tecnicos: { id: string; nome: string; email: string }[] = [];
  for (const [i, p] of PESSOAS.entries()) {
    const email = `${p.nome.replace(/^Eng\. /, "").split(" ")[0].toLowerCase()}@polarclima.exemplo`;
    const t = await prisma.tecnico.create({
      data: {
        empresaId, nome: p.nome, cpf: cpfFicticio(`9${String(31 + i * 7).padStart(2, "0")}40${i}5${i}7`), telefone: telefone(10 + i), email,
        tipo: p.tipo ?? "TECNICO_CAMPO", crea: p.crea, especialidades: p.especialidades, cargoId: cargos.get(p.cargo),
        dataAdmissao: quando(-400 - i * 90), jornadaEntrada: "08:00", jornadaSaida: "18:00", jornadaDias: ["SEG", "TER", "QUA", "QUI", "SEX"],
        tipoEquipe: p.tipo === "RESPONSAVEL_TECNICO" ? "ADMINISTRATIVO" : "CAMPO",
      },
    });
    tecnicos.push({ id: t.id, nome: t.nome, email });
  }
  const campo = tecnicos.slice(0, 6);
  const rt = tecnicos[6];
  await prisma.empresa.update({ where: { id: empresaId }, data: { responsavelTecnicoId: rt.id } });
  // O técnico do app: entra com o mesmo e-mail do cadastro (o modo técnico liga por aí)
  const perfilTecnico = await prisma.perfilAcesso.create({ data: { empresaId, nome: "Técnico", tipo: "TECNICO", permissoes: PRESETS.TECNICO as unknown as Prisma.InputJsonValue, cor: CORES_PERFIL.TECNICO, padraoSistema: true } });
  await prisma.usuario.create({ data: { empresaId, nome: campo[0].nome, email: campo[0].email, senha, role: "TECNICO", perfilAcessoId: perfilTecnico.id } });

  const veiculos = [
    { placa: "PLR0A01", modelo: "Fiorino Endurance", marca: "Fiat" },
    { placa: "PLR0B02", modelo: "Saveiro Robust", marca: "Volkswagen" },
    { placa: "PLR0C03", modelo: "Strada Freedom", marca: "Fiat" },
  ];
  const equipes: { id: string; membros: string[]; veiculoId: string }[] = [];
  for (const [i, e] of EQUIPES.entries()) {
    const membros = e.membros.map((m) => campo[m].id);
    const eq = await prisma.equipe.create({ data: { empresaId, nome: e.nome, cor: e.cor, liderId: membros[0], membros: { connect: membros.map((id) => ({ id })) } } });
    const v = await prisma.veiculo.create({ data: { empresaId, ...veiculos[i], tipo: "CARRO", ano: "2023", equipeId: eq.id, responsavelId: membros[0], quilometragemAtual: 38_000 + i * 9_400 } });
    equipes.push({ id: eq.id, membros, veiculoId: v.id });
  }
  const equipeDe = (tecnicoId: string) => equipes.find((e) => e.membros.includes(tecnicoId)) ?? equipes[0];

  /* ── tipos de equipamento (com o checklist padrão do sistema) e de OS ── */
  const tiposEquip = new Map<ChaveTipo, { id: string; itens: { id: string; texto: string; pedirFoto: boolean; pedirObservacao: boolean; tipoResposta: string; unidade: string | null }[] }>();
  for (const t of TIPOS_PADRAO) {
    const tipo = await prisma.tipoEquipamentoCustom.create({ data: { empresaId, nome: t.nome, chaveEnum: t.chave } });
    const itens = [];
    for (const [ordem, it] of t.itens.entries()) {
      itens.push(await prisma.checklistTipoItem.create({
        data: { empresaId, tipoEquipamentoId: tipo.id, texto: it.texto, pedirFoto: !!it.pedirFoto, pedirObservacao: !!it.pedirObservacao, tipoResposta: it.tipoResposta ?? "OK_ATENCAO_NA", unidade: it.unidade ?? null, ordem },
      }));
    }
    tiposEquip.set(t.chave as ChaveTipo, { id: tipo.id, itens });
  }
  const tiposOs = new Map<ChaveTipoOs, string>();
  for (const t of TIPOS_OS) tiposOs.set(t.chave, (await prisma.tipoOs.create({ data: { empresaId, nome: t.nome, cor: t.cor, exigeEquipamento: t.exigeEquipamento } })).id);

  /* ── clientes, unidades, equipamentos e QR ── */
  let qrSeq = 2101;
  const clientes: { id: string; unidadeId: string; nome: string; contato: string; lat: number; lng: number; equipamentos: { id: string; tipo: ChaveTipo; nome: string }[] }[] = [];
  for (const [i, c] of CLIENTES.entries()) {
    const cliente = await prisma.cliente.create({
      data: {
        empresaId, nome: c.nome, nomeFantasia: c.fantasia, cpfCnpj: cnpjFicticio(c.raizCnpj), segmento: c.segmento,
        email: `contato@${c.fantasia.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "")}.exemplo`, telefone: telefone(40 + i), contato: c.contato,
        endereco: c.logradouro, numero: c.numero, bairro: c.bairro, cidade: "Goiânia", estado: "GO", origem: "INDICACAO",
      },
    });
    const unidade = await prisma.unidade.create({
      data: { empresaId, clienteId: cliente.id, nome: "Matriz", principal: true, logradouro: c.logradouro, numero: c.numero, bairro: c.bairro, cidade: "Goiânia", estado: "GO", latitude: c.lat, longitude: c.lng },
    });
    const equipamentos = [];
    for (const [j, e] of c.equipamentos.entries()) {
      const tipo = tiposEquip.get(e.tipo)!;
      const eq = await prisma.equipamento.create({
        data: {
          empresaId, unidadeId: unidade.id, tipo: e.tipo, tipoEquipamentoId: tipo.id, nome: e.nome, marca: e.marca, modelo: e.modelo,
          capacidade: e.capacidade, setor: e.setor, localizacao: e.setor, numeroSerie: `${e.marca.slice(0, 2).toUpperCase()}${2300 + i * 37 + j}${String(10_000 + j * 731).slice(-4)}`,
          patrimonio: `PAT-${String(100 + i * 20 + j)}`, fluido: e.tipo === "CHILLER" ? "R-134a" : e.tipo === "CAMARA_FRIA" ? "R-404A" : "R-410A",
          tensao: e.tipo === "AR_CONDICIONADO_SPLIT" ? "220 V" : "380 V", dataInstalacao: quando(-700 + i * 40 + j * 9),
          garantiaInicio: quando(-700 + i * 40 + j * 9), garantiaAte: quando(-700 + i * 40 + j * 9 + 365 * 3),
        },
      });
      await prisma.qrcode.create({ data: { empresaId, codigo: `QR-${qrSeq++}`, equipamentoId: eq.id } });
      equipamentos.push({ id: eq.id, tipo: e.tipo, nome: e.nome });
    }
    clientes.push({ id: cliente.id, unidadeId: unidade.id, nome: c.fantasia, contato: c.contato, lat: c.lat, lng: c.lng, equipamentos });
  }
  const clientePorNome = (fantasia: string) => clientes.find((c) => c.nome === fantasia)!;

  /* ── imagens (geradas: nada de foto real) ── */
  const fotos = { antes: [] as string[], depois: [] as string[] };
  for (let v = 0; v < 4; v++) { fotos.antes.push(await fotoEquipamento(v, true)); fotos.depois.push(await fotoEquipamento(v, false)); }
  const assinaturas = [await assinatura(0), await assinatura(1), await assinatura(2)];
  // A foto de cadastro dos splits (a ficha do equipamento mostra a foto)
  await prisma.equipamento.updateMany({ where: { empresaId, tipo: "AR_CONDICIONADO_SPLIT" }, data: { fotos: [fotos.depois[1]] } });

  /* ── OS e atividades ── */
  let osSeq = 1180;
  type Situacao = "CONCLUIDA" | "EM_ANDAMENTO" | "DESLOCAMENTO" | "AGENDADA";
  interface NovaOs {
    cliente: (typeof clientes)[number]; tipo: ChaveTipoOs; titulo: string; tecnicos: string[]; dias: number; hora: number;
    equipamentos: number; situacao: Situacao; prioridade?: "NORMAL" | "ALTA" | "URGENTE";
    /** Concluiu depois do prazo (dias) */ atrasoDias?: number; /** Relatório sem foto antes/depois */ semAntesDepois?: boolean;
    nota?: number | null; comentario?: string; aceite?: "LOCAL" | "REMOTO" | "PENDENTE" | null; contratoId?: string | null;
  }
  const criadas: { osId: string; atividadeId: string; equipamentos: string[]; situacao: Situacao; tecnicos: string[]; cliente: (typeof clientes)[number] }[] = [];

  async function executar(atividadeId: string, equipamentos: { id: string; tipo: ChaveTipo }[], tecnicoUsuario: string | null, momento: Date, opcoes: { completo: boolean; antesDepois: boolean; parcial?: boolean }) {
    for (const [k, e] of equipamentos.entries()) {
      if (opcoes.parcial && k > 0) break;
      const tipo = tiposEquip.get(e.tipo)!;
      await prisma.atividadeEquipamento.updateMany({ where: { atividadeId, equipamentoId: e.id }, data: { feito: true, feitoEm: momento, observacao: k === 0 && sorte() < 0.3 ? "Equipamento operando dentro dos parâmetros após a manutenção." : null } });
      const atencao = sorte() < 0.15 ? tipo.itens.find((it) => it.tipoResposta !== "MEDICAO" && !it.pedirFoto) : undefined;
      const respostas: Prisma.ChecklistRespostaCreateManyInput[] = [];
      for (const it of tipo.itens) {
        if (opcoes.parcial && it === tipo.itens[Math.floor(tipo.itens.length * 0.6)]) break;
        const base = { empresaId, atividadeId, equipamentoId: e.id, itemId: it.id, textoItem: it.texto, respondidoEm: momento, respondidoPorId: tecnicoUsuario };
        if (it.tipoResposta === "MEDICAO") {
          const valor = /sucção/.test(it.texto) ? entre(115, 135) : /descarga/.test(it.texto) ? entre(330, 390) : /Corrente/.test(it.texto) ? entre(30, 92) / 10
            : /insuflamento/.test(it.texto) ? entre(11, 14) : /retorno/.test(it.texto) ? entre(22, 25) : /entrada da água/.test(it.texto) ? 12 : /saída da água/.test(it.texto) ? 7
            : /câmara/.test(it.texto) ? -18 : /Setpoint/.test(it.texto) ? -20 : entre(10, 30);
          respostas.push({ ...base, valor: dec(valor), unidade: it.unidade });
        } else if (it === atencao) {
          respostas.push({ ...base, status: "ATENCAO", observacao: "Isolamento ressecado no trecho externo; recomendada a troca na próxima visita." });
        } else {
          respostas.push({ ...base, status: "OK", observacao: it.pedirObservacao ? "Dentro do especificado pelo fabricante." : null });
        }
      }
      if (!opcoes.completo) respostas.pop();
      await prisma.checklistResposta.createMany({ data: respostas });
      const fotosItem = tipo.itens.filter((it) => it.pedirFoto || it === atencao).map((it, n) => ({ empresaId, atividadeId, equipamentoId: e.id, itemId: it.id, url: fotos.depois[n % 4], criadoPorId: tecnicoUsuario, criadoEm: momento }));
      const antesDepois = opcoes.antesDepois && !opcoes.parcial
        ? [{ momento: "ANTES" as const, url: fotos.antes[k % 4] }, { momento: "DEPOIS" as const, url: fotos.depois[k % 4] }].map((f) => ({ empresaId, atividadeId, equipamentoId: e.id, momento: f.momento, url: f.url, criadoPorId: tecnicoUsuario, criadoEm: momento }))
        : [];
      await prisma.fotoAtendimento.createMany({ data: [...fotosItem, ...antesDepois] });
    }
  }

  async function novaOs(o: NovaOs) {
    const tipoOsId = tiposOs.get(o.tipo)!;
    const inicio = quando(o.dias, o.hora, sorte() < 0.5 ? 0 : 30);
    const equipamentos = o.tipo === "visita" ? [] : o.cliente.equipamentos.slice(0, o.equipamentos).length
      ? [...o.cliente.equipamentos].sort(() => sorte() - 0.5).slice(0, o.equipamentos) : [];
    const [responsavel, ...ajudantes] = o.tecnicos;
    const equipe = equipeDe(responsavel);
    const concluida = o.situacao === "CONCLUIDA";
    const fim = new Date(inicio.getTime() + (o.atrasoDias ?? 0) * 86_400_000 + entre(70, 180) * 60_000);
    const statusOs = concluida ? "CONCLUIDA" : o.situacao === "EM_ANDAMENTO" ? "EM_ANDAMENTO" : "AGENDADA";
    const os = await prisma.ordemServico.create({
      data: {
        empresaId, numero: `OS-${osSeq++}`, clienteId: o.cliente.id, unidadeId: o.cliente.unidadeId, criadoPorId: usuarioId, responsavelId: usuarioId,
        descricao: o.titulo, prioridade: o.prioridade ?? "NORMAL", status: statusOs, contratoId: o.contratoId ?? null,
        equipamentoId: equipamentos.length === 1 ? equipamentos[0].id : null,
        dataInicio: o.situacao === "AGENDADA" || o.situacao === "DESLOCAMENTO" ? null : inicio, dataConclusao: concluida ? fim : null,
        previsaoConclusao: dia(o.dias + (o.tipo === "instalacao" ? 2 : 0)),
        criadoEm: quando(o.dias - entre(2, 9), 9), origem: o.contratoId && o.tipo === "preventiva" ? "RECORRENTE" : "MANUAL",
      },
    });
    const atividade = await prisma.atividadeOs.create({
      data: {
        empresaId, ordemServicoId: os.id, tipoOsId, tecnicoId: responsavel, equipeId: equipe.id, veiculoId: equipe.veiculoId, titulo: o.titulo,
        status: concluida ? "CONCLUIDA" : o.situacao === "EM_ANDAMENTO" ? "EM_ANDAMENTO" : "AGENDADA",
        dataAgendada: inicio, prazo: dia(o.dias), concluidaEm: concluida ? fim : null, duracaoMin: o.tipo === "instalacao" ? 240 : o.tipo === "visita" ? 60 : 120,
        resumo: concluida ? "Serviço executado conforme o checklist. Equipamentos testados e entregues em funcionamento." : null,
        tecnicosEquipe: { create: ajudantes.map((tecnicoId) => ({ tecnicoId })) },
        equipamentos: { create: equipamentos.map((e) => ({ equipamentoId: e.id })) },
        criadoEm: os.criadoEm,
      },
    });
    await prisma.osHistorico.create({ data: { ordemServicoId: os.id, usuarioId, acao: "CRIADA", detalhes: "OS aberta", criadoEm: os.criadoEm } });

    const usuarioTecnico = responsavel === campo[0].id ? (await prisma.usuario.findFirst({ where: { empresaId, email: campo[0].email }, select: { id: true } }))?.id ?? null : null;
    // "A caminho" / "Cheguei": o que o técnico toca no app (o estado "Em deslocamento" sai daqui)
    const avisos: { evento: string; em: Date }[] = [];
    if (o.situacao !== "AGENDADA") avisos.push({ evento: "A_CAMINHO", em: new Date(inicio.getTime() - 35 * 60_000) });
    if (o.situacao === "EM_ANDAMENTO" || concluida) avisos.push({ evento: "CHEGOU", em: new Date(inicio.getTime() - 5 * 60_000) });
    for (const a of avisos) {
      await prisma.atividadeAviso.create({
        data: { empresaId, atividadeId: atividade.id, evento: a.evento, dia: dia(o.dias), registradoEm: a.em, usuarioId: usuarioTecnico ?? usuarioId, avisoStatus: "ENVIADO", avisoEm: a.em, avisoPara: o.cliente.contato },
      });
    }

    if (concluida || o.situacao === "EM_ANDAMENTO") {
      await executar(atividade.id, equipamentos, usuarioTecnico, concluida ? fim : agora, { completo: true, antesDepois: !o.semAntesDepois, parcial: o.situacao === "EM_ANDAMENTO" });
    }
    if (concluida && o.aceite) {
      const confirmado = o.aceite !== "PENDENTE";
      await prisma.osAceite.create({
        data: {
          empresaId, ordemServicoId: os.id, atividadeId: atividade.id, token: randomBytes(24).toString("base64url"),
          situacao: confirmado ? "CONFIRMADO" : "PENDENTE", metodo: confirmado ? o.aceite : null,
          nome: confirmado ? o.cliente.contato.replace(/^(Dra?\.|Sra?\.|Prof\.|Eng\.) /, "").replace(/ \(.*\)$/, "") : null,
          assinatura: o.aceite === "LOCAL" ? escolher(assinaturas) : null,
          avaliacao: confirmado ? (o.nota ?? null) : null, avaliacaoComentario: confirmado ? (o.comentario ?? null) : null,
          confirmadoEm: confirmado ? new Date(fim.getTime() + (o.aceite === "REMOTO" ? 5 * 3600_000 : 10 * 60_000)) : null,
          colhidoPorId: o.aceite === "LOCAL" ? usuarioTecnico : null, enviadoEm: o.aceite === "LOCAL" ? null : fim, enviadoCanal: o.aceite === "LOCAL" ? null : "WHATSAPP",
          enviadoPara: o.aceite === "LOCAL" ? null : telefone(60), envios: o.aceite === "LOCAL" ? 0 : 1, ip: o.aceite === "REMOTO" ? "203.0.113.24" : null,
        },
      });
    }
    criadas.push({ osId: os.id, atividadeId: atividade.id, equipamentos: equipamentos.map((e) => e.id), situacao: o.situacao, tecnicos: o.tecnicos, cliente: o.cliente });
    return { os, atividade };
  }

  /* ── contratos (antes das OS: as preventivas são do contrato) ── */
  let ctSeq = 38;
  const contratos = new Map<string, string>();
  const CONTRATOS = [
    { cliente: "Clínica Vitta", valor: 2450, tipo: "MANUTENCAO_PREVENTIVA" as const, desde: -300, status: "ATIVO" as const },
    { cliente: "Edifício Atrium Office", valor: 9800, tipo: "MANUTENCAO_COMPLETA" as const, desde: -520, status: "ATIVO" as const },
    { cliente: "Hotel Ipê Real", valor: 4300, tipo: "MANUTENCAO_COMPLETA" as const, desde: -200, status: "ATIVO" as const },
    { cliente: "Colégio Novo Horizonte", valor: 2100, tipo: "MANUTENCAO_PREVENTIVA" as const, desde: -150, status: "ATIVO" as const },
    { cliente: "Empório Serra Dourada", valor: 1650, tipo: "MANUTENCAO_PREVENTIVA" as const, desde: -95, status: "ATIVO" as const },
    { cliente: "Cond. Bosque dos Ipês", valor: 980, tipo: "MANUTENCAO_PREVENTIVA" as const, desde: -60, status: "ATIVO" as const },
    { cliente: "Academia Movimento", valor: 890, tipo: "MANUTENCAO_PREVENTIVA" as const, desde: 0, status: "AGUARDANDO_ASSINATURA" as const },
  ];
  for (const c of CONTRATOS) {
    const cli = clientePorNome(c.cliente);
    const ct = await prisma.contrato.create({
      data: {
        empresaId, clienteId: cli.id, numero: `CT-${ctSeq++}`, tipo: c.tipo, status: c.status, periodicidade: "MENSAL", valorMensal: dec(c.valor), valorTotal: dec(c.valor * 12),
        dataInicio: dia(c.desde), dataFim: dia(c.desde + 365 * Math.max(1, Math.ceil((30 - c.desde) / 365))), diaVencimento: 10, diaFaturamento: 1, responsavelTecnicoId: rt.id,
        artNumero: c.tipo === "MANUTENCAO_COMPLETA" || c.cliente === "Clínica Vitta" ? `ART-${1020_000 + ctSeq}` : null,
        qtdVisitas: 1, periodoVisitas: "MES", unidades: { create: [{ unidadeId: cli.unidadeId }] },
        descricaoServicos: "Manutenção preventiva mensal conforme PMOC, atendimento corretivo e relatórios técnicos.",
      },
    });
    contratos.set(c.cliente, ct.id);
  }

  /* ── a operação do mês ── */
  const [rafael, thiago, lucas, diego, felipe, igor] = campo.map((t) => t.id);
  // Duplas de campo: quem executa e quem ajuda. O desempenho de cada um sai do que fizeram.
  const duplas: { tecnicos: string[]; peso: number; atraso: number; semFoto: number; notas: number[] }[] = [
    { tecnicos: [rafael, diego], peso: 2, atraso: 0, semFoto: 0, notas: [5, 5, 5, 4] },
    { tecnicos: [rafael], peso: 1, atraso: 0.15, semFoto: 0, notas: [5, 4] },
    { tecnicos: [thiago, igor], peso: 3, atraso: 0.12, semFoto: 0.1, notas: [5, 4, 5, 4] },
    { tecnicos: [lucas], peso: 2, atraso: 0.05, semFoto: 0.05, notas: [5, 5, 4] },
    { tecnicos: [felipe], peso: 2, atraso: 0.2, semFoto: 0.2, notas: [4, 4, 5, 3] },
  ];
  const sortearDupla = () => { const total = duplas.reduce((s, d) => s + d.peso, 0); let r = sorte() * total; for (const d of duplas) { r -= d.peso; if (r < 0) return d; } return duplas[0]; };
  const comentarios = ["Equipe pontual e muito cuidadosa com o ambiente.", "Serviço rápido, explicaram tudo o que foi feito.", "Ótimo atendimento.", "Resolveram o problema no mesmo dia.", null, null];
  const tipoPorCliente = (nome: string): ChaveTipoOs => (["Clínica Vitta", "Edifício Atrium Office", "Hotel Ipê Real", "Colégio Novo Horizonte"].includes(nome) ? escolher(["preventiva", "preventiva", "corretiva", "limpeza"] as const) : escolher(["corretiva", "preventiva", "instalacao", "corretiva"] as const));

  // Passado: do início do mês anterior até ontem (o mês anterior dá o histórico do financeiro e do desempenho)
  for (let d = inicioDoMes - 30; d < 0; d++) {
    if (!util(d)) continue;
    const n = d < inicioDoMes ? entre(1, 2) : entre(2, 3);
    for (let k = 0; k < n; k++) {
      const cliente = escolher(clientes.filter((c) => c.nome !== "Clínica Vitta")); // as preventivas da clínica vêm do PMOC
      const tipo = tipoPorCliente(cliente.nome);
      const dupla = sortearDupla();
      await novaOs({
        cliente, tipo, titulo: escolher(TITULOS[tipo]), tecnicos: dupla.tecnicos, dias: d, hora: escolher([8, 9, 10, 13, 14, 15]),
        equipamentos: tipo === "instalacao" ? 1 : entre(1, 3), situacao: "CONCLUIDA", prioridade: tipo === "corretiva" && sorte() < 0.3 ? "ALTA" : "NORMAL",
        atrasoDias: sorte() < dupla.atraso ? 1 : 0, semAntesDepois: sorte() < dupla.semFoto,
        nota: escolher(dupla.notas), comentario: escolher(comentarios) ?? undefined, aceite: sorte() < 0.75 ? escolher(["LOCAL", "LOCAL", "REMOTO"] as const) : null,
        contratoId: tipo === "preventiva" ? contratos.get(cliente.nome) ?? null : null,
      });
    }
  }

  // Hoje: o dia em andamento (concluídas de manhã, uma em execução, uma em deslocamento, as da tarde)
  const H = (nome: string) => clientePorNome(nome);
  await novaOs({ cliente: H("Hotel Ipê Real"), tipo: "preventiva", titulo: "Preventiva mensal PMOC", tecnicos: [rafael, diego], dias: 0, hora: 7, equipamentos: 3, situacao: "CONCLUIDA", nota: 5, comentario: "Equipe pontual e muito cuidadosa com o ambiente.", aceite: "LOCAL", contratoId: contratos.get("Hotel Ipê Real") });
  await novaOs({ cliente: H("Casa & Estilo Móveis"), tipo: "corretiva", titulo: "Equipamento não gela", tecnicos: [thiago, igor], dias: 0, hora: 8, equipamentos: 1, situacao: "CONCLUIDA", aceite: "PENDENTE", prioridade: "ALTA" });
  await novaOs({ cliente: H("Edifício Atrium Office"), tipo: "preventiva", titulo: "Preventiva mensal dos chillers", tecnicos: [lucas], dias: 0, hora: 9, equipamentos: 2, situacao: "EM_ANDAMENTO", contratoId: contratos.get("Edifício Atrium Office") });
  await novaOs({ cliente: H("Empório Serra Dourada"), tipo: "corretiva", titulo: "Câmara fria sem atingir a temperatura", tecnicos: [thiago, igor], dias: 0, hora: 11, equipamentos: 1, situacao: "DESLOCAMENTO", prioridade: "URGENTE" });
  await novaOs({ cliente: H("Colégio Novo Horizonte"), tipo: "limpeza", titulo: "Limpeza química das serpentinas", tecnicos: [rafael, diego], dias: 0, hora: 14, equipamentos: 3, situacao: "AGENDADA", contratoId: contratos.get("Colégio Novo Horizonte") });
  await novaOs({ cliente: H("Academia Movimento"), tipo: "visita", titulo: "Visita técnica para orçamento", tecnicos: [felipe], dias: 0, hora: 15, equipamentos: 0, situacao: "AGENDADA" });

  // Futuro: o resto do mês e as duas semanas seguintes
  for (let d = 1; d <= Math.max(14, 31 - D); d++) {
    if (!util(d)) continue;
    for (let k = 0; k < entre(1, 3); k++) {
      const cliente = escolher(clientes.filter((c) => c.nome !== "Clínica Vitta"));
      const tipo = tipoPorCliente(cliente.nome);
      await novaOs({
        cliente, tipo, titulo: escolher(TITULOS[tipo]), tecnicos: sortearDupla().tecnicos, dias: d, hora: escolher([8, 9, 10, 13, 14]),
        equipamentos: tipo === "instalacao" ? 1 : entre(1, 3), situacao: "AGENDADA", contratoId: tipo === "preventiva" ? contratos.get(cliente.nome) ?? null : null,
      });
    }
  }

  /* ── PMOC da clínica: plano publicado, cronograma do próprio sistema ── */
  const clinica = clientePorNome("Clínica Vitta");
  const pmocInicio = dia(inicioDoMes - 62);
  const pmoc = await prisma.pmoc.create({
    data: {
      empresaId, clienteId: clinica.id, unidadeId: clinica.unidadeId, nome: "PMOC 2026/2027 — Clínica Vitta", status: "PUBLICADO",
      dataInicio: pmocInicio, dataExpiracao: new Date(Date.UTC(pmocInicio.getUTCFullYear() + 1, pmocInicio.getUTCMonth(), pmocInicio.getUTCDate() - 1)),
      responsavelTecnicoId: rt.id, rtNome: rt.nome.replace(/^Eng\. /, ""), rtCrea: PESSOAS[6].crea, artNumero: "ART-1020250000417", criadoPorId: usuarioId,
      descricao: "Plano de Manutenção, Operação e Controle dos sistemas de climatização da clínica (Lei 13.589/2018).",
      equipamentos: { create: clinica.equipamentos.map((e) => ({ equipamentoId: e.id })) },
      cronograma: {
        create: [
          { tipoOsId: tiposOs.get("preventiva")!, dataInicio: pmocInicio, diaExecucao: 10, intervaloMeses: 1, fimSemana: "POSTERGAR" },
          { tipoOsId: tiposOs.get("limpeza")!, dataInicio: pmocInicio, diaExecucao: 20, intervaloMeses: 6, fimSemana: "POSTERGAR" },
        ],
      },
    },
  });
  await prisma.pmocConfiguracao.create({ data: { empresaId, diasAviso: 30 } });
  // Gera desde o início do plano: os meses que já passaram também têm a OS deles (e são dados como feitos abaixo)
  const gerado = await executarCronograma(pmoc.id, { empresaId, usuarioId, podeCancelarOs: true }, "criar", new Date(pmocInicio.getTime() - 86_400_000));
  console.log(`PMOC: ${gerado?.criadas.length ?? 0} OS criadas pelo cronograma`);
  osSeq = (await maiorUsado(prisma, empresaId, "os")) + 1; // o cronograma numera pelo contador do sistema
  // As OS do PMOC que já passaram foram feitas (com relatório completo e aceite)
  const doPmoc = await prisma.ordemServico.findMany({
    where: { empresaId, pmocExecucoes: { some: { pmocId: pmoc.id } } },
    select: { id: true, atividades: { select: { id: true, dataAgendada: true, equipamentos: { select: { equipamentoId: true } } } } },
  });
  for (const os of doPmoc) {
    const a = os.atividades[0];
    if (!a?.dataAgendada || a.dataAgendada > quando(-1, 23)) continue;
    const fim = new Date(a.dataAgendada.getTime() + 150 * 60_000);
    await prisma.atividadeOs.update({ where: { id: a.id }, data: { status: "CONCLUIDA", concluidaEm: fim, tecnicoId: rafael, equipeId: equipes[0].id, veiculoId: equipes[0].veiculoId, prazo: new Date(Date.UTC(a.dataAgendada.getUTCFullYear(), a.dataAgendada.getUTCMonth(), a.dataAgendada.getUTCDate())), tecnicosEquipe: { create: [{ tecnicoId: diego }] } } });
    await prisma.ordemServico.update({ where: { id: os.id }, data: { status: "CONCLUIDA", dataInicio: a.dataAgendada, dataConclusao: fim, contratoId: contratos.get("Clínica Vitta") } });
    const eqs = a.equipamentos.map((v) => ({ id: v.equipamentoId, tipo: clinica.equipamentos.find((e) => e.id === v.equipamentoId)!.tipo }));
    await executar(a.id, eqs, null, fim, { completo: true, antesDepois: true });
    await prisma.osAceite.create({ data: { empresaId, ordemServicoId: os.id, atividadeId: a.id, token: randomBytes(24).toString("base64url"), situacao: "CONFIRMADO", metodo: "LOCAL", nome: "Helena Prado", assinatura: assinaturas[0], avaliacao: 5, confirmadoEm: new Date(fim.getTime() + 600_000) } });
  }
  // As que vêm aí ficam com a dupla da preventiva
  await prisma.atividadeOs.updateMany({ where: { empresaId, ordemServico: { pmocExecucoes: { some: { pmocId: pmoc.id } } }, status: "AGENDADA" }, data: { tecnicoId: rafael, equipeId: equipes[0].id, veiculoId: equipes[0].veiculoId } });

  /* ── orçamentos ── */
  let orcSeq = 2410;
  const servicoInstalacao = await prisma.servico.create({ data: { empresaId, nome: "Instalação de split até 24.000 BTU/h", codigo: "INST-24", valorPadrao: dec(850), unidade: "un" } });
  const servicoPreventiva = await prisma.servico.create({ data: { empresaId, nome: "Manutenção preventiva de split", codigo: "PREV-SPL", valorPadrao: dec(180), unidade: "un" } });
  await prisma.servico.create({ data: { empresaId, nome: "Limpeza química de serpentina", codigo: "LQ-SERP", valorPadrao: dec(320), unidade: "un" } });

  const produtos = new Map<string, string>();
  let codigoProduto = 101;
  for (const p of PRODUTOS) {
    const prod = await prisma.produto.create({ data: { empresaId, nome: p.nome, codigo: codigoProduto++, unidade: p.unidade, saldo: dec(p.saldo), estoqueMinimo: p.minimo, valorPadrao: dec(p.custo * 1.6), margemVenda: dec(60) } });
    produtos.set(p.nome, prod.id);
    // Histórico: a compra, as saídas para OS e o saldo de hoje
    const entrada = p.saldo + entre(2, 8);
    await prisma.movimentacaoEstoque.create({ data: { empresaId, produtoId: prod.id, tipo: "ENTRADA", origem: "COMPRA", quantidade: dec(entrada), saldoApos: dec(entrada), custoUnitario: dec(p.custo), usuarioId, data: quando(inicioDoMes - 20, 10), observacao: "Entrada por NF de compra" } });
    await prisma.movimentacaoEstoque.create({ data: { empresaId, produtoId: prod.id, tipo: "SAIDA", origem: "OS", quantidade: dec(entrada - p.saldo), saldoApos: dec(p.saldo), usuarioId, data: quando(-entre(1, 12), 16), observacao: "Consumo em OS" } });
  }

  /**
   * A OS de VITRINE (o print do painel de Atividades): a instalação gerada do orçamento aprovado, com os
   * itens do orçamento e quatro atividades em estados diferentes — vistoria e infraestrutura feitas, a
   * instalação com a equipe em deslocamento hoje e o start-up agendado.
   */
  async function osDeVitrine(orc: { id: string; codigo: string; nome: string; descricao: string | null }, cli: (typeof clientes)[number]) {
    const novos = [];
    for (const n of [7, 8, 9, 10]) {
      const tipo = tiposEquip.get("AR_CONDICIONADO_SPLIT")!;
      const eq = await prisma.equipamento.create({ data: { empresaId, unidadeId: cli.unidadeId, tipo: "AR_CONDICIONADO_SPLIT", tipoEquipamentoId: tipo.id, nome: `Split sala ${n}`, marca: "Frigotec", modelo: "FT-Inverter", capacidade: "24.000 BTU/h", setor: "Bloco novo", localizacao: "Bloco novo", fluido: "R-32", tensao: "220 V" } });
      await prisma.qrcode.create({ data: { empresaId, codigo: `QR-${qrSeq++}`, equipamentoId: eq.id } });
      novos.push({ id: eq.id, tipo: "AR_CONDICIONADO_SPLIT" as ChaveTipo, nome: eq.nome ?? "" });
    }
    const os = await prisma.ordemServico.create({
      data: {
        empresaId, numero: `OS-${osSeq++}`, clienteId: cli.id, unidadeId: cli.unidadeId, criadoPorId: usuarioId, responsavelId: usuarioId, orcamentoOrigemId: orc.id,
        descricao: descricaoDaOs(orc), prioridade: "ALTA", status: "EM_ANDAMENTO", dataInicio: quando(-1, 8), previsaoConclusao: dia(2), prazoExecucao: dia(2), criadoEm: quando(-2, 13, 33),
      },
    });
    await prisma.orcamentoOs.create({ data: { orcamentoId: orc.id, ordemServicoId: os.id } });
    const [servicos, prods] = await Promise.all([
      prisma.orcamentoServico.findMany({ where: { orcamentoId: orc.id }, orderBy: { ordem: "asc" } }),
      prisma.orcamentoProduto.findMany({ where: { orcamentoId: orc.id }, orderBy: { ordem: "asc" } }),
    ]);
    await prisma.osItemOrcamento.createMany({
      data: [
        ...servicos.map((i, ordem) => ({ ordemServicoId: os.id, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, valorTotal: i.valorTotal, orcamentoServicoId: i.id, tipo: "SERVICO" as const, servicoId: i.servicoId, ordem })),
        ...prods.map((i, ordem) => ({ ordemServicoId: os.id, descricao: i.descricao, quantidade: i.quantidade, valorUnitario: i.valorUnitario, valorTotal: i.valorTotal, tipo: "PRODUTO" as const, produtoId: i.produtoId, ordem: servicos.length + ordem })),
      ],
    });
    await prisma.osHistorico.create({ data: { ordemServicoId: os.id, usuarioId, acao: "CRIADA", detalhes: `Gerada do orçamento ${orc.codigo}`, criadoEm: os.criadoEm } });
    const etapas: { tipo: ChaveTipoOs; titulo: string; dias: number; hora: number; situacao: "CONCLUIDA" | "DESLOCAMENTO" | "AGENDADA"; equip: typeof novos; duracao: number }[] = [
      { tipo: "visita", titulo: "Vistoria e marcação dos pontos", dias: -1, hora: 8, situacao: "CONCLUIDA", equip: [], duracao: 60 },
      { tipo: "instalacao", titulo: "Infraestrutura: tubulação, dreno e elétrica", dias: -1, hora: 10, situacao: "CONCLUIDA", equip: novos, duracao: 300 },
      { tipo: "instalacao", titulo: "Instalação das evaporadoras e condensadoras", dias: 0, hora: 10, situacao: "DESLOCAMENTO", equip: novos, duracao: 360 },
      { tipo: "instalacao", titulo: "Start-up, testes e entrega ao cliente", dias: 2, hora: 9, situacao: "AGENDADA", equip: novos, duracao: 120 },
    ];
    const [responsavel, ajudante] = [felipe, igor];
    const equipe = equipeDe(felipe);
    for (const e of etapas) {
      const inicio = quando(e.dias, e.hora);
      const fim = new Date(inicio.getTime() + e.duracao * 60_000);
      const concluida = e.situacao === "CONCLUIDA";
      const a = await prisma.atividadeOs.create({
        data: {
          empresaId, ordemServicoId: os.id, tipoOsId: tiposOs.get(e.tipo)!, tecnicoId: responsavel, equipeId: equipe.id, veiculoId: equipe.veiculoId, titulo: e.titulo,
          status: concluida ? "CONCLUIDA" : "AGENDADA", dataAgendada: inicio, prazo: dia(e.dias), concluidaEm: concluida ? fim : null, duracaoMin: e.duracao,
          resumo: concluida ? (e.tipo === "visita" ? "Pontos marcados com o cliente; acesso liberado para o bloco novo." : "Tubulação de cobre, dreno e circuitos elétricos dedicados prontos nas quatro salas.") : null,
          tecnicosEquipe: { create: [{ tecnicoId: ajudante }] }, equipamentos: { create: e.equip.map((q) => ({ equipamentoId: q.id })) }, criadoEm: os.criadoEm,
        },
      });
      const avisos = e.situacao === "AGENDADA" ? [] : e.situacao === "DESLOCAMENTO" ? [["A_CAMINHO", -25]] : [["A_CAMINHO", -30], ["CHEGOU", -5]];
      for (const [evento, min] of avisos as [string, number][]) {
        const em = new Date(inicio.getTime() + min * 60_000);
        await prisma.atividadeAviso.create({ data: { empresaId, atividadeId: a.id, evento, dia: dia(e.dias), registradoEm: em, usuarioId, avisoStatus: "ENVIADO", avisoEm: em, avisoPara: cli.contato } });
      }
      if (concluida && e.equip.length) await executar(a.id, e.equip, null, fim, { completo: true, antesDepois: true });
    }
    criadas.push({ osId: os.id, atividadeId: "", equipamentos: novos.map((q) => q.id), situacao: "EM_ANDAMENTO", tecnicos: [responsavel, ajudante], cliente: cli });
    return os;
  }

  interface NovoOrc { cliente: string; nome: string; status: "RASCUNHO" | "ENVIADO" | "APROVADO" | "REPROVADO"; dias: number; servicos: { desc: string; qtd: number; valor: number; servicoId?: string }[]; produtos?: { desc: string; qtd: number; valor: number }[]; visto?: boolean; gerarOs?: boolean }
  async function novoOrcamento(o: NovoOrc) {
    const cli = clientePorNome(o.cliente);
    const totalServicos = o.servicos.reduce((s, i) => s + i.qtd * i.valor, 0);
    const totalProdutos = (o.produtos ?? []).reduce((s, i) => s + i.qtd * i.valor, 0);
    const criado = quando(o.dias, 9, 12);
    const enviado = o.status === "RASCUNHO" ? null : new Date(criado.getTime() + 40 * 60_000);
    const visto = enviado && (o.visto || o.status !== "ENVIADO") ? new Date(enviado.getTime() + 3 * 3600_000) : null;
    const aprovado = o.status === "APROVADO" ? new Date((visto ?? criado).getTime() + 26 * 60_000) : null;
    const orc = await prisma.orcamento.create({
      data: {
        empresaId, codigo: `ORC-${orcSeq++}`, nome: o.nome, clienteId: cli.id, unidadeId: cli.unidadeId, criadoPorId: usuarioId, tokenPublico: randomBytes(18).toString("base64url"),
        status: o.status, validadeEm: dia(o.dias + 10), totalServicos: dec(totalServicos), totalProdutos: dec(totalProdutos), totalGeral: dec(totalServicos + totalProdutos),
        descricao: o.nome, condicaoPagamento: "30 dias", formaPagamento: "Boleto ou Pix", prazoExecucao: "Até 5 dias úteis após a aprovação",
        garantiaServico: "90 dias", garantiaPecas: "Conforme o fabricante", criadoEm: criado, enviadoEm: enviado, visualizadoEm: visto, visualizacoes: visto ? entre(1, 3) : 0,
        assinadoEm: aprovado, assinadoPor: aprovado ? cli.contato.replace(/^(Dra?\.|Sra?\.|Prof\.|Eng\.) /, "").replace(/ \(.*\)$/, "") : null, aprovadoIp: aprovado ? "203.0.113.57" : null,
        recusadoEm: o.status === "REPROVADO" ? new Date((visto ?? criado).getTime() + 86_400_000) : null, recusaMotivo: o.status === "REPROVADO" ? "Projeto adiado ou cancelado" : null,
        servicos: { create: o.servicos.map((s, ordem) => ({ descricao: s.desc, quantidade: dec(s.qtd), valorUnitario: dec(s.valor), valorTotal: dec(s.qtd * s.valor), servicoId: s.servicoId ?? null, ordem })) },
        produtos: { create: (o.produtos ?? []).map((p, ordem) => ({ descricao: p.desc, quantidade: dec(p.qtd), valorUnitario: dec(p.valor), valorTotal: dec(p.qtd * p.valor), produtoId: produtos.get(p.desc) ?? null, ordem })) },
      },
    });
    const eventos: { tipo: string; em: Date; detalhe?: string; usuario?: boolean; ip?: string }[] = [];
    if (enviado) eventos.push({ tipo: "ENVIADO_WHATSAPP", em: enviado, usuario: true });
    if (visto) eventos.push({ tipo: "VISUALIZADO", em: visto, ip: "203.0.113.57" });
    if (aprovado) eventos.push({ tipo: "APROVADO", em: aprovado, detalhe: orc.assinadoPor ?? undefined, ip: "203.0.113.57" });
    if (o.status === "REPROVADO") eventos.push({ tipo: "RECUSADO", em: orc.recusadoEm!, detalhe: "Projeto adiado ou cancelado" });
    let osGerada: string | null = null;
    if (aprovado && o.gerarOs) {
      const os = await osDeVitrine(orc, cli);
      osGerada = os.numero;
      eventos.push({ tipo: "OS_GERADA", em: new Date(aprovado.getTime() + 15 * 60_000), detalhe: os.numero, usuario: true });
    }
    for (const e of eventos) {
      await prisma.orcamentoEvento.create({ data: { empresaId, orcamentoId: orc.id, tipo: e.tipo, detalhe: e.detalhe ?? null, usuarioId: e.usuario ? usuarioId : null, ip: e.ip ?? null, criadoEm: e.em } });
    }
    return { orc, osGerada };
  }
  const aprovado = await novoOrcamento({
    cliente: "Colégio Novo Horizonte", nome: "Instalação de 4 splits 24.000 BTU/h — bloco novo", status: "APROVADO", dias: -2, gerarOs: true,
    servicos: [{ desc: "Instalação de split até 24.000 BTU/h", qtd: 4, valor: 850, servicoId: servicoInstalacao.id }, { desc: "Infraestrutura elétrica dedicada (por ponto)", qtd: 4, valor: 260 }],
    produtos: [{ desc: "Tubo de cobre 3/8\" (rolo 15 m)", qtd: 2, valor: 728 }, { desc: "Suporte para condensadora 500 mm", qtd: 4, valor: 102.4 }, { desc: "Isolamento térmico 3/8\" (barra 2 m)", qtd: 16, valor: 15.2 }],
  });
  await novoOrcamento({ cliente: "Edifício Atrium Office", nome: "Retrofit do VRF do 4º andar", status: "ENVIADO", dias: -4, visto: true, servicos: [{ desc: "Substituição de compressor do VRF", qtd: 1, valor: 18_400 }, { desc: "Recolhimento e recarga de fluido", qtd: 1, valor: 2_900 }] });
  await novoOrcamento({ cliente: "Hotel Ipê Real", nome: "Manutenção preventiva — apartamentos do 2º andar", status: "ENVIADO", dias: -1, servicos: [{ desc: "Manutenção preventiva de split", qtd: 12, valor: 180, servicoId: servicoPreventiva.id }] });
  await novoOrcamento({ cliente: "Academia Movimento", nome: "Contrato de manutenção preventiva mensal", status: "RASCUNHO", dias: 0, servicos: [{ desc: "Manutenção preventiva mensal (3 equipamentos)", qtd: 1, valor: 890 }] });
  await novoOrcamento({ cliente: "Empório Serra Dourada", nome: "Troca do evaporador da câmara de congelados", status: "APROVADO", dias: -9, servicos: [{ desc: "Substituição de evaporador de câmara fria", qtd: 1, valor: 4_350 }] });
  await novoOrcamento({ cliente: "Casa & Estilo Móveis", nome: "Instalação de cassete no showroom novo", status: "REPROVADO", dias: -12, servicos: [{ desc: "Instalação de cassete 48.000 BTU/h", qtd: 1, valor: 2_680 }] });
  await novoOrcamento({ cliente: "Cond. Bosque dos Ipês", nome: "Limpeza química dos equipamentos das áreas comuns", status: "APROVADO", dias: -15, servicos: [{ desc: "Limpeza química de serpentina", qtd: 4, valor: 320 }] });
  await novoOrcamento({ cliente: "Clínica Vitta", nome: "Split novo para a sala de laudos 2", status: "ENVIADO", dias: -6, visto: true, servicos: [{ desc: "Instalação de split até 24.000 BTU/h", qtd: 1, valor: 850, servicoId: servicoInstalacao.id }], produtos: [{ desc: "Suporte para condensadora 500 mm", qtd: 1, valor: 102.4 }] });
  console.log(`Orçamento aprovado: ${aprovado.orc.codigo} → ${aprovado.osGerada}`);

  /* ── financeiro: 6 meses de contratos recebidos e contas pagas ── */
  const categorias = new Map<string, string>();
  for (const [nome, cor] of [["Contratos de manutenção", "#0E7490"], ["Serviços avulsos", "#15803D"], ["Materiais e peças", "#B45309"], ["Combustível", "#475569"], ["Aluguel", "#6D28D9"], ["Ferramentas", "#0F766E"]] as const) {
    categorias.set(nome, (await prisma.categoriaFinanceira.create({ data: { empresaId, nome, cor } })).id);
  }
  const banco = await prisma.contaBancaria.create({ data: { empresaId, nome: "Conta principal", banco: "Banco Exemplo", agencia: "0001", conta: "12345-6" } });
  let crSeq = 900, cpSeq = 610;
  for (let m = -5; m <= 0; m++) {
    const venc = new Date(Date.UTC(Y, M + m, 10, 12));
    const pago = m < 0 || D > 10;
    for (const c of CONTRATOS.filter((x) => x.status === "ATIVO" && x.desde <= m * 30 + D)) {
      const cli = clientePorNome(c.cliente);
      const recebido = pago;
      const cr = await prisma.contaReceber.create({
        data: {
          empresaId, clienteId: cli.id, numero: `CR-${crSeq++}`, descricao: `Contrato de manutenção — ${c.cliente}`, valor: dec(c.valor), contratoId: contratos.get(c.cliente),
          refMes: venc.getUTCMonth() + 1, refAno: venc.getUTCFullYear(), dataVencimento: venc, status: recebido ? "RECEBIDO" : "A_RECEBER",
          dataRecebimento: recebido ? new Date(venc.getTime() - 86_400_000) : null, valorRecebido: dec(recebido ? c.valor : 0), formaPagamento: "BOLETO",
          categoriaId: categorias.get("Contratos de manutenção"), contaBancariaId: banco.id,
        },
      });
      if (recebido) await prisma.contaReceberRecebimento.create({ data: { empresaId, contaReceberId: cr.id, valor: dec(c.valor), data: new Date(venc.getTime() - 86_400_000), formaPagamento: "BOLETO", contaBancariaId: banco.id, usuarioId } });
    }
    // Serviços avulsos do mês
    for (let k = 0; k < entre(2, 4); k++) {
      const cli = escolher(clientes);
      const valor = entre(6, 48) * 100 + 50;
      const data = new Date(Date.UTC(Y, M + m, entre(3, 26), 15));
      const recebido = data < agora;
      const cr = await prisma.contaReceber.create({
        data: { empresaId, clienteId: cli.id, numero: `CR-${crSeq++}`, descricao: `Serviço avulso — ${cli.nome}`, valor: dec(valor), dataVencimento: data, status: recebido ? "RECEBIDO" : "A_RECEBER", dataRecebimento: recebido ? data : null, valorRecebido: dec(recebido ? valor : 0), formaPagamento: "PIX", categoriaId: categorias.get("Serviços avulsos"), contaBancariaId: banco.id },
      });
      if (recebido) await prisma.contaReceberRecebimento.create({ data: { empresaId, contaReceberId: cr.id, valor: dec(valor), data, formaPagamento: "PIX", contaBancariaId: banco.id, usuarioId } });
    }
    // Despesas do mês
    const despesas: [string, string, number, number][] = [
      ["Imobiliária Exemplo", "Aluguel", 4200, 5], ["Distribuidora de Gases Exemplo", "Materiais e peças", entre(28, 55) * 100, 12],
      ["Posto Exemplo", "Combustível", entre(14, 22) * 100, 20], ["Casa das Ferramentas Exemplo", "Ferramentas", entre(3, 9) * 100, 24],
    ];
    for (const [fornecedor, cat, valor, diaVenc] of despesas) {
      const venc2 = new Date(Date.UTC(Y, M + m, diaVenc, 12));
      const pagoCp = venc2 < agora;
      const cp = await prisma.contaPagar.create({
        data: { empresaId, numero: `CP-${cpSeq++}`, fornecedor, descricao: `${cat} — ${String(venc2.getUTCMonth() + 1).padStart(2, "0")}/${venc2.getUTCFullYear()}`, valorTotal: dec(valor), valorPago: dec(pagoCp ? valor : 0), saldoRestante: dec(pagoCp ? 0 : valor), status: pagoCp ? "PAGO_TOTAL" : "PENDENTE", dataVencimento: venc2, dataPagamento: pagoCp ? venc2 : null, formaPagamento: "PIX", categoriaId: categorias.get(cat) },
      });
      if (pagoCp) await prisma.pagamentoContaPagar.create({ data: { contaPagarId: cp.id, valor: dec(valor), dataPagamento: venc2, formaPagamento: "PIX" } });
    }
  }
  // O que vence nos próximos dias
  for (const [fornecedor, cat, valor, dias] of [["Distribuidora de Gases Exemplo", "Materiais e peças", 3_840, 2], ["Posto Exemplo", "Combustível", 1_260, 4], ["Imobiliária Exemplo", "Aluguel", 4_200, 9]] as const) {
    await prisma.contaPagar.create({ data: { empresaId, numero: `CP-${cpSeq++}`, fornecedor, descricao: `${cat} — a vencer`, valorTotal: dec(valor), saldoRestante: dec(valor), status: "PENDENTE", dataVencimento: quando(dias, 12), formaPagamento: "BOLETO", categoriaId: categorias.get(cat) } });
  }
  // E o que entra até o fim do mês (serviços avulsos já concluídos, a receber)
  const ultimoDia = new Date(Date.UTC(Y, M + 1, 0)).getUTCDate();
  for (const [cliente, valor, dias] of [["Hotel Ipê Real", 3_280, 2], ["Edifício Atrium Office", 5_940, 3]] as const) {
    const cli = clientePorNome(cliente);
    await prisma.contaReceber.create({ data: { empresaId, clienteId: cli.id, numero: `CR-${crSeq++}`, descricao: `Serviço avulso — ${cliente}`, valor: dec(valor), dataVencimento: quando(Math.min(dias, ultimoDia - D), 12), status: "A_RECEBER", formaPagamento: "BOLETO", categoriaId: categorias.get("Serviços avulsos"), contaBancariaId: banco.id } });
  }
  // O orçamento aprovado vira conta a receber (faturado na conclusão)
  await prisma.contaReceber.create({ data: { empresaId, clienteId: clientePorNome("Colégio Novo Horizonte").id, numero: `CR-${crSeq++}`, descricao: `${aprovado.orc.codigo} — ${aprovado.orc.nome}`, valor: aprovado.orc.totalGeral, orcamentoId: aprovado.orc.id, dataVencimento: dia(25), status: "PREVISTO", categoriaId: categorias.get("Serviços avulsos") } });

  /* ── desempenho: um perfil para o time de campo, a regra e o prêmio do mês ── */
  const competencia = `${Y}-${String(M + 1).padStart(2, "0")}`;
  const competenciaAnterior = `${M === 0 ? Y - 1 : Y}-${String(M === 0 ? 12 : M).padStart(2, "0")}`;
  await prisma.desempenhoConfig.create({ data: { empresaId, criadoEm: quando(inicioDoMes - 40), tvToken: randomBytes(24).toString("base64url") } });
  const perfil = await prisma.desempenhoPerfil.create({ data: { empresaId, nome: "Técnicos de campo", tipo: "TECNICO", ordem: 0 } });
  const encarregado = await prisma.desempenhoPerfil.create({ data: { empresaId, nome: "Encarregado", tipo: "GESTAO", ordem: 1 } });
  await prisma.desempenhoRegra.create({
    data: {
      empresaId, perfilId: perfil.id, vigenteDesde: competenciaAnterior, pesoPrazo: 40, pesoRelatorio: 35, pesoAvaliacao: 25, metaMinima: 75,
      exigirFotoAntesDepois: true, penalidadeRetorno: 5, penalidadeReclamacao: 5, criadoPorId: usuarioId,
      faixas: [{ nome: "Bronze", minimo: 80, valor: 150 }, { nome: "Prata", minimo: 88, valor: 300 }, { nome: "Ouro", minimo: 95, valor: 500 }],
    },
  });
  for (const t of campo) await prisma.desempenhoParticipante.create({ data: { empresaId, tecnicoId: t.id, perfilId: perfil.id } });
  await prisma.desempenhoParticipante.create({ data: { empresaId, tecnicoId: rt.id, perfilId: encarregado.id } });
  await prisma.desempenhoPremiacao.create({ data: { empresaId, competencia, perfilId: perfil.id, titulo: "Fim de semana em pousada para o 1º lugar", descricao: "Para o técnico com o maior escore do mês, acima da meta.", criadoPorId: usuarioId } });

  /* ── mapa: a última posição de quem está em campo hoje ── */
  const posicoes: [string, string, number, number][] = [
    [rafael, "Hotel Ipê Real", 0.0009, -0.0006], [diego, "Hotel Ipê Real", 0.0011, -0.0004], [lucas, "Edifício Atrium Office", -0.0004, 0.0007],
    [thiago, "Empório Serra Dourada", 0.012, -0.009], [igor, "Empório Serra Dourada", 0.0125, -0.0088], [felipe, "Academia Movimento", -0.006, 0.004],
  ];
  for (const [i, [tecnicoId, onde, dLat, dLng]] of posicoes.entries()) {
    const c = clientePorNome(onde);
    await prisma.tecnicoPosicao.create({ data: { empresaId, tecnicoId, latitude: c.lat + dLat, longitude: c.lng + dLng, registradoEm: new Date(agora.getTime() - (4 + i * 7) * 60_000), motivo: i === 3 || i === 4 ? "PERIODICO" : "CHEGUEI", precisaoM: 8 + i * 2, bateria: 92 - i * 9 } });
  }

  const total = await prisma.ordemServico.count({ where: { empresaId } });
  console.log(`Pronto: ${clientes.length} clientes, ${campo.length} técnicos, ${total} OS. Entrar com ${LOGIN_GESTORA.email} (senha de demonstração).`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
