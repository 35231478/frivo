/**
 * NFS-e — a empresa como emitente no PlugNotas: carregar o que a tela mostra, salvar os dados
 * fiscais (+ certificado A1) e cadastrar/atualizar o emitente lá, e "Testar conexão".
 * Empresa SEMPRE a da sessão (quem chama passa). O .pfx e a senha só existem na memória desta
 * requisição: são lidos, enviados ao PlugNotas e descartados — nunca gravados nem logados.
 * O login/senha da prefeitura (nfse.config.prefeitura) precisa ser reenviado a cada PATCH, então
 * fica guardado SÓ criptografado (AES-256-GCM, lib/crypto) e nunca volta para a tela nem para o log.
 */
import { prisma } from "@/lib/prisma";
import { criptografar, descriptografar } from "@/lib/crypto";
import { formatarCpfCnpj, formatarData } from "@/lib/utils";
import { ErroCertificado, lerCertificadoA1 } from "@/lib/nfse/certificado";
import { situacaoWebhook } from "@/lib/nfse/webhook-server";
import { ambienteDisponivel, consultarCertificado, consultarEmpresa, enviarCertificado, ErroPlugNotas, salvarEmpresa } from "@/lib/nfse/plugnotas";
import {
  corpoEmpresaPlugNotas, LABEL_AMBIENTE, LABEL_STATUS, pendenciasEmitente, prefeituraPlugNotas, situacaoCertificado, soDigitos,
  type Ambiente, type CredencialPrefeitura, type DadosFiscais, type RegimeEspecial, type Regime, type StatusEmitente,
} from "@/lib/nfse/regras";

export class ErroFiscal extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const SELECT_EMPRESA = {
  cnpj: true, nome: true, nomeFantasia: true, email: true, telefone: true,
  endereco: true, numero: true, complemento: true, bairro: true, cidade: true, estado: true, cep: true,
  inscricaoMunicipal: true, inscricaoEstadual: true,
} as const;

async function carregarTudo(empresaId: string) {
  const empresa = await prisma.empresa.findUniqueOrThrow({ where: { id: empresaId }, select: { ...SELECT_EMPRESA, fiscal: true } });
  const { fiscal, ...dadosEmpresa } = empresa;
  return { empresa: dadosEmpresa, fiscal };
}
type Fiscal = NonNullable<Awaited<ReturnType<typeof carregarTudo>>["fiscal"]>;

const dadosDe = (f: Fiscal | null): DadosFiscais => ({
  regimeTributario: (f?.regimeTributario as Regime | null) ?? null,
  regimeEspecial: (f?.regimeEspecial as RegimeEspecial | null) ?? null,
  incentivoFiscal: f?.incentivoFiscal ?? false,
  incentivadorCultural: f?.incentivadorCultural ?? false,
  ambiente: (f?.ambiente as Ambiente) ?? "HOMOLOGACAO",
  codigoMunicipio: f?.codigoMunicipio ?? null,
  municipioNome: f?.municipioNome ?? null,
  municipioUf: f?.municipioUf ?? null,
});

/** Credencial da prefeitura guardada: decifra o JSON { login?, senha? }; ilegível (chave trocada, dado corrompido) = null */
function lerPrefeitura(cripto: string | null | undefined): CredencialPrefeitura | null {
  const texto = descriptografar(cripto);
  if (!texto) return null;
  try {
    const c = JSON.parse(texto) as CredencialPrefeitura;
    return prefeituraPlugNotas(c) ?? null;
  } catch {
    return null;
  }
}

/** O que a tela "Dados fiscais" recebe (nunca o certificado nem a senha: eles nem existem aqui) */
export async function carregarEmitente(empresaId: string) {
  const { empresa, fiscal } = await carregarTudo(empresaId);
  const dados = dadosDe(fiscal);
  const status = (fiscal?.status as StatusEmitente) ?? "NAO_CONFIGURADO";
  const sit = situacaoCertificado(fiscal?.certificadoValidoAte ?? null);
  return {
    dados: { ...dados, inscricaoMunicipal: empresa.inscricaoMunicipal ?? "" },
    empresa: {
      cnpj: empresa.cnpj, nome: empresa.nome,
      endereco: [empresa.endereco, empresa.numero, empresa.bairro].filter(Boolean).join(", "),
      cidade: empresa.cidade ?? "", estado: empresa.estado ?? "", cep: empresa.cep ?? "",
    },
    status, statusLabel: LABEL_STATUS[status],
    emitente: fiscal?.emitenteCnpj
      ? { cnpj: fiscal.emitenteCnpj, ambiente: fiscal.emitenteAmbiente as Ambiente, sincronizadoEm: fiscal.emitenteSincronizadoEm?.toISOString() ?? null }
      : null,
    certificado: fiscal?.certificadoId
      ? {
          titular: fiscal.certificadoTitular, cnpj: fiscal.certificadoCnpj,
          validoAte: fiscal.certificadoValidoAte?.toISOString() ?? null, enviadoEm: fiscal.certificadoEnviadoEm?.toISOString() ?? null,
          dias: sit?.dias ?? null, vencido: sit?.vencido ?? false, vencendo: sit?.vencendo ?? false,
        }
      : null,
    // da prefeitura, só SE há login/senha guardados (nunca os valores)
    prefeitura: (() => {
      if (!fiscal?.prefeituraCripto) return null;
      const c = lerPrefeitura(fiscal.prefeituraCripto);
      return { temLogin: !!c?.login, temSenha: !!c?.senha, ilegivel: !c, atualizadaEm: fiscal.prefeituraAtualizadaEm?.toISOString() ?? null };
    })(),
    ultimoErro: fiscal?.ultimoErro ?? null,
    ultimoTeste: fiscal?.ultimoTesteEm ? { em: fiscal.ultimoTesteEm.toISOString(), ok: !!fiscal.ultimoTesteOk, mensagem: fiscal.ultimoTesteMensagem } : null,
    pendencias: pendenciasEmitente(empresa, dados, !!fiscal?.certificadoId),
    webhook: situacaoWebhook(fiscal),
    ambientesDisponiveis: { HOMOLOGACAO: ambienteDisponivel("HOMOLOGACAO"), PRODUCAO: ambienteDisponivel("PRODUCAO") },
  };
}
export type EmitenteTela = Awaited<ReturnType<typeof carregarEmitente>>;

export interface CertificadoEnviado { arquivo: Buffer; nome: string; senha: string }

/**
 * Salva os dados fiscais e, se não faltar nada, cadastra/atualiza o emitente no PlugNotas.
 * Erro de validação (certificado, ambiente) = ErroFiscal e nada é gravado. Erro do PlugNotas =
 * os dados ficam salvos com status ERRO e a mensagem (dá para corrigir e salvar de novo).
 */
export async function salvarEmitente(p: {
  empresaId: string; usuarioId: string; dados: DadosFiscais; inscricaoMunicipal: string; certificado?: CertificadoEnviado | null;
  /** Login/senha do portal da prefeitura digitados agora (vazio = manter o que está guardado) */
  prefeitura?: CredencialPrefeitura | null;
  /** Apagar a credencial guardada (só vale se nada novo foi digitado) */
  removerPrefeitura?: boolean;
}) {
  const { empresa, fiscal } = await carregarTudo(p.empresaId);
  const agora = new Date();

  // 1) Certificado novo: abre aqui, em memória (senha, validade, CNPJ) antes de qualquer envio
  let lido: ReturnType<typeof lerCertificadoA1> | null = null;
  if (p.certificado) {
    if (!p.certificado.senha) throw new ErroFiscal("Informe a senha do certificado.");
    try {
      lido = lerCertificadoA1(p.certificado.arquivo, p.certificado.senha);
    } catch (e) {
      if (e instanceof ErroCertificado) throw new ErroFiscal(e.message);
      throw e;
    }
    if (lido.validoAte.getTime() < agora.getTime()) throw new ErroFiscal(`Certificado vencido em ${formatarData(lido.validoAte)}: renove o A1 e envie o novo.`);
    if (lido.validoDe.getTime() > agora.getTime()) throw new ErroFiscal(`Este certificado só passa a valer em ${formatarData(lido.validoDe)}.`);
    const cnpjEmpresa = soDigitos(empresa.cnpj);
    if (lido.cnpj && lido.cnpj !== cnpjEmpresa) {
      throw new ErroFiscal(`O certificado é do CNPJ ${formatarCpfCnpj(lido.cnpj)}, mas a empresa é ${formatarCpfCnpj(cnpjEmpresa)}. Envie o certificado desta empresa.`);
    }
  }

  // 2) Ambiente: produção só com o servidor liberado; trocar de ambiente exige reenviar o certificado
  if (p.dados.ambiente === "PRODUCAO" && !ambienteDisponivel("PRODUCAO")) {
    throw new ErroFiscal("Produção ainda não está liberada neste servidor. Mantenha em homologação.");
  }
  if (!lido && fiscal?.certificadoId && fiscal.ambiente !== p.dados.ambiente) {
    throw new ErroFiscal(`Para mudar para ${LABEL_AMBIENTE[p.dados.ambiente].toLowerCase()}, envie o certificado de novo (cada ambiente do PlugNotas tem o seu cadastro).`);
  }

  // 3) Credencial da prefeitura: a digitada agora (cifrada antes de gravar) > remover > a guardada
  const novaPrefeitura = prefeituraPlugNotas(p.prefeitura);
  let prefeituraCripto: string | null | undefined;
  if (novaPrefeitura) {
    try {
      prefeituraCripto = criptografar(JSON.stringify(novaPrefeitura));
    } catch {
      throw new ErroFiscal("O servidor não tem a chave de criptografia (ENCRYPTION_KEY) para guardar a senha da prefeitura.", 503);
    }
  } else if (p.removerPrefeitura) prefeituraCripto = null;
  const credencialPrefeitura = novaPrefeitura ?? (p.removerPrefeitura ? null : lerPrefeitura(fiscal?.prefeituraCripto));

  // 4) Grava os dados (o que a pessoa digitou não se perde se o PlugNotas falhar)
  const im = p.inscricaoMunicipal.trim() || null;
  await prisma.empresa.update({ where: { id: p.empresaId }, data: { inscricaoMunicipal: im } });
  const base = {
    regimeTributario: p.dados.regimeTributario, regimeEspecial: p.dados.regimeTributario === "MEI" ? null : p.dados.regimeEspecial,
    incentivoFiscal: p.dados.incentivoFiscal, incentivadorCultural: p.dados.incentivadorCultural, ambiente: p.dados.ambiente,
    codigoMunicipio: p.dados.codigoMunicipio, municipioNome: p.dados.municipioNome?.trim() || null, municipioUf: p.dados.municipioUf?.toUpperCase() || null,
    atualizadoPorId: p.usuarioId,
    ...(prefeituraCripto !== undefined ? { prefeituraCripto, prefeituraAtualizadaEm: prefeituraCripto ? new Date() : null } : {}),
  };
  await prisma.empresaFiscal.upsert({
    where: { empresaId: p.empresaId },
    create: { empresaId: p.empresaId, ...base, status: "PENDENTE" },
    update: base,
  });

  // 5) Falta algo? Fica PENDENTE (sem chamar o PlugNotas)
  const empresaAtual = { ...empresa, inscricaoMunicipal: im };
  const dados = { ...p.dados, regimeEspecial: base.regimeEspecial as RegimeEspecial | null };
  const pendencias = pendenciasEmitente(empresaAtual, dados, !!lido || !!fiscal?.certificadoId);
  if (pendencias.length) {
    await prisma.empresaFiscal.update({ where: { empresaId: p.empresaId }, data: { status: "PENDENTE" } });
    return { sincronizado: false as const, pendencias, mensagem: "Dados salvos. Ainda falta preencher o que está na lista para cadastrar no PlugNotas." };
  }

  // 6) PlugNotas: certificado (se veio) → emitente (cadastra ou atualiza)
  const ambiente = p.dados.ambiente;
  const cnpj = soDigitos(empresa.cnpj);
  try {
    let certificadoId = fiscal?.certificadoId ?? null;
    if (lido && p.certificado) {
      certificadoId = (await enviarCertificado(ambiente, p.certificado.arquivo, p.certificado.nome, p.certificado.senha)).id;
      // já guarda a referência: se o cadastro do emitente falhar, não precisa reenviar o arquivo
      await prisma.empresaFiscal.update({
        where: { empresaId: p.empresaId },
        data: { certificadoId, certificadoTitular: lido.titular, certificadoCnpj: lido.cnpj, certificadoValidoAte: lido.validoAte, certificadoEnviadoEm: new Date() },
      });
    }
    const existe = !!(await consultarEmpresa(ambiente, cnpj));
    const acao = await salvarEmpresa(ambiente, corpoEmpresaPlugNotas(empresaAtual, dados, certificadoId!, credencialPrefeitura), existe);
    await prisma.empresaFiscal.update({
      where: { empresaId: p.empresaId },
      data: { emitenteCnpj: cnpj, emitenteAmbiente: ambiente, emitenteSincronizadoEm: new Date(), status: "ATIVO", ultimoErro: null },
    });
    return {
      sincronizado: true as const, pendencias: [],
      mensagem: `Emitente ${acao} no PlugNotas (${LABEL_AMBIENTE[ambiente].toLowerCase()}).`,
    };
  } catch (e) {
    if (!(e instanceof ErroPlugNotas)) throw e;
    await prisma.empresaFiscal.update({ where: { empresaId: p.empresaId }, data: { status: "ERRO", ultimoErro: e.message } });
    return { sincronizado: false as const, pendencias: [], erro: e.message, mensagem: e.message };
  }
}

/** "Testar conexão": o emitente existe no PlugNotas e o certificado lá está válido? */
export async function testarEmitente(empresaId: string) {
  const { fiscal } = await carregarTudo(empresaId);
  if (!fiscal?.emitenteCnpj || !fiscal.emitenteAmbiente) throw new ErroFiscal("Salve os dados fiscais e o certificado primeiro: o emitente ainda não foi cadastrado no PlugNotas.");
  const ambiente = fiscal.emitenteAmbiente as Ambiente;
  const nomeAmb = LABEL_AMBIENTE[ambiente].toLowerCase();
  let ok = false, mensagem: string;
  let validoAte = fiscal.certificadoValidoAte;
  try {
    const emp = await consultarEmpresa(ambiente, fiscal.emitenteCnpj);
    if (!emp) {
      mensagem = `A empresa ${formatarCpfCnpj(fiscal.emitenteCnpj)} não está cadastrada no PlugNotas (${nomeAmb}). Salve os dados fiscais de novo.`;
    } else {
      if (fiscal.certificadoId) validoAte = (await consultarCertificado(ambiente, fiscal.certificadoId)).vencimento ?? validoAte;
      const sit = situacaoCertificado(validoAte ?? null);
      if (sit?.vencido) {
        mensagem = `O certificado venceu em ${formatarData(validoAte!)}: renove o A1 e envie o novo.`;
      } else {
        ok = true;
        mensagem = `Conexão OK: emitente ${formatarCpfCnpj(fiscal.emitenteCnpj)} ativo no PlugNotas (${nomeAmb})`
          + (validoAte ? `; certificado válido até ${formatarData(validoAte)}${sit?.vencendo ? ` (faltam ${sit.dias} dias: providencie a renovação)` : ""}.` : ".");
      }
    }
  } catch (e) {
    if (!(e instanceof ErroPlugNotas)) throw e;
    mensagem = e.message;
  }
  await prisma.empresaFiscal.update({
    where: { empresaId },
    data: {
      ultimoTesteEm: new Date(), ultimoTesteOk: ok, ultimoTesteMensagem: mensagem,
      status: ok ? "ATIVO" : "ERRO", ultimoErro: ok ? null : mensagem, certificadoValidoAte: validoAte,
    },
  });
  return { ok, mensagem };
}
