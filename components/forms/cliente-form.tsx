"use client";

import { useState, useEffect, useRef } from "react";
import { toast } from "@/components/ui/avisos";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { marcarFormularioSalvo } from "@/lib/ui/sair-sem-salvar";
import { clienteSchema, type ClienteInput } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { enderecoDoCep } from "@/lib/cep";
import { cnpjValido } from "@/lib/documento";
import { CampoCep } from "@/components/ui/campo-cep";
import { enderecoDaConsulta, temEndereco, CAMPOS_ENDERECO } from "@/lib/clientes/endereco-principal";
import { itensDoNovo, sinaisDoCliente, veFinanceiroDoCliente } from "@/lib/clientes/cabecalho";
import { CabecalhoCliente, subtituloDoCliente } from "@/components/clientes/cabecalho-cliente";
import { HistoricoCliente } from "@/components/clientes/historico-cliente";
import { PhoneInput } from "@/components/ui/phone-input";
import { WhatsAppInput } from "@/components/ui/whatsapp-input";
import { EmailsInput } from "@/components/ui/emails-input";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { ErrosDoFormulario, IndicadorErroAba, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";
import { formatoDoDocumento, MSG_FORMATO } from "@/lib/forms/erros";
import { UnidadesManager } from "@/components/forms/unidades-manager";
import { UnidadesLocal, type UnidadeLocal } from "@/components/forms/unidades-local";
import { mesclarContato, type ContatoConsulta } from "@/lib/cadastros/autofill-cnpj";
import { AnexosManager } from "@/components/forms/anexos-manager";
import { AtendimentoCliente } from "@/components/forms/atendimento-cliente";
import { AnexosLocal, type AnexoLocal } from "@/components/forms/anexos-local";
import { LogoUpload } from "@/components/forms/logo-upload";
import { ContatosManager } from "@/components/forms/contatos-manager";
import { ContatosLocal, novoContatoLocal, type ContatoLocal } from "@/components/forms/contatos-local";
import { ComunicacaoPreferencias } from "@/components/forms/comunicacao-preferencias";
import { PortalContatos } from "@/components/forms/portal-contatos";
import { ToggleSwitch, ToggleGroup } from "@/components/ui/toggle-switch";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { InativarRegistro } from "@/components/ui/inativar-registro";
import { cn } from "@/lib/utils";
import { DICA_MODO_PEDIDO, MODOS_PEDIDO, ROTULO_MODO_PEDIDO, camposDoModo, modoDoCliente, type ModoPedido } from "@/lib/pedido-cliente/regra";
import { SeletorCadastro, useCadastro } from "@/components/cadastros/seletor-cadastro";
import type { Cliente, Tecnico, Unidade, Configuracao, ContatoCliente } from "@prisma/client";
import type { ContatoSeguro } from "@/lib/contato-cliente";
import {
  Search, FileCheck, Lock, Pencil, FileText, MapPin, Headset, History,
  Building2, DollarSign, Users, Paperclip, Globe, Send, ClipboardList, Receipt, ChevronDown, Wallet,
} from "lucide-react";
import { AlertaPerdasCliente, type PerdasCliente } from "@/components/financeiro/alerta-perdas-cliente";
import { FichaCliente } from "@/components/clientes/ficha-cliente";
import { NomeNaTrilha } from "@/components/layout/nome-na-trilha";
import type { ResumoSatisfacao } from "@/lib/clientes/satisfacao";

type ResponsavelItem = Pick<Tecnico, "id" | "nome" | "crea">;
type AnexoItem = { id: string; nome: string; tipo: string; tamanho: number; criadoEm: string | Date };
type InteracaoItem = { id: string; tipo: string; descricao: string; criadoEm: string | Date; usuario: { id: string; nome: string } };

interface ClienteFormProps {
  initialData?: Cliente & {
    responsavelTecnico?: ResponsavelItem | null;
    unidades?: Unidade[];
    anexos?: AnexoItem[];
    contatosCliente?: ContatoSeguro<ContatoCliente>[];
    unidadesInativas?: Unidade[];
    contatosInativos?: ContatoSeguro<ContatoCliente>[];
    interacoes?: InteracaoItem[];
    _count?: { contratos: number };
  };
  /** Total a receber nos próximos 30 dias (parcelas em aberto): o sinal só aparece com valor */
  totalProximos30Dias?: number;
  /** Quanto está em atraso (parcelas vencidas em aberto): "Inadimplente" só aparece com valor */
  valorEmAtraso?: number;
  /** Há atraso? (quem não vê o financeiro recebe só isto, sem os valores: "Inadimplente" sem o valor) */
  emAtraso?: boolean;
  /** Perdas (inadimplência) nos últimos 12 meses: alerta informativo, não bloqueia */
  perdas12m?: PerdasCliente | null;
  /** FICHA em modo consulta (/clientes/[id]): o cadastro como texto, "Editar" como ação */
  consulta?: boolean;
  /** Aba aberta ao chegar (?aba=), para "Editar" manter a aba em que a pessoa estava */
  abaInicial?: string;
  /** A satisfação de verdade: a média das notas do aceite das OS do cliente (lib/clientes/satisfacao) */
  satisfacaoAceite?: ResumoSatisfacao | null;
}

const IDS_ABAS = ["geral", "enderecos", "historico", "atendimento", "comunicacao", "portal", "documentos"];
/** Links antigos (?aba=relacionamento): a aba virou o Histórico automático */
const ABA_ANTIGA: Record<string, string> = { relacionamento: "historico" };

const ESTADOS_BR = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];
const DICA_ENDERECO_PRINCIPAL = "O endereço de cobrança, que vai na nota fiscal. A consulta do CNPJ preenche os campos vazios; o CEP completa a rua, o bairro e a cidade.";
const DICA_LOCAIS = "Onde o serviço acontece: cada local tem seus equipamentos, OS, contratos e PMOC. O Principal é o padrão das telas.";

// Mapeia cada campo à aba onde ele está: o ponto vermelho da aba e o "abre a aba sozinha" (ERRO NO CAMPO)
const CAMPO_ABA: Record<string, string> = {
  tipoPessoa: "geral", cpfCnpj: "geral", nome: "geral", nomeFantasia: "geral", inscricaoEstadual: "geral",
  optanteSimples: "geral", indicadorInscricaoEstadual: "geral", inscricaoMunicipal: "geral", inscricaoSuframa: "geral",
  statusFinanceiro: "geral", ativo: "geral",
  email: "geral", telefone: "geral", celular: "geral", contato: "geral",
  emailsFaturamento: "geral", whatsappFaturamento: "geral",
  observacoes: "geral",
  endereco: "geral", numero: "geral", complemento: "geral", bairro: "geral", cidade: "geral", estado: "geral", cep: "geral",
};

// Painel de aba (componente estável no escopo do módulo para não remontar
// os campos a cada render — abas inativas ficam apenas ocultas via CSS).
function Painel({ ativo, id, children }: { ativo: boolean; id: string; children: React.ReactNode }) {
  return <div className={cn("space-y-8", !ativo && "hidden")} data-aba-painel={id}>{children}</div>;
}

export function ClienteForm({ initialData, totalProximos30Dias, valorEmAtraso, emAtraso, perdas12m, consulta: consultaPedida, abaInicial, satisfacaoAceite }: ClienteFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  // Consulta só existe para um cliente que já existe (o "novo" é sempre formulário)
  const consulta = !!consultaPedida && isEditing;
  const fichaHref = isEditing ? `/clientes/${initialData!.id}` : "/clientes";
  // RBAC (o servidor também valida): sem permissão de salvar, a ficha abre somente leitura.
  const { pode } = usePermissoes();
  const podeSalvar = pode("clientes", isEditing ? "editar" : "criar");
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [unidadesNovas, setUnidadesNovas] = useState<UnidadeLocal[]>([]);
  const [anexosNovos, setAnexosNovos] = useState<AnexoLocal[]>([]);
  const [contatosNovos, setContatosNovos] = useState<ContatoLocal[]>([]);
  const [razaoSocialBloqueada, setRazaoSocialBloqueada] = useState(false);
  // Autofill da consulta de CNPJ na edição: o endereço/contato da consulta viram sugestão para os
  // managers (abrem o formulário já preenchido ao clicar em "Novo"); o nonce dispara o efeito.
  const [sugestaoContato, setSugestaoContato] = useState<ContatoConsulta | null>(null);
  const [consultaNonce, setConsultaNonce] = useState(0);
  const [config, setConfig] = useState<Partial<Configuracao>>({});

  // Abas
  const abaPedida = abaInicial ? ABA_ANTIGA[abaInicial] ?? abaInicial : "";
  const [aba, setAba] = useState(IDS_ABAS.includes(abaPedida) && (isEditing || !["historico", "atendimento", "comunicacao"].includes(abaPedida)) ? abaPedida : "geral");
  const [cnpjInfo, setCnpjInfo] = useState<{ nome: string; cidade?: string; estado?: string } | null>(null);

  // UX-2/E5: salvar um cliente novo aterrissa NESTA ficha (?criado=1) — confirma e já oferece as ações (o "Novo ▾")
  const searchParams = useSearchParams();
  const chegouCriado = isEditing && searchParams.get("criado") === "1";
  useEffect(() => {
    if (chegouCriado) {
      toast("Cliente cadastrado.");
      router.replace(consulta ? `/clientes/${initialData!.id}` : `/clientes/${initialData!.id}/editar`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chegouCriado]);

  // Tabela de preços (em Dados gerais). O perfil de faturamento (tipo/dia/condição e canais de
  // cobrança) saiu da UI do cliente: as colunas ficam no banco e são preservadas na edição porque
  // não entram mais no payload. A configuração de faturamento vive em cada contrato.
  const [tabelaPrecoId, setTabelaPrecoId] = useState<string>(initialData?.tabelaPrecoId ?? "");
  const tabelasPreco = useCadastro("tabelas-preco");
  const tabelaInativa = tabelasPreco.itens.find((t) => t.id === tabelaPrecoId && t.ativo === false) ?? null;
  const [portalAtivo, setPortalAtivo] = useState<boolean>(initialData?.portalAtivo ?? false);
  const [prefsEmail] = useState({
    emailReceberBoletos: initialData?.emailReceberBoletos ?? true,
    emailReceberRelatorios: initialData?.emailReceberRelatorios ?? true,
    emailReceberLembretes: initialData?.emailReceberLembretes ?? true,
    emailReceberConfirmacoes: initialData?.emailReceberConfirmacoes ?? true,
    emailReceberOrcamentos: initialData?.emailReceberOrcamentos ?? true,
    emailReceberOs: initialData?.emailReceberOs ?? true,
  });
  const [emailsCopia] = useState<string[]>(initialData?.emailsCopia ?? []);
  // Cobrança e faturamento (reaproveita colunas já existentes; sem schema novo). Salvos no create e edit.
  const [emailsFaturamento, setEmailsFaturamento] = useState<string[]>(initialData?.emailsFaturamento ?? []);
  const [boletoUnicoMensal, setBoletoUnicoMensal] = useState<boolean>(initialData?.boletoUnicoMensal ?? false);
  // Pedido do cliente (lib/pedido-cliente/regra): um só campo na tela, gravado nas duas colunas
  const [modoPedido, setModoPedido] = useState<ModoPedido>(modoDoCliente(initialData));
  const [agrupaAdicionais, setAgrupaAdicionais] = useState<boolean>(initialData?.agrupaAdicionais ?? false);
  const [lembretesPedido, setLembretesPedido] = useState<boolean>(initialData?.pedidoLembretesAtivo !== false);

  useEffect(() => {
    fetch("/api/configuracoes").then((r) => r.json()).then(setConfig).catch(() => {});
  }, []);

  const {
    register, handleSubmit, setValue, watch,
    formState: { errors, isSubmitting },
  } = useForm<ClienteInput>({
    resolver: zodResolver(clienteSchema),
    // O foco no 1º erro é do padrão do formulário (abre a aba certa antes de focar)
    shouldFocusError: false,
    defaultValues: initialData
      ? {
          tipoPessoa: initialData.tipoPessoa, nome: initialData.nome,
          nomeFantasia: initialData.nomeFantasia ?? "", cpfCnpj: initialData.cpfCnpj,
          inscricaoEstadual: initialData.inscricaoEstadual ?? "",
          optanteSimples: initialData.optanteSimples ?? false,
          indicadorInscricaoEstadual: (initialData.indicadorInscricaoEstadual ?? "") as any,
          inscricaoMunicipal: initialData.inscricaoMunicipal ?? "",
          inscricaoSuframa: initialData.inscricaoSuframa ?? "",
          statusFinanceiro: initialData.statusFinanceiro, ativo: initialData.ativo, satisfacao: initialData.satisfacao,
          email: initialData.email ?? "", telefone: initialData.telefone ?? "",
          celular: initialData.celular ?? "", contato: initialData.contato ?? "",
          artNumero: initialData.artNumero ?? "",
          responsavelTecnicoId: initialData.responsavelTecnicoId ?? "",
          endereco: initialData.endereco ?? "", numero: initialData.numero ?? "",
          complemento: initialData.complemento ?? "", bairro: initialData.bairro ?? "",
          cidade: initialData.cidade ?? "", estado: initialData.estado ?? "",
          cep: initialData.cep ?? "", observacoes: initialData.observacoes ?? "",
          whatsappFaturamento: initialData.whatsappFaturamento ?? "",
        }
      : { tipoPessoa: "JURIDICA", statusFinanceiro: "ADIMPLENTE", ativo: true, optanteSimples: false },
  });

  const tipoPessoa = watch("tipoPessoa");
  // ERRO NO CAMPO: os erros do zod + os da tela/servidor no mesmo lugar; o 1º erro abre a aba e recebe o foco
  const erros = useErrosDoFormulario({
    rhf: errors, abaDoCampo: CAMPO_ABA, abrirAba: setAba,
    abrirSecao: (s) => { if (["optanteSimples", "indicadorInscricaoEstadual", "inscricaoEstadual", "inscricaoMunicipal", "inscricaoSuframa"].includes(s)) setFiscalAberto(true); },
  });
  // Trocou o tipo de pessoa (ex.: PJ → PF depois de consultar o CNPJ): o nome volta a ser editável
  useEffect(() => { setRazaoSocialBloqueada(false); }, [tipoPessoa]);
  const telefoneVal = watch("telefone") ?? "";
  const celularVal = watch("celular") ?? "";
  const ativoVal = watch("ativo") ?? true;
  const optanteSimplesVal = watch("optanteSimples") ?? false;
  // Informações fiscais: seção avançada, recolhida por padrão (só abre quem vai emitir nota).
  const [fiscalAberto, setFiscalAberto] = useState(false);

  async function buscarCnpj() {
    const cnpj = watch("cpfCnpj")?.replace(/\D/g, "") ?? "";
    // Sem os 14 dígitos (ou com dígito verificador errado) não consulta, e diz por quê
    // O erro fica no CAMPO do CNPJ (borda vermelha + mensagem abaixo), com foco nele
    const noCnpj = (m: string) => { erros.definirCampo("cpfCnpj", m); erros.focar("cpfCnpj"); };
    if (cnpj.length !== 14) { noCnpj(MSG_FORMATO.cnpjIncompleto); return; }
    if (!cnpjValido(cnpj)) { noCnpj(MSG_FORMATO.cnpjInvalido); return; }
    setBuscandoCnpj(true); erros.limpar("cpfCnpj");
    try {
      const res = await fetch(`/api/cnpj/${cnpj}`);
      if (!res.ok) { const err = await res.json().catch(() => ({})); noCnpj(err.erro ?? "Erro ao consultar CNPJ."); return; }
      const data = await res.json();
      if (data.nome) { setValue("nome", data.nome); setRazaoSocialBloqueada(true); }
      setCnpjInfo({ nome: data.nome ?? "", cidade: data.cidade, estado: data.estado });
      // Cliente que já existe: o fantasia e o Simples só se estiverem vazios (o que já está no cadastro fica)
      if (data.nomeFantasia && (!isEditing || !(watch("nomeFantasia") ?? "").trim())) setValue("nomeFantasia", data.nomeFantasia);
      // A opção pelo Simples vem na consulta federal (quando disponível); IE/IM/Suframa não vêm (manuais).
      if (typeof data.optanteSimples === "boolean" && (!isEditing || initialData!.optanteSimples == null)) { setValue("optanteSimples", data.optanteSimples); setFiscalAberto(true); }
      // Leva H: o endereço da consulta vai para o ENDEREÇO PRINCIPAL (campos do cadastro), só se ainda não há
      // rua nem CEP (tudo ou nada: não mistura a rua digitada com o CEP/bairro/cidade da Receita)
      const atual = Object.fromEntries(CAMPOS_ENDERECO.map((c) => [c, watch(c) ?? ""]));
      for (const [c, v] of Object.entries(enderecoDaConsulta(data, atual))) setValue(c as (typeof CAMPOS_ENDERECO)[number], v, { shouldDirty: true });
      const contato: ContatoConsulta = { email: data.email ?? "", telefone: data.telefone ?? "" };
      const nomeCli = data.nome || watch("nome") || "";

      if (!isEditing) {
        // Cliente novo: mescla o contato direto no que vai ser salvo (sem duplicar).
        const rc = mesclarContato<ContatoLocal>(contatosNovos, contato, nomeCli, novoContatoLocal);
        if (rc.contatos !== contatosNovos) setContatosNovos(rc.contatos);
      } else {
        // Edição: o contato vira sugestão para o manager (o nonce abre "Novo contato" já preenchido).
        setSugestaoContato(contato.email || contato.telefone ? contato : null);
        setConsultaNonce((n) => n + 1);
      }
    } catch { noCnpj("Falha na consulta do CNPJ. Tente novamente."); } finally { setBuscandoCnpj(false); }
  }

  // Valida regras dinâmicas da empresa; retorna { campo, msg } do primeiro erro
  function validarConfigDinamica(): { campo: string; msg: string } | null {
    // O endereço principal vira o local "Principal" ao salvar: ele já atende a exigência de um local
    if (config.clienteExigirUnidade && !isEditing && unidadesNovas.length === 0 && !temEndereco({ endereco: watch("endereco"), cidade: watch("cidade"), cep: watch("cep") }))
      return { campo: "endereco", msg: "Preencha o endereço principal ou adicione um local de atendimento (configuração da empresa)." };
    return null;
  }

  // Zod recusou: os erros já estão nos campos (rhf); rola e foca o primeiro, abrindo a aba dele
  function onError() {
    erros.definir({});
    erros.focar();
  }

  async function onSubmit(data: ClienteInput, continuar = false) {
    if (!podeSalvar) return;
    erros.limparTudo();
    const erroCfg = validarConfigDinamica();
    if (erroCfg) { erros.validar({ [erroCfg.campo]: erroCfg.msg }); return; }

    const payload: any = {
      ...data,
      tabelaPrecoId: tabelaPrecoId || null,
      portalAtivo,
      // Segmento e Origem não são mais editáveis no formulário; preserva o valor
      // já cadastrado (a edição zeraria o campo se ele não viesse no payload).
      segmento: initialData?.segmento ?? null,
      origem: initialData?.origem ?? null,
      ...prefsEmail,
      emailsCopia,
      // Cobrança e faturamento: gravados no create e no edit (não ignora nem zera).
      emailsFaturamento,
      boletoUnicoMensal,
      ...camposDoModo(modoPedido),
      pedidoLembretesAtivo: lembretesPedido,
      agrupaAdicionais,
    };
    if (!isEditing) {
      payload.unidades = unidadesNovas.map(({ _tempId, ...u }) => u);
      payload.anexos = anexosNovos.map(({ _tempId, ...a }) => a);
      payload.contatos = contatosNovos.map(({ _tempId, ...c }) => c);
    }

    try {
      const url = isEditing ? `/api/clientes/${initialData!.id}` : "/api/clientes";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      // O erro do servidor cai no campo certo ({ erro, campos }: CNPJ já cadastrado, inválido…)
      if (!res.ok) { erros.erroDaApi(await res.json().catch(() => ({})), "Erro ao salvar cliente."); return; }
      const saved = await res.json().catch(() => ({}));
      // Cliente NOVO: qualquer salvar aterrissa na ficha do criado (UX-2/E5) —
      // o fluxo do balcão continua dali ("Nova OS", contatos, endereços…)
      if (!isEditing && saved?.id) {
        // Salvar: a ficha (com o "Novo ▾"); Salvar e continuar: segue na edição
        router.push(continuar ? `/clientes/${saved.id}/editar?criado=1` : `/clientes/${saved.id}?criado=1`); router.refresh();
      } else if (continuar) {
        // Fica na mesma tela: o aviso de sair sem salvar não pergunta mais (até a próxima alteração)
        marcarFormularioSalvo();
        toast("Cliente salvo.");
        router.refresh();
      } else {
        // Salvou a edição: volta para a ficha do cliente, em consulta, na aba em que estava
        router.push(aba === "geral" ? fichaHref : `${fichaHref}?aba=${aba}`); router.refresh();
      }
    } catch { erros.definirGeral("Erro de conexão."); erros.focar(); }
  }

  const qtdAnexos = isEditing ? (initialData!.anexos?.length ?? 0) : anexosNovos.length;

  // Leva H: Dados · Endereços · Histórico · Atendimento · Comunicação · Portal · Anexos. O que só existe depois
  // de salvar (histórico, atendimento, comunicação) não aparece no cliente novo.
  const ABAS = [
    { id: "geral", label: "Dados", icone: FileText },
    { id: "enderecos", label: "Endereços", icone: MapPin },
    ...(isEditing ? [
      { id: "historico", label: "Histórico", icone: History },
      { id: "atendimento", label: "Atendimento", icone: ClipboardList },
      { id: "comunicacao", label: "Comunicação", icone: Send },
    ] : []),
    { id: "portal", label: "Portal", icone: Headset },
    { id: "documentos", label: "Anexos", icone: Paperclip, badge: qtdAnexos },
  ];

  const salvar = handleSubmit((d) => onSubmit(d, false), onError);
  const salvarEContinuar = handleSubmit((d) => onSubmit(d, true), onError);

  // Cabeçalho: só o que importa (lib/clientes/cabecalho) e o botão único "Novo ▾" (na consulta, cliente ativo)
  const nomeExibido = isEditing ? (initialData!.nomeFantasia || initialData!.nome) : "Novo cliente";
  // Sem o financeiro, nada de valores (a página nem os manda): só "Inadimplente"
  const veFinanceiro = veFinanceiroDoCliente(pode);
  const sinais = isEditing ? sinaisDoCliente({
    clienteId: initialData!.id, ativo: ativoVal, valorEmAtraso: veFinanceiro ? valorEmAtraso ?? 0 : 0, totalProximos30Dias: veFinanceiro ? totalProximos30Dias ?? 0 : 0,
    emAtraso: emAtraso ?? (valorEmAtraso ?? 0) > 0,
    contratosAtivos: initialData!._count?.contratos ?? 0, satisfacao: satisfacaoAceite, podeVerReceber: pode("financeiro", "contasReceber"),
    podeVerContratos: pode("contratos", "visualizar"),
  }) : [];
  const itensNovo = consulta ? itensDoNovo(initialData!.id, ativoVal, pode) : [];
  const editarHref = consulta && podeSalvar ? (aba === "geral" ? `${fichaHref}/editar` : `${fichaHref}/editar?aba=${aba}`) : null;
  const voltar = consulta || !isEditing
    ? { href: "/clientes", rotulo: "Voltar para a lista de clientes" }
    : { href: aba === "geral" ? fichaHref : `${fichaHref}?aba=${aba}`, rotulo: "Voltar para a ficha do cliente" };

  const acoesEdicao = consulta || !podeSalvar ? null : (
    <>
      {/* Um link (não router.push): o aviso de sair sem salvar pergunta antes, como no voltar */}
      <Link href={voltar.href} className="btn-secondary min-h-[44px]" data-cancelar-cliente>Cancelar</Link>
      <Button type="button" variant="outline" className="min-h-[44px]" loading={isSubmitting} onClick={salvarEContinuar} data-salvar-continuar>
        <span className="hidden sm:inline">Salvar e continuar</span><span className="sm:hidden">Continuar</span>
      </Button>
      <Button type="button" variant="primary" className="min-h-[44px]" loading={isSubmitting} onClick={salvar} data-salvar-cliente>
        <FileCheck className="w-4 h-4" /> Salvar
      </Button>
    </>
  );

  // Inativar/Reativar: o mesmo botão e a mesma confirmação da lista. Inativar exige "excluir"; reativar,
  // "editar" (o próprio botão confere). Fica na consulta: na edição, o cabeçalho é só cancelar/salvar.
  const inativar = consulta ? (
    <InativarRegistro
      url={`/api/clientes/${initialData!.id}`} modulo="clientes" acaoReativar="editar" variante="botao"
      ativo={ativoVal} nome={initialData?.nomeFantasia || initialData?.nome || ""} entidade="cliente" comMotivo={false}
      className="min-h-[44px]"
      aoConcluir={(novo) => { setValue("ativo", novo); router.refresh(); }}
    />
  ) : null;

  const enderecoAtual = { endereco: watch("endereco"), cidade: watch("cidade"), cep: watch("cep") };

  return (
    <ErrosDoFormulario valor={erros}>
    <form ref={erros.ref} onSubmit={salvar} className="min-h-full -m-6 bg-surface-page p-4 sm:p-6" noValidate>
      {isEditing && <NomeNaTrilha id={initialData!.id} nome={initialData!.nomeFantasia || initialData!.nome} />}
      <div className="max-w-[1600px] mx-auto space-y-5">
        <CabecalhoCliente
          titulo={nomeExibido}
          subtitulo={isEditing ? subtituloDoCliente(initialData!) : []}
          voltarHref={voltar.href} voltarRotulo={voltar.rotulo}
          sinais={consulta ? sinais : sinais.filter((x) => x.id === "inativo")}
          itensNovo={itensNovo} editarHref={editarHref} inativar={inativar} acoes={acoesEdicao}
        />

        {!podeSalvar && !consulta && (
          <div className="bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <Lock className="w-4 h-4 shrink-0" /> Somente leitura: seu perfil não pode {isEditing ? "editar" : "cadastrar"} clientes.
          </div>
        )}

        {isEditing && <AlertaPerdasCliente clienteId={initialData!.id} perdas={perdas12m} />}

        {/* A faixa do topo é só o resumo: o erro mora no campo (ERRO NO CAMPO) */}
        <ResumoDeErros />

        <div className="bg-white rounded-card shadow-card border border-surface-border overflow-hidden">
          {/* Abas: no celular rolam de lado (uma linha), sem quebrar em três */}
          <nav className="flex gap-1 px-3 sm:px-4 pt-3 border-b border-surface-border overflow-x-auto" role="tablist" data-abas-cliente>
            {ABAS.map((t) => {
              const ativa = aba === t.id;
              const nErros = erros.porAba[t.id] ?? 0;
              return (
                <button
                  key={t.id} type="button" role="tab" aria-selected={ativa} onClick={() => setAba(t.id)} data-aba={t.id}
                  className={cn(
                    "flex items-center gap-2 px-3.5 min-h-[44px] text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                    ativa ? "border-acento text-acento" : "border-transparent text-ink-muted hover:text-ink",
                  )}
                >
                  <t.icone className="w-4 h-4" aria-hidden />
                  {t.label}
                  {t.badge != null && t.badge > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-alt text-ink-muted">{t.badge}</span>
                  )}
                  <IndicadorErroAba n={nErros} />
                </button>
              );
            })}
          </nav>

          <div className="p-4 sm:p-6 lg:p-8">
          {consulta && (
            <div className={cn("space-y-8", aba !== "geral" && "hidden")} data-ficha-cliente>
              <FichaCliente cliente={initialData!} />
            </div>
          )}
          <fieldset disabled={!podeSalvar && !consulta} className="min-w-0">

      {/* DADOS — na consulta é a ficha (acima): o formulário nem é montado */}
      {!consulta && (
      <Painel ativo={aba === "geral"} id="geral">
        <FormSection title="Identificação" icon={<Building2 className="w-3.5 h-3.5" />}>
          {isEditing && (
            <div className="flex items-center gap-3 pb-1">
              <LogoUpload compacto clienteId={initialData!.id} logoInicial={initialData!.logo} />
            </div>
          )}
          <FormGrid>
            <FormField label="Tipo de pessoa" required name="tipoPessoa">
              <Select {...register("tipoPessoa")}>
                <option value="JURIDICA">Pessoa jurídica</option>
                <option value="FISICA">Pessoa física</option>
              </Select>
            </FormField>
            <FormField label={tipoPessoa === "FISICA" ? "CPF" : "CNPJ"} required name="cpfCnpj" formato={formatoDoDocumento(tipoPessoa)}>
              <div className="flex gap-2">
                <Input {...register("cpfCnpj")} placeholder={tipoPessoa === "FISICA" ? "000.000.000-00" : "00.000.000/0001-00"} valido={!erros.erroDe("cpfCnpj") && !!cnpjInfo} className="flex-1" />
                {tipoPessoa === "JURIDICA" && (
                  <Button type="button" variant="secondary" loading={buscandoCnpj} onClick={buscarCnpj} className="shrink-0" data-consultar-cnpj>
                    {!buscandoCnpj && <Search className="w-4 h-4" />}
                    <span className="hidden sm:inline ml-1">Consultar</span>
                  </Button>
                )}
              </div>
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label={tipoPessoa === "FISICA" ? "Nome completo" : "Razão social"} required name="nome">
              <div className="relative">
                <Input {...register("nome")} caixa="nome" valido={!erros.erroDe("nome") && razaoSocialBloqueada} readOnly={razaoSocialBloqueada} className={razaoSocialBloqueada ? "bg-surface-linha text-ink-muted pr-20" : ""} />
                {razaoSocialBloqueada && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-ink-muted" />
                    <button type="button" onClick={() => setRazaoSocialBloqueada(false)} className="text-[11px] text-frivo-600 hover:underline flex items-center gap-0.5">
                      <Pencil className="w-3 h-3" /> Editar
                    </button>
                  </div>
                )}
              </div>
            </FormField>
            <FormField label={tipoPessoa === "FISICA" ? "Apelido" : "Nome fantasia"} name="nomeFantasia">
              <Input {...register("nomeFantasia")} caixa="nome" />
            </FormField>
          </FormGrid>
        </FormSection>

        {/* Endereço principal (o de cobrança e da nota fiscal): campos do cadastro, preenchidos pela consulta do
            CNPJ ou pelo CEP. Os locais de atendimento ficam na aba Endereços. */}
        <FormSection title="Endereço principal" icon={<MapPin className="w-3.5 h-3.5" />} dica={DICA_ENDERECO_PRINCIPAL}>
          <div className="space-y-4" data-endereco-principal>
            <FormGrid cols={3}>
              {/* O campo de CEP de todo formulário (lib/cep pelo CampoCep): completou, preenche rua, bairro, cidade e UF */}
              <CampoCep nome="cep" valor={watch("cep") ?? ""} onValor={(v) => setValue("cep", v, { shouldDirty: true })}
                onEndereco={(d) => {
                  const novo = enderecoDoCep({ endereco: watch("endereco"), bairro: watch("bairro"), cidade: watch("cidade"), estado: watch("estado") }, d, { logradouro: "endereco", bairro: "bairro", cidade: "cidade", estado: "estado" });
                  for (const [k, v] of Object.entries(novo)) setValue(k as "endereco", (v as string) ?? "", { shouldDirty: true });
                }} />
              <FormField label="Logradouro" className="sm:col-span-2" name="endereco">
                <Input {...register("endereco")} caixa="endereco" placeholder="Rua, avenida…" />
              </FormField>
            </FormGrid>
            <FormGrid cols={3}>
              <FormField label="Número" name="numero"><Input {...register("numero")} /></FormField>
              <FormField label="Complemento"><Input {...register("complemento")} caixa="endereco" /></FormField>
              <FormField label="Bairro"><Input {...register("bairro")} caixa="endereco" /></FormField>
            </FormGrid>
            <FormGrid cols={3}>
              <FormField label="Cidade" className="sm:col-span-2" name="cidade"><Input {...register("cidade")} caixa="cidade" /></FormField>
              <FormField label="UF">
                <Select {...register("estado")} placeholder="UF">
                  {ESTADOS_BR.map((uf) => (<option key={uf} value={uf}>{uf}</option>))}
                </Select>
              </FormField>
            </FormGrid>
          </div>
        </FormSection>

        <FormSection title="Contatos" icon={<Users className="w-3.5 h-3.5" />}>
          {isEditing ? (
            <ContatosManager clienteId={initialData!.id} contatosIniciais={initialData!.contatosCliente ?? []} inativosIniciais={initialData!.contatosInativos ?? []}
              sugestao={sugestaoContato ? { nome: watch("nome"), email: sugestaoContato.email, telefone: sugestaoContato.telefone } : null}
              prefillNonce={consultaNonce} />
          ) : (
            <ContatosLocal contatos={contatosNovos} onChange={setContatosNovos} />
          )}
        </FormSection>

        {/* Informações fiscais — recolhida por padrão: só abre quem vai emitir nota */}
        <div className="space-y-4">
          <button type="button" onClick={() => setFiscalAberto((v) => !v)} aria-expanded={fiscalAberto} data-secao-fiscal-toggle
            className="flex items-center gap-2 w-full min-h-[44px] text-xs font-semibold text-ink-muted uppercase tracking-wider border-b border-surface-border">
            <span className="text-acento"><Receipt className="w-3.5 h-3.5" /></span>
            Informações fiscais
            <ChevronDown className={cn("w-4 h-4 ml-auto text-ink-muted transition-transform", fiscalAberto && "rotate-180")} />
          </button>
          {fiscalAberto && (
            <div className="space-y-4" data-secao-fiscal>
              <FormGrid>
                <FormField label="Optante pelo Simples Nacional?" dica="Ao marcar Sim, não há retenção de PIS, Cofins e CSLL nas notas de serviço deste cliente.">
                  <div className="flex gap-2" role="radiogroup" aria-label="Optante pelo Simples Nacional">
                    {[{ v: true, r: "Sim" }, { v: false, r: "Não" }].map((o) => (
                      <button key={o.r} type="button" role="radio" aria-checked={optanteSimplesVal === o.v}
                        onClick={() => setValue("optanteSimples", o.v, { shouldDirty: true })}
                        className={cn("flex-1 h-11 rounded-lg border text-sm font-medium transition-colors",
                          optanteSimplesVal === o.v ? "border-acento bg-frivo-50 text-frivo-700" : "border-surface-campo bg-white text-ink hover:bg-surface-alt")}>
                        {o.r}
                      </button>
                    ))}
                  </div>
                </FormField>
                <FormField label="Indicador de Inscrição estadual">
                  <Select {...register("indicadorInscricaoEstadual")} placeholder="Selecione">
                    <option value="CONTRIBUINTE">Contribuinte</option>
                    <option value="ISENTO">Isento</option>
                    <option value="NAO_CONTRIBUINTE">Não contribuinte</option>
                  </Select>
                </FormField>
              </FormGrid>
              <FormGrid>
                <FormField label="Inscrição estadual"><Input {...register("inscricaoEstadual")} placeholder="Isento ou número" /></FormField>
                <FormField label="Inscrição municipal"><Input {...register("inscricaoMunicipal")} placeholder="Número" /></FormField>
              </FormGrid>
              <FormGrid>
                <FormField label="Inscrição SUFRAMA"><Input {...register("inscricaoSuframa")} placeholder="Número (Zona Franca)" /></FormField>
              </FormGrid>
            </div>
          )}
        </div>

        <FormSection title="Comercial" icon={<DollarSign className="w-3.5 h-3.5" />}>
          <FormField label="Tabela de preços">
            {/* Só ativas para nova escolha; a do cliente continua visível mesmo inativa (“(inativa)”) */}
            <SeletorCadastro entidade="tabelas-preco" valor={tabelaPrecoId} onChange={(v) => setTabelaPrecoId(v)} vazio="Sem tabela (preços do catálogo)" itens={tabelasPreco.itens} />
            {tabelaInativa && (
              <p className="text-xs text-atencao-texto mt-1" data-aviso-tabela-inativa>
                “{tabelaInativa.nome}” está inativa: valem os preços do catálogo. Escolha outra ou reative-a.
              </p>
            )}
          </FormField>
        </FormSection>

        {/* Cobrança e faturamento: para onde vão as faturas/cobranças (sem e-mail/WhatsApp, vai ao contato principal) */}
        <FormSection title="Cobrança e faturamento" icon={<Wallet className="w-3.5 h-3.5" />}>
          <FormGrid>
            <FormField label="E-mails de cobrança" name="emailsFaturamento" dica="Pode informar mais de um e-mail. Sem nenhum, a cobrança vai para o e-mail do contato principal do cliente.">
              <EmailsInput value={emailsFaturamento} onChange={setEmailsFaturamento} />
            </FormField>
            <FormField label="WhatsApp de cobrança" name="whatsappFaturamento" formato="telefone" dica="Sem este número, a cobrança por WhatsApp vai para o WhatsApp do contato principal do cliente.">
              <WhatsAppInput {...register("whatsappFaturamento")} placeholder="(00) 00000-0000" />
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Exige pedido do cliente" dica={`${DICA_MODO_PEDIDO.FATURAR} ${DICA_MODO_PEDIDO.EXECUTAR} Uma unidade pode ter a sua regra (na unidade).`}>
              <Select value={modoPedido} onChange={(e) => setModoPedido(e.target.value as ModoPedido)} aria-label="Exige pedido do cliente" data-modo-pedido>
                {MODOS_PEDIDO.map((m) => <option key={m} value={m}>{ROTULO_MODO_PEDIDO[m]}</option>)}
              </Select>
            </FormField>
          </FormGrid>
          {/* Contato de compras: só quando o cliente exige o pedido (é quem emite o pedido) */}
          {modoPedido !== "NAO" && (
            <div data-contato-compras><FormGrid>
              <FormField label="Contato de compras" dica="Quem emite o pedido do cliente: aparece na gaveta do pedido para cobrar quem precisa.">
                <Input {...register("comprasNome")} placeholder="Nome" aria-label="Nome do contato de compras" />
              </FormField>
              <FormField label="E-mail de compras" name="comprasEmail" formato="email">
                <Input {...register("comprasEmail")} type="email" placeholder="compras@cliente.com.br" />
              </FormField>
              <FormField label="Telefone de compras" name="comprasTelefone" formato="telefone">
                <PhoneInput {...register("comprasTelefone")} placeholder="(00) 0000-0000" />
              </FormField>
            </FormGrid>
            <div className="mt-3" data-lembretes-cliente>
              <ToggleSwitch
                label="Lembrar o contato de compras por e-mail" checked={lembretesPedido} onChange={setLembretesPedido}
                dica="Lembretes do pedido de compra pendente, nos dias definidos em Configurações › Orçamentos e propostas, com o link do portal. O contato de compras vê a seção “Pedido de compra” no portal com este mesmo e-mail."
              />
            </div></div>
          )}
          <ToggleGroup title="Preferências de cobrança">
            <ToggleSwitch
              label="Boleto único mensal" checked={boletoUnicoMensal} onChange={setBoletoUnicoMensal}
              dica="Agrupa as cobranças do mês num único boleto, em vez de um por lançamento."
            />
            <ToggleSwitch
              label="Agrupa adicionais na fatura" checked={agrupaAdicionais} onChange={setAgrupaAdicionais}
              dica="Serviços adicionais entram na mesma fatura do contrato, em vez de faturas separadas."
            />
          </ToggleGroup>
        </FormSection>

        <FormSection title="Observações" icon={<FileText className="w-3.5 h-3.5" />}>
          <FormField label="Observações internas">
            <Textarea {...register("observacoes")} placeholder="Informações adicionais…" rows={3} />
          </FormField>
        </FormSection>
      </Painel>
      )}

      {/* ENDEREÇOS — os locais de atendimento (unidades): ligados às OS, aos equipamentos, aos contratos e ao PMOC.
          Na consulta também: a lista é a mesma, e quem pode editar o cliente adiciona, edita e inativa daqui. */}
      <Painel ativo={aba === "enderecos"} id="enderecos">
        <FormSection title="Locais de atendimento" icon={<MapPin className="w-3.5 h-3.5" />} dica={DICA_LOCAIS}>
          {isEditing ? (
            <UnidadesManager clienteId={initialData!.id} unidadesIniciais={initialData!.unidades ?? []} inativosIniciais={initialData!.unidadesInativas ?? []}
              somenteLeitura={!pode("clientes", "editar")}
              enderecoCliente={{ endereco: initialData!.endereco, numero: initialData!.numero, complemento: initialData!.complemento, bairro: initialData!.bairro, cidade: initialData!.cidade, estado: initialData!.estado, cep: initialData!.cep, telefone: initialData!.telefone }} />
          ) : (
            <div className="space-y-3">
              {temEndereco(enderecoAtual) && (
                <p className="text-sm text-ink-muted" data-principal-automatico>O endereço principal vira o local “Principal” ao salvar.</p>
              )}
              <UnidadesLocal unidades={unidadesNovas} onChange={setUnidadesNovas} principalNoCadastro={temEndereco(enderecoAtual)} />
            </div>
          )}
        </FormSection>
      </Painel>

      {/* HISTÓRICO — automático (OS, orçamentos, faturas e pagamentos, pedidos, portal, e-mails, contratos e notas) */}
      {isEditing && (
        <Painel ativo={aba === "historico"} id="historico">
          <FormSection title="Histórico do cliente" icon={<History className="w-3.5 h-3.5" />}>
            <HistoricoCliente clienteId={initialData!.id} ativo={aba === "historico"} />
          </FormSection>
        </Painel>
      )}

      {isEditing && (
        <Painel ativo={aba === "atendimento"} id="atendimento">
          <FormSection title="Atendimento" icon={<ClipboardList className="w-3.5 h-3.5" />}>
            <AtendimentoCliente clienteId={initialData!.id} ativo={aba === "atendimento"} />
          </FormSection>
        </Painel>
      )}

      {isEditing && (
        <Painel ativo={aba === "comunicacao"} id="comunicacao">
          <FormSection title="Preferências de comunicação" icon={<Send className="w-3.5 h-3.5" />} dica="Quais contatos recebem cada tipo de comunicação e por qual canal. Os contatos ficam na aba Dados.">
            <fieldset disabled={consulta} className="min-w-0"><ComunicacaoPreferencias clienteId={initialData!.id} ativo={aba === "comunicacao"} onGerenciar={() => setAba("geral")} /></fieldset>
          </FormSection>
        </Painel>
      )}

      <Painel ativo={aba === "documentos"} id="documentos">
        <FormSection title="Anexos" icon={<Paperclip className="w-3.5 h-3.5" />}>
          {isEditing
            ? <AnexosManager clienteId={initialData!.id} anexosIniciais={initialData!.anexos ?? []} somenteLeitura={consulta} />
            : <AnexosLocal anexos={anexosNovos} onChange={setAnexosNovos} />}
        </FormSection>
      </Painel>

      <Painel ativo={aba === "portal"} id="portal">
        <FormSection title="Portal do cliente" icon={<Globe className="w-3.5 h-3.5" />} dica="Acesso individual por contato: senha provisória, redefinição e revogação.">
          <fieldset disabled={consulta} className="min-w-0 space-y-4">
          <ToggleSwitch
            label="Portal ativo"
            description="Desligado, nenhum contato deste cliente acessa o portal."
            checked={portalAtivo}
            onChange={setPortalAtivo}
          />
          {isEditing && <PortalContatos clienteId={initialData!.id} ativo={aba === "portal"} onGerenciar={() => setAba("geral")} onAcessoLiberado={() => setPortalAtivo(true)} />}
          </fieldset>
        </FormSection>
      </Painel>
          </fieldset>
          </div>{/* fim do conteúdo */}
        </div>{/* fim do card */}
      </div>{/* fim do container */}
    </form>
    </ErrosDoFormulario>
  );
}
