"use client";

import { useState, useEffect } from "react";
import { toast } from "@/components/ui/avisos";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { clienteSchema, type ClienteInput } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PhoneInput } from "@/components/ui/phone-input";
import { StarRating } from "@/components/ui/star-rating";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { UnidadesManager } from "@/components/forms/unidades-manager";
import { UnidadesLocal, novaUnidadeLocal, type UnidadeLocal } from "@/components/forms/unidades-local";
import { mesclarEnderecoPrincipal, mesclarContato, type EnderecoConsulta, type ContatoConsulta } from "@/lib/cadastros/autofill-cnpj";
import { AnexosManager } from "@/components/forms/anexos-manager";
import { AnexosLocal, type AnexoLocal } from "@/components/forms/anexos-local";
import { LogoUpload } from "@/components/forms/logo-upload";
import { ContatosManager } from "@/components/forms/contatos-manager";
import { ContatosLocal, novoContatoLocal, type ContatoLocal } from "@/components/forms/contatos-local";
import { ComunicacaoPreferencias } from "@/components/forms/comunicacao-preferencias";
import { PortalContatos } from "@/components/forms/portal-contatos";
import { InteracoesManager } from "@/components/forms/interacoes-manager";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { cn } from "@/lib/utils";
import {
  LABELS_STATUS_FINANCEIRO_CALC, COR_STATUS_FINANCEIRO_CALC, type StatusFinanceiroCalc,
} from "@/lib/status-financeiro";
import Link from "next/link";
import { SeletorCadastro, useCadastro } from "@/components/cadastros/seletor-cadastro";
import type { Cliente, Tecnico, Unidade, Configuracao, ContatoCliente } from "@prisma/client";
import type { ContatoSeguro } from "@/lib/contato-cliente";
import {
  Search, Loader2, FileCheck, Lock, Pencil, AlertCircle,
  FileText, MapPin, Heart, Headset,
  Building2, DollarSign, Users, Paperclip, Star, MessageSquare, Globe, Send, FileSignature,
  ClipboardPlus, Calculator,
} from "lucide-react";
import { AlertaPerdasCliente, type PerdasCliente } from "@/components/financeiro/alerta-perdas-cliente";

type ResponsavelItem = Pick<Tecnico, "id" | "nome" | "crea">;
type AnexoItem = { id: string; nome: string; tipo: string; tamanho: number; criadoEm: string | Date };
type InteracaoItem = { id: string; tipo: string; descricao: string; criadoEm: string | Date; usuario: { id: string; nome: string } };

interface ClienteFormProps {
  initialData?: Cliente & {
    responsavelTecnico?: ResponsavelItem | null;
    unidades?: Unidade[];
    anexos?: AnexoItem[];
    contatosCliente?: ContatoSeguro<ContatoCliente>[];
    interacoes?: InteracaoItem[];
    _count?: { contratos: number };
  };
  /** Status financeiro calculado a partir das contas a receber (somente leitura). */
  statusFinanceiroCalc?: StatusFinanceiroCalc;
  /** Total a receber nos próximos 30 dias (parcelas em aberto). */
  totalProximos30Dias?: number;
  /** Perdas (inadimplência) nos últimos 12 meses: alerta informativo, não bloqueia */
  perdas12m?: PerdasCliente | null;
}

// Mapeia cada campo (RHF) à aba onde ele está, para destacar abas com erro
const CAMPO_ABA: Record<string, string> = {
  tipoPessoa: "geral", cpfCnpj: "geral", nome: "geral", nomeFantasia: "geral", inscricaoEstadual: "geral",
  statusFinanceiro: "geral", ativo: "geral",
  email: "geral", telefone: "geral", celular: "geral", contato: "geral",
  observacoes: "relacionamento",
};

// Painel de aba (componente estável no escopo do módulo para não remontar
// os campos a cada render — abas inativas ficam apenas ocultas via CSS).
function Painel({ ativo, children }: { ativo: boolean; children: React.ReactNode }) {
  return <div className={cn("space-y-8", !ativo && "hidden")}>{children}</div>;
}

export function ClienteForm({ initialData, statusFinanceiroCalc, perdas12m }: ClienteFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  // RBAC (o servidor também valida): sem permissão de salvar, a ficha abre somente leitura.
  const { pode } = usePermissoes();
  const podeSalvar = pode("clientes", isEditing ? "editar" : "criar");
  const podeInativar = pode("clientes", "excluir");
  const podeReativar = pode("clientes", "editar");
  // UX-2/E5: "cliente ligou → abrir OS" sem sair da ficha (RBAC igual ao resto do sistema)
  const podeNovaOs = pode("ordens", "criar");
  const podeNovoOrcamento = pode("orcamentos", "criar");
  const statusCalc: StatusFinanceiroCalc = statusFinanceiroCalc ?? "SEM_HISTORICO";
  const qtdContratosAtivos = initialData?._count?.contratos ?? 0;
  const [erroGlobal, setErroGlobal] = useState("");
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [unidadesNovas, setUnidadesNovas] = useState<UnidadeLocal[]>([]);
  const [anexosNovos, setAnexosNovos] = useState<AnexoLocal[]>([]);
  const [contatosNovos, setContatosNovos] = useState<ContatoLocal[]>([]);
  const [razaoSocialBloqueada, setRazaoSocialBloqueada] = useState(false);
  // Autofill da consulta de CNPJ na edição: o endereço/contato da consulta viram sugestão para os
  // managers (abrem o formulário já preenchido ao clicar em "Novo"); o nonce dispara o efeito.
  const [sugestaoEndereco, setSugestaoEndereco] = useState<EnderecoConsulta | null>(null);
  const [sugestaoContato, setSugestaoContato] = useState<ContatoConsulta | null>(null);
  const [consultaNonce, setConsultaNonce] = useState(0);
  const [config, setConfig] = useState<Partial<Configuracao>>({});
  const [satisfacao, setSatisfacao] = useState<number | null>(initialData?.satisfacao ?? null);

  // Abas
  const [aba, setAba] = useState("geral");
  const [abasErro, setAbasErro] = useState<Set<string>>(new Set());
  const [cnpjInfo, setCnpjInfo] = useState<{ nome: string; cidade?: string; estado?: string } | null>(null);

  // Controle do status ativo/inativo (header)
  const [statusOpen, setStatusOpen] = useState(false);
  const [mudandoAtivo, setMudandoAtivo] = useState(false);

  // UX-2/E5: salvar um cliente novo aterrissa NESTA ficha (?criado=1) — confirma e já oferece as ações
  const searchParams = useSearchParams();
  const chegouCriado = isEditing && searchParams.get("criado") === "1";
  useEffect(() => {
    if (chegouCriado) {
      toast("Cliente cadastrado.");
      router.replace(`/clientes/${initialData!.id}/editar`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chegouCriado]);

  // Inativa (DELETE = soft-delete, exige "excluir") ou reativa (PATCH, exige "editar")
  // o cliente sem salvar o formulário inteiro.
  async function alterarAtivo(novo: boolean) {
    if (!isEditing) return;
    setMudandoAtivo(true);
    try {
      const res = novo
        ? await fetch(`/api/clientes/${initialData!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ativo: true }),
          })
        : await fetch(`/api/clientes/${initialData!.id}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErroGlobal(e.erro ?? "Erro ao alterar status."); return; }
      setValue("ativo", novo);
      setStatusOpen(false);
      toast(novo ? "Cliente reativado." : "Cliente inativado.");
      router.refresh();
    } catch { setErroGlobal("Erro de conexão."); } finally { setMudandoAtivo(false); }
  }

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

  useEffect(() => {
    fetch("/api/configuracoes").then((r) => r.json()).then(setConfig).catch(() => {});
  }, []);

  const {
    register, handleSubmit, setValue, watch,
    formState: { errors, isSubmitting },
  } = useForm<ClienteInput>({
    resolver: zodResolver(clienteSchema),
    defaultValues: initialData
      ? {
          tipoPessoa: initialData.tipoPessoa, nome: initialData.nome,
          nomeFantasia: initialData.nomeFantasia ?? "", cpfCnpj: initialData.cpfCnpj,
          inscricaoEstadual: initialData.inscricaoEstadual ?? "",
          statusFinanceiro: initialData.statusFinanceiro, ativo: initialData.ativo, satisfacao: initialData.satisfacao,
          email: initialData.email ?? "", telefone: initialData.telefone ?? "",
          celular: initialData.celular ?? "", contato: initialData.contato ?? "",
          artNumero: initialData.artNumero ?? "",
          responsavelTecnicoId: initialData.responsavelTecnicoId ?? "",
          endereco: initialData.endereco ?? "", numero: initialData.numero ?? "",
          complemento: initialData.complemento ?? "", bairro: initialData.bairro ?? "",
          cidade: initialData.cidade ?? "", estado: initialData.estado ?? "",
          cep: initialData.cep ?? "", observacoes: initialData.observacoes ?? "",
        }
      : { tipoPessoa: "JURIDICA", statusFinanceiro: "ADIMPLENTE", ativo: true },
  });

  const tipoPessoa = watch("tipoPessoa");
  const telefoneVal = watch("telefone") ?? "";
  const celularVal = watch("celular") ?? "";
  const ativoVal = watch("ativo") ?? true;

  async function buscarCnpj() {
    const cnpj = watch("cpfCnpj")?.replace(/\D/g, "");
    if (!cnpj || cnpj.length !== 14) return;
    setBuscandoCnpj(true); setErroGlobal("");
    try {
      const res = await fetch(`/api/cnpj/${cnpj}`);
      if (!res.ok) { const err = await res.json().catch(() => ({})); setErroGlobal(err.erro ?? "Erro ao consultar CNPJ."); return; }
      const data = await res.json();
      if (data.nome) { setValue("nome", data.nome); setRazaoSocialBloqueada(true); }
      setCnpjInfo({ nome: data.nome ?? "", cidade: data.cidade, estado: data.estado });
      if (data.nomeFantasia) setValue("nomeFantasia", data.nomeFantasia);
      // A mesma resposta já traz o endereço completo e o contato — aproveitar (sem 2ª chamada ao ViaCEP).
      const end: EnderecoConsulta = {
        logradouro: data.endereco ?? "", numero: data.numero ?? "", complemento: data.complemento ?? "",
        bairro: data.bairro ?? "", cidade: data.cidade ?? "", estado: data.estado ?? "", cep: data.cep ?? "",
      };
      const contato: ContatoConsulta = { email: data.email ?? "", telefone: data.telefone ?? "" };
      const nomeCli = data.nome || watch("nome") || "";

      if (!isEditing) {
        // Cliente novo: mescla direto no que vai ser salvo (cria o principal se não houver; senão só vazios).
        const re = mesclarEnderecoPrincipal<UnidadeLocal>(unidadesNovas, end, novaUnidadeLocal);
        if (re.preencheu) setUnidadesNovas(re.unidades);
        const rc = mesclarContato<ContatoLocal>(contatosNovos, contato, nomeCli, novoContatoLocal);
        if (rc.contatos !== contatosNovos) setContatosNovos(rc.contatos);
        const partes = [re.preencheu && "endereço", rc.adicionou && "contato"].filter(Boolean);
        if (partes.length) toast(`Consulta preencheu ${partes.join(" e ")} do cliente.`);
      } else {
        // Edição: vira sugestão para os managers (o nonce abre o formulário já preenchido ao adicionar).
        setSugestaoEndereco(end);
        setSugestaoContato(contato.email || contato.telefone ? contato : null);
        setConsultaNonce((n) => n + 1);
      }
    } catch { setErroGlobal("Falha na consulta do CNPJ. Tente novamente."); } finally { setBuscandoCnpj(false); }
  }

  // Valida regras dinâmicas da empresa; retorna { aba, msg } do primeiro erro
  function validarConfigDinamica(): { aba: string; msg: string } | null {
    if (config.clienteExigirUnidade && !isEditing && unidadesNovas.length === 0) return { aba: "geral", msg: "Adicione pelo menos um endereço antes de salvar (configuração da empresa)." };
    return null;
  }

  function onError(errs: typeof errors) {
    const abas = new Set<string>();
    Object.keys(errs).forEach((c) => { const a = CAMPO_ABA[c]; if (a) abas.add(a); });
    setAbasErro(abas);
    const primeira = ABAS.find((t) => abas.has(t.id));
    if (primeira) { setAba(primeira.id); setErroGlobal(`Existem campos obrigatórios na aba "${primeira.label}".`); }
  }

  async function onSubmit(data: ClienteInput, continuar = false) {
    if (!podeSalvar) return;
    setErroGlobal(""); setAbasErro(new Set());
    const erroCfg = validarConfigDinamica();
    if (erroCfg) { setAbasErro(new Set([erroCfg.aba])); setAba(erroCfg.aba); setErroGlobal(erroCfg.msg); return; }

    const payload: any = {
      ...data,
      satisfacao,
      tabelaPrecoId: tabelaPrecoId || null,
      portalAtivo,
      // Segmento e Origem não são mais editáveis no formulário; preserva o valor
      // já cadastrado (a edição zeraria o campo se ele não viesse no payload).
      segmento: initialData?.segmento ?? null,
      origem: initialData?.origem ?? null,
      ...prefsEmail,
      emailsCopia,
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
      if (!res.ok) { const err = await res.json(); setErroGlobal(err.erro ?? "Erro ao salvar cliente."); return; }
      const saved = await res.json().catch(() => ({}));
      // Cliente NOVO: qualquer salvar aterrissa na ficha do criado (UX-2/E5) —
      // o fluxo do balcão continua dali ("Nova OS", contatos, endereços…)
      if (!isEditing && saved?.id) {
        router.push(`/clientes/${saved.id}/editar?criado=1`); router.refresh();
      } else if (continuar) {
        toast("Cliente salvo.");
        router.refresh();
      } else {
        router.push("/clientes"); router.refresh();
      }
    } catch { setErroGlobal("Erro de conexão."); }
  }

  function reqLabel(base: string, cfgKey: keyof Configuracao): string {
    return config[cfgKey] ? `${base} *` : base;
  }

  const qtdAnexos = isEditing ? (initialData!.anexos?.length ?? 0) : anexosNovos.length;

  const ABAS = [
    { id: "geral", label: "Dados gerais", icone: FileText },
    { id: "comunicacao", label: "Comunicação", icone: Send },
    { id: "documentos", label: "Anexos", icone: Paperclip, badge: qtdAnexos },
    { id: "portal", label: "Portal", icone: Headset },
    { id: "relacionamento", label: "Relacionamento", icone: Heart },
  ];

  const salvar = handleSubmit((d) => onSubmit(d, false), onError);
  const salvarEContinuar = handleSubmit((d) => onSubmit(d, true), onError);
  const titulo = isEditing ? (initialData?.nome || "Editar cliente") : "Novo cliente";
  // Inativar exige "excluir"; reativar exige "editar". Sem a permissão, o status vira só um selo.
  const podeAlterarStatus = ativoVal ? podeInativar : podeReativar;

  // "Cliente ligou → abrir OS" sem sair da ficha (E5): atalhos no cabeçalho, só para cliente ativo
  const AtalhosCliente = ({ compact = false }: { compact?: boolean }) => !isEditing || !ativoVal ? null : (
    <>
      {podeNovaOs && (
        <Link
          href={`/ordens/nova?clienteId=${initialData!.id}`} data-nova-os
          className={cn("inline-flex items-center gap-1.5 font-semibold bg-primary-500 hover:bg-primary-600 text-white rounded-lg shadow-sm whitespace-nowrap",
            compact ? "text-xs px-3 py-1.5" : "text-sm px-4 py-2.5")}
        >
          <ClipboardPlus className="w-4 h-4" /> Nova OS
        </Link>
      )}
      {podeNovoOrcamento && (
        <Link
          href={`/orcamentos/novo?clienteId=${initialData!.id}`} data-novo-orcamento
          className={cn("inline-flex items-center gap-1.5 font-medium bg-white border border-primary-500 text-primary-600 hover:bg-primary-50 rounded-lg whitespace-nowrap",
            compact ? "text-xs px-3 py-1.5" : "text-sm px-4 py-2.5")}
        >
          <Calculator className="w-4 h-4" /> <span className={compact ? "hidden lg:inline" : ""}>Novo orçamento</span><span className={compact ? "lg:hidden" : "hidden"}>Orçamento</span>
        </Link>
      )}
    </>
  );

  const BotoesAcao = ({ compact = false }: { compact?: boolean }) => !podeSalvar ? (
    <div className="flex items-center gap-2 flex-wrap">
      <AtalhosCliente compact={compact} />
      <Button type="button" variant="secondary" size={compact ? "sm" : "md"} onClick={() => router.push("/clientes")}>Voltar</Button>
    </div>
  ) : (
    <div className="flex items-center gap-2 flex-wrap">
      <AtalhosCliente compact={compact} />
      <Button type="button" variant="secondary" size={compact ? "sm" : "md"} onClick={() => router.push("/clientes")}>Cancelar</Button>
      <Button type="button" variant="outline" size={compact ? "sm" : "md"} loading={isSubmitting} onClick={salvarEContinuar}>
        <span className={compact ? "hidden lg:inline" : ""}>Salvar e continuar</span>
        <span className={compact ? "lg:hidden" : "hidden"}>Continuar</span>
      </Button>
      <Button type="button" variant="primary" size={compact ? "sm" : "md"} loading={isSubmitting} onClick={salvar}>
        <FileCheck className="w-4 h-4" /> Salvar
      </Button>
    </div>
  );

  return (
    <form onSubmit={salvar} className="min-h-full -m-6 bg-surface-page p-4 sm:p-6">
      <div className="max-w-[1600px] mx-auto space-y-5">
        {/* Cabeçalho fixo: título + status + ações */}
        <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-surface-page/90 backdrop-blur border-b border-surface-border">
          <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <h1 className="text-xl font-bold text-ink truncate">{titulo}</h1>
              {isEditing && (
                <Link
                  href={`/contratos?clienteId=${initialData!.id}`}
                  title="Ver contratos do cliente"
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1 border transition-colors",
                    qtdContratosAtivos > 0
                      ? "bg-ok-claro border-ok/20 text-ok-texto hover:brightness-95"
                      : "bg-surface-linha border-surface-border text-ink-muted hover:bg-surface-border",
                  )}
                >
                  <FileSignature className="w-3.5 h-3.5" />
                  {qtdContratosAtivos > 0
                    ? `${qtdContratosAtivos} contrato${qtdContratosAtivos > 1 ? "s" : ""} ativo${qtdContratosAtivos > 1 ? "s" : ""}`
                    : "Sem contratos"}
                </Link>
              )}
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", COR_STATUS_FINANCEIRO_CALC[statusCalc])}>
                {LABELS_STATUS_FINANCEIRO_CALC[statusCalc]}
              </span>
              {isEditing && !podeAlterarStatus ? (
                <span className={cn(
                  "inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1 border",
                  ativoVal ? "bg-ok-claro border-ok/20 text-ok-texto" : "bg-atrasado-claro border-atrasado/20 text-atrasado",
                )}>
                  <span className={cn("w-1.5 h-1.5 rounded-full", ativoVal ? "bg-ok" : "bg-atrasado")} />
                  {ativoVal ? "Ativo" : "Inativo"}
                </span>
              ) : isEditing ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setStatusOpen((o) => !o)}
                    title="Mudar status do cliente"
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1 border transition-colors",
                      ativoVal
                        ? "bg-ok-claro border-ok/20 text-ok-texto hover:brightness-95"
                        : "bg-atrasado-claro border-atrasado/20 text-atrasado hover:brightness-95",
                    )}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full", ativoVal ? "bg-ok" : "bg-atrasado")} />
                    {ativoVal ? "Ativo" : "Inativo"}
                  </button>
                  {statusOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setStatusOpen(false)} />
                      <div className="absolute left-0 mt-2 z-50 w-72 bg-white border border-surface-border rounded-card shadow-card-hover p-3 space-y-3">
                        <p className="text-sm text-ink">
                          {ativoVal
                            ? "Deseja inativar este cliente? Ele não aparecerá nas listagens padrão, mas todo o histórico será preservado."
                            : "Deseja reativar este cliente?"}
                        </p>
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="secondary" size="sm" onClick={() => setStatusOpen(false)}>Cancelar</Button>
                          <Button type="button" variant={ativoVal ? "danger" : "success"} size="sm" loading={mudandoAtivo} onClick={() => alterarAtivo(!ativoVal)}>
                            {ativoVal ? "Inativar" : "Reativar"}
                          </Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1 border bg-ok-claro border-ok/20 text-ok-texto">
                  <span className="w-1.5 h-1.5 rounded-full bg-ok" /> Ativo
                </span>
              )}
            </div>
            <BotoesAcao compact />
          </div>
        </div>

        {!podeSalvar && (
          <div className="bg-atencao-claro border border-atencao/20 text-atencao-texto text-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <Lock className="w-4 h-4 shrink-0" /> Modo somente leitura: seu perfil não tem permissão para {isEditing ? "editar" : "cadastrar"} clientes.
          </div>
        )}

        {isEditing && <AlertaPerdasCliente clienteId={initialData!.id} perdas={perdas12m} />}

        {erroGlobal && (
          <div className="bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {erroGlobal}
          </div>
        )}

        {/* Card central branco com abas + conteúdo */}
        <div className="bg-white rounded-card shadow-card border border-surface-border overflow-hidden">
          <nav className="flex flex-wrap gap-1.5 px-4 pt-4 pb-4 border-b border-surface-border">
            {ABAS.map((t) => {
              const ativa = aba === t.id;
              const comErro = abasErro.has(t.id);
              return (
                <button
                  key={t.id} type="button" onClick={() => setAba(t.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-card whitespace-nowrap transition-all",
                    ativa ? "bg-primary-500 text-white shadow-sm" : "text-ink-muted hover:text-ink hover:bg-surface-alt",
                    comErro && !ativa && "text-atrasado bg-atrasado-claro",
                  )}
                >
                  <t.icone className="w-4 h-4" />
                  {t.label}
                  {t.badge != null && t.badge > 0 && (
                    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", ativa ? "bg-white/25 text-white" : "bg-surface-alt text-ink-muted")}>{t.badge}</span>
                  )}
                  {comErro && <AlertCircle className={cn("w-3.5 h-3.5", ativa ? "text-white" : "text-atrasado")} />}
                </button>
              );
            })}
          </nav>

          <div className="p-5 sm:p-6 lg:p-8">
          <fieldset disabled={!podeSalvar} className="min-w-0">

      {/* ABA 1 — Dados Gerais */}
      <Painel ativo={aba === "geral"}>
        <FormSection title="Identificação" icon={<Building2 className="w-3.5 h-3.5" />}>
          {isEditing ? (
            <div className="flex items-center gap-3 pb-1">
              <LogoUpload compacto clienteId={initialData!.id} logoInicial={initialData!.logo} />
            </div>
          ) : (
            <p className="text-xs text-ink-muted">A logomarca pode ser enviada após salvar o cliente.</p>
          )}
          <FormGrid>
            <FormField label="Tipo de pessoa" required>
              <Select {...register("tipoPessoa")} error={!!errors.tipoPessoa}>
                <option value="JURIDICA">Pessoa jurídica</option>
                <option value="FISICA">Pessoa física</option>
              </Select>
            </FormField>
            <FormField label={tipoPessoa === "FISICA" ? "CPF" : "CNPJ"} required error={errors.cpfCnpj?.message} hint={tipoPessoa === "JURIDICA" && !cnpjInfo ? "Informe o CNPJ e clique em Consultar para preencher automaticamente." : undefined}>
              <div>
                {/* Confirmação discreta da consulta, logo acima do campo (sem o painel antigo) */}
                {cnpjInfo?.nome && (
                  <p className="flex items-center gap-1 text-xs text-ok-texto mb-1 animate-in fade-in" data-cnpj-encontrado>
                    <FileCheck className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Receita Federal: {cnpjInfo.nome}{(cnpjInfo.cidade || cnpjInfo.estado) ? ` — ${[cnpjInfo.cidade, cnpjInfo.estado].filter(Boolean).join("/")}` : ""}</span>
                  </p>
                )}
                <div className="flex gap-2">
                  <Input {...register("cpfCnpj")} placeholder={tipoPessoa === "FISICA" ? "000.000.000-00" : "00.000.000/0001-00"} error={!!errors.cpfCnpj} valido={!errors.cpfCnpj && !!cnpjInfo} className="flex-1" />
                  {tipoPessoa === "JURIDICA" && (
                    <Button type="button" variant="secondary" loading={buscandoCnpj} onClick={buscarCnpj} className="shrink-0">
                      {!buscandoCnpj && <Search className="w-4 h-4" />}
                      <span className="hidden sm:inline ml-1">Consultar</span>
                    </Button>
                  )}
                </div>
              </div>
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label={tipoPessoa === "FISICA" ? "Nome completo" : "Razão social"} required error={errors.nome?.message}>
              <div className="relative">
                <Input {...register("nome")} caixa="nome" error={!!errors.nome} valido={!errors.nome && razaoSocialBloqueada} readOnly={razaoSocialBloqueada} className={razaoSocialBloqueada ? "bg-surface-linha text-ink-muted pr-20" : ""} />
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
            <FormField label={tipoPessoa === "FISICA" ? "Apelido" : "Nome fantasia"}>
              <Input {...register("nomeFantasia")} caixa="nome" />
            </FormField>
          </FormGrid>
          {tipoPessoa === "JURIDICA" && (
            <FormGrid>
              <FormField label="Inscrição estadual"><Input {...register("inscricaoEstadual")} placeholder="Isento ou número" /></FormField>
            </FormGrid>
          )}
          {/* Status financeiro fica só no cabeçalho (selo ao lado do nome) — não repete aqui embaixo. */}
        </FormSection>

        {/* Endereços — logo abaixo da identificação (o Consultar preenche os dois juntos) */}
        <FormSection title="Endereços" icon={<MapPin className="w-3.5 h-3.5" />}>
          <p className="text-xs text-ink-muted -mt-2 mb-3">
            {isEditing
              ? "Gerencie os endereços do cliente. O endereço marcado com estrela é o principal."
              : config.clienteExigirUnidade
                ? "Adicione pelo menos o endereço principal do cliente (obrigatório)."
                : "Adicione os endereços do cliente."}
          </p>
          {isEditing ? (
            <UnidadesManager clienteId={initialData!.id} unidadesIniciais={initialData!.unidades ?? []}
              prefillNonce={consultaNonce}
              enderecoCliente={sugestaoEndereco
                ? { endereco: sugestaoEndereco.logradouro, numero: sugestaoEndereco.numero, complemento: sugestaoEndereco.complemento, bairro: sugestaoEndereco.bairro, cidade: sugestaoEndereco.cidade, estado: sugestaoEndereco.estado, cep: sugestaoEndereco.cep, telefone: initialData!.telefone }
                : { endereco: initialData!.endereco, numero: initialData!.numero, complemento: initialData!.complemento, bairro: initialData!.bairro, cidade: initialData!.cidade, estado: initialData!.estado, cep: initialData!.cep, telefone: initialData!.telefone }} />
          ) : (
            <UnidadesLocal unidades={unidadesNovas} onChange={setUnidadesNovas} />
          )}
        </FormSection>

        {/* Contatos */}
        <FormSection title="Contatos" icon={<Users className="w-3.5 h-3.5" />}>
          <p className="text-xs text-ink-muted -mt-2 mb-3">
            {isEditing
              ? "Contatos do cliente. Comunicação e acesso ao portal ficam nas abas Comunicação e Portal."
              : "Adicione os contatos do cliente. O primeiro será marcado como principal."}
          </p>
          {isEditing ? (
            <ContatosManager clienteId={initialData!.id} contatosIniciais={initialData!.contatosCliente ?? []}
              sugestao={sugestaoContato ? { nome: watch("nome"), email: sugestaoContato.email, telefone: sugestaoContato.telefone } : null}
              prefillNonce={consultaNonce} />
          ) : (
            <ContatosLocal contatos={contatosNovos} onChange={setContatosNovos} />
          )}
        </FormSection>

        {/* Comercial — tabela de preços */}
        <FormSection title="Comercial" icon={<DollarSign className="w-3.5 h-3.5" />}>
          <FormField label="Tabela de preços" hint="Sem tabela, valem os preços padrão do catálogo.">
            {/* Só ativas para nova escolha; a do cliente continua visível mesmo inativa (“(inativa)”) */}
            <SeletorCadastro entidade="tabelas-preco" valor={tabelaPrecoId} onChange={(v) => setTabelaPrecoId(v)} vazio="Sem tabela (preços do catálogo)" itens={tabelasPreco.itens} />
            {tabelaInativa && (
              <p className="text-xs text-atencao-texto mt-1" data-aviso-tabela-inativa>
                “{tabelaInativa.nome}” está inativa: para este cliente valem os preços padrão do catálogo. Escolha outra tabela ou reative-a.
              </p>
            )}
          </FormField>
        </FormSection>
      </Painel>

      {/* ABA — Comunicação */}
      <Painel ativo={aba === "comunicacao"}>
        <FormSection title="Preferências de comunicação" icon={<Send className="w-3.5 h-3.5" />}>
          <p className="text-xs text-ink-muted -mt-2 mb-3">
            Defina quais contatos recebem cada tipo de comunicação e por qual canal. Os contatos são cadastrados em <strong>Dados gerais</strong>.
          </p>
          {isEditing ? (
            <ComunicacaoPreferencias clienteId={initialData!.id} ativo={aba === "comunicacao"} onGerenciar={() => setAba("geral")} />
          ) : (
            <p className="text-sm text-ink-muted">Salve o cliente para configurar a comunicação dos contatos.</p>
          )}
        </FormSection>
      </Painel>

      {/* ABA — Anexos */}
      <Painel ativo={aba === "documentos"}>
        <FormSection title="Anexos" icon={<Paperclip className="w-3.5 h-3.5" />}>
          {isEditing
            ? <AnexosManager clienteId={initialData!.id} anexosIniciais={initialData!.anexos ?? []} />
            : <AnexosLocal anexos={anexosNovos} onChange={setAnexosNovos} />}
        </FormSection>
      </Painel>

      {/* ABA 6 — Relacionamento */}
      <Painel ativo={aba === "relacionamento"}>
        <FormSection title="Satisfação" icon={<Star className="w-3.5 h-3.5" />}>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-muted">Nível de satisfação:</span>
            <StarRating value={satisfacao} onChange={(v) => { setSatisfacao(v || null); setValue("satisfacao", v || null); }} />
          </div>
        </FormSection>
        {isEditing && (
          <FormSection title="Histórico de interações" icon={<MessageSquare className="w-3.5 h-3.5" />}>
            <InteracoesManager clienteId={initialData!.id} interacoesIniciais={initialData!.interacoes ?? []} />
          </FormSection>
        )}
        <FormSection title="Observações" icon={<FileText className="w-3.5 h-3.5" />}>
          <FormField label="Observações internas">
            <Textarea {...register("observacoes")} placeholder="Informações adicionais…" rows={3} />
          </FormField>
        </FormSection>
      </Painel>

      {/* ABA 7 — Portal */}
      <Painel ativo={aba === "portal"}>
        <FormSection title="Portal do cliente" icon={<Globe className="w-3.5 h-3.5" />} dica="Acesso individual por contato: senha provisória, redefinição e revogação.">
          <p className="text-xs text-ink-muted -mt-2 mb-1">Acesso do cliente ao portal externo.</p>
          <ToggleSwitch
            label="Portal ativo"
            description="Quando desligado, nenhum contato deste cliente consegue acessar o portal."
            checked={portalAtivo}
            onChange={setPortalAtivo}
          />
          {!isEditing ? (
            <p className="text-xs text-ink-muted">Salve o cliente para conceder acesso de portal aos contatos.</p>
          ) : (
            <PortalContatos clienteId={initialData!.id} ativo={aba === "portal"} onGerenciar={() => setAba("geral")} />
          )}
        </FormSection>
      </Painel>
          </fieldset>
          </div>{/* fim do conteúdo */}

          {/* Barra de ações no rodapé */}
          <div className="flex items-center justify-end gap-3 px-5 sm:px-6 lg:px-8 py-4 bg-surface-alt/40 border-t border-surface-border">
            <BotoesAcao />
          </div>
        </div>{/* fim do card */}
      </div>{/* fim do container */}
    </form>
  );
}
