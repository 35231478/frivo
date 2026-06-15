"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { clienteSchema, type ClienteInput } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PhoneInput } from "@/components/ui/phone-input";
import { WhatsAppInput } from "@/components/ui/whatsapp-input";
import { StarRating } from "@/components/ui/star-rating";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { UnidadesManager } from "@/components/forms/unidades-manager";
import { UnidadesLocal, type UnidadeLocal } from "@/components/forms/unidades-local";
import { AnexosManager } from "@/components/forms/anexos-manager";
import { AnexosLocal, type AnexoLocal } from "@/components/forms/anexos-local";
import { LogoUpload } from "@/components/forms/logo-upload";
import { ContatosManager } from "@/components/forms/contatos-manager";
import { ContatosLocal, type ContatoLocal } from "@/components/forms/contatos-local";
import { ComunicacaoContatos } from "@/components/forms/comunicacao-contatos";
import { ClienteContratos } from "@/components/forms/cliente-contratos";
import { InteracoesManager } from "@/components/forms/interacoes-manager";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { LABELS_SEGMENTO, LABELS_ORIGEM, LABELS_PERFIL_FATURAMENTO, PERMISSOES_PORTAL, formatarMoeda } from "@/lib/utils";
import { cn } from "@/lib/utils";
import {
  LABELS_STATUS_FINANCEIRO_CALC, COR_STATUS_FINANCEIRO_CALC, type StatusFinanceiroCalc,
} from "@/lib/status-financeiro";
import Link from "next/link";
import type { Cliente, Tecnico, Unidade, Configuracao, ContatoCliente } from "@prisma/client";
import {
  Search, Loader2, FileCheck, Lock, Pencil, Plus, X, Mail, AlertCircle,
  FileText, Phone, MapPin, Image as ImageIcon, Heart, Headset,
  Building2, Tag, DollarSign, Users, Paperclip, Star, MessageSquare, Globe, ArrowUpRight, Send, FileSignature,
} from "lucide-react";

type ResponsavelItem = Pick<Tecnico, "id" | "nome" | "crea">;
type AnexoItem = { id: string; nome: string; tipo: string; tamanho: number; criadoEm: string | Date };
type InteracaoItem = { id: string; tipo: string; descricao: string; criadoEm: string | Date; usuario: { id: string; nome: string } };

interface ClienteFormProps {
  initialData?: Cliente & {
    responsavelTecnico?: ResponsavelItem | null;
    unidades?: Unidade[];
    anexos?: AnexoItem[];
    contatosCliente?: ContatoCliente[];
    interacoes?: InteracaoItem[];
    _count?: { contratos: number };
  };
  /** Status financeiro calculado a partir das contas a receber (somente leitura). */
  statusFinanceiroCalc?: StatusFinanceiroCalc;
  /** Total a receber nos próximos 30 dias (parcelas em aberto). */
  totalProximos30Dias?: number;
}

// Mapeia cada campo (RHF) à aba onde ele está, para destacar abas com erro
const CAMPO_ABA: Record<string, string> = {
  tipoPessoa: "geral", cpfCnpj: "geral", nome: "geral", nomeFantasia: "geral", inscricaoEstadual: "geral",
  segmento: "geral", origem: "geral", statusFinanceiro: "geral", ativo: "geral",
  email: "contatos", telefone: "contatos", celular: "contatos", contato: "contatos",
  observacoes: "relacionamento",
};

// Painel de aba (componente estável no escopo do módulo para não remontar
// os campos a cada render — abas inativas ficam apenas ocultas via CSS).
function Painel({ ativo, children }: { ativo: boolean; children: React.ReactNode }) {
  return <div className={cn("space-y-8", !ativo && "hidden")}>{children}</div>;
}

export function ClienteForm({ initialData, statusFinanceiroCalc, totalProximos30Dias }: ClienteFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const statusCalc: StatusFinanceiroCalc = statusFinanceiroCalc ?? "SEM_HISTORICO";
  const totalProx = totalProximos30Dias ?? 0;
  const qtdContratosAtivos = initialData?._count?.contratos ?? 0;
  const [erroGlobal, setErroGlobal] = useState("");
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [unidadesNovas, setUnidadesNovas] = useState<UnidadeLocal[]>([]);
  const [anexosNovos, setAnexosNovos] = useState<AnexoLocal[]>([]);
  const [contatosNovos, setContatosNovos] = useState<ContatoLocal[]>([]);
  const [razaoSocialBloqueada, setRazaoSocialBloqueada] = useState(false);
  const [config, setConfig] = useState<Partial<Configuracao>>({});
  const [satisfacao, setSatisfacao] = useState<number | null>(initialData?.satisfacao ?? null);

  // Abas
  const [aba, setAba] = useState("geral");
  const [abasErro, setAbasErro] = useState<Set<string>>(new Set());
  const [cnpjInfo, setCnpjInfo] = useState<{ nome: string; cidade?: string; estado?: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Controle do status ativo/inativo (header)
  const [statusOpen, setStatusOpen] = useState(false);
  const [mudandoAtivo, setMudandoAtivo] = useState(false);

  function mostrarToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  // Inativa/reativa o cliente via PATCH (sem salvar o formulário inteiro).
  async function alterarAtivo(novo: boolean) {
    if (!isEditing) return;
    setMudandoAtivo(true);
    try {
      const res = await fetch(`/api/clientes/${initialData!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativo: novo }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErroGlobal(e.erro ?? "Erro ao alterar status."); return; }
      setValue("ativo", novo);
      setStatusOpen(false);
      mostrarToast(novo ? "Cliente reativado." : "Cliente inativado.");
      router.refresh();
    } catch { setErroGlobal("Erro de conexão."); } finally { setMudandoAtivo(false); }
  }

  // Perfil de faturamento (gerenciado fora do RHF)
  const [tipoFaturamento, setTipoFaturamento] = useState<string>(initialData?.tipoFaturamento ?? "");
  const [diaFaturamento, setDiaFaturamento] = useState<number>(initialData?.diaFaturamento ?? 1);
  const [condicaoPagamento, setCondicaoPagamento] = useState<string>(initialData?.condicaoPagamento ?? "");
  const [exigePcAntesNf, setExigePcAntesNf] = useState<boolean>(initialData?.exigePcAntesNf ?? false);
  const [agrupaAdicionais, setAgrupaAdicionais] = useState<boolean>(initialData?.agrupaAdicionais ?? false);
  const [boletoUnicoMensal, setBoletoUnicoMensal] = useState<boolean>(initialData?.boletoUnicoMensal ?? false);
  const [emailsFaturamento, setEmailsFaturamento] = useState<string[]>(initialData?.emailsFaturamento ?? []);
  const [whatsappFaturamento, setWhatsappFaturamento] = useState<string>(initialData?.whatsappFaturamento ?? "");
  const [tabelaPrecoId, setTabelaPrecoId] = useState<string>(initialData?.tabelaPrecoId ?? "");
  const [tabelas, setTabelas] = useState<{ id: string; nome: string; tipo: string }[]>([]);
  const [portalAtivo, setPortalAtivo] = useState<boolean>(initialData?.portalAtivo ?? false);
  const [prefsEmail, setPrefsEmail] = useState({
    emailReceberBoletos: initialData?.emailReceberBoletos ?? true,
    emailReceberRelatorios: initialData?.emailReceberRelatorios ?? true,
    emailReceberLembretes: initialData?.emailReceberLembretes ?? true,
    emailReceberConfirmacoes: initialData?.emailReceberConfirmacoes ?? true,
    emailReceberOrcamentos: initialData?.emailReceberOrcamentos ?? true,
    emailReceberOs: initialData?.emailReceberOs ?? true,
  });
  const setPref = (k: string, v: boolean) => setPrefsEmail((p) => ({ ...p, [k]: v }));
  const [emailsCopia, setEmailsCopia] = useState<string[]>(initialData?.emailsCopia ?? []);

  useEffect(() => {
    fetch("/api/configuracoes").then((r) => r.json()).then(setConfig).catch(() => {});
    fetch("/api/tabelas-preco").then((r) => r.json()).then((d) => setTabelas(Array.isArray(d) ? d.filter((t: any) => t.ativo !== false) : [])).catch(() => {});
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
          segmento: initialData.segmento ?? undefined, origem: initialData.origem ?? undefined,
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
      if (!res.ok) { const err = await res.json(); setErroGlobal(err.erro ?? "Erro ao consultar CNPJ."); return; }
      const data = await res.json();
      if (data.nome) { setValue("nome", data.nome); setRazaoSocialBloqueada(true); }
      setCnpjInfo({ nome: data.nome ?? "", cidade: data.cidade, estado: data.estado });
      if (data.nomeFantasia) setValue("nomeFantasia", data.nomeFantasia);
      if (data.email) setValue("email", data.email);
      if (data.telefone) setValue("telefone", data.telefone);
      if (data.endereco) setValue("endereco", data.endereco);
      if (data.numero) setValue("numero", data.numero);
      if (data.complemento) setValue("complemento", data.complemento);
      if (data.bairro) setValue("bairro", data.bairro);
      if (data.cidade) setValue("cidade", data.cidade);
      if (data.estado) setValue("estado", data.estado);
      if (data.cep) setValue("cep", data.cep);
    } catch { setErroGlobal("Falha na consulta do CNPJ."); } finally { setBuscandoCnpj(false); }
  }

  // Valida regras dinâmicas da empresa; retorna { aba, msg } do primeiro erro
  function validarConfigDinamica(): { aba: string; msg: string } | null {
    if (config.clienteExigirUnidade && !isEditing && unidadesNovas.length === 0) return { aba: "enderecos", msg: "Adicione pelo menos um endereço antes de salvar (configuração da empresa)." };
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
    setErroGlobal(""); setAbasErro(new Set());
    const erroCfg = validarConfigDinamica();
    if (erroCfg) { setAbasErro(new Set([erroCfg.aba])); setAba(erroCfg.aba); setErroGlobal(erroCfg.msg); return; }

    const payload: any = {
      ...data,
      satisfacao,
      tipoFaturamento: tipoFaturamento || null,
      diaFaturamento,
      condicaoPagamento: condicaoPagamento || null,
      exigePcAntesNf,
      agrupaAdicionais,
      boletoUnicoMensal,
      emailsFaturamento,
      whatsappFaturamento: whatsappFaturamento || null,
      tabelaPrecoId: tabelaPrecoId || null,
      portalAtivo,
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
      if (continuar) {
        mostrarToast(isEditing ? "Alterações salvas com sucesso!" : "Cliente cadastrado com sucesso!");
        if (!isEditing && saved?.id) { router.push(`/clientes/${saved.id}/editar`); router.refresh(); }
        else router.refresh();
      } else {
        router.push("/clientes"); router.refresh();
      }
    } catch { setErroGlobal("Erro de conexão."); }
  }

  function reqLabel(base: string, cfgKey: keyof Configuracao): string {
    return config[cfgKey] ? `${base} *` : base;
  }

  const qtdContatos = isEditing ? (initialData!.contatosCliente?.length ?? 0) : contatosNovos.length;
  const qtdEnderecos = isEditing ? (initialData!.unidades?.length ?? 0) : unidadesNovas.length;
  const qtdAnexos = isEditing ? (initialData!.anexos?.length ?? 0) : anexosNovos.length;
  const contatosComPortal = (initialData?.contatosCliente ?? []).filter((c) => (c as any).senha);

  const ABAS = [
    { id: "geral", label: "Dados Gerais", icone: FileText },
    { id: "contatos", label: "Contatos", icone: Phone, badge: qtdContatos },
    { id: "comunicacao", label: "Comunicação", icone: Send },
    { id: "enderecos", label: "Endereços", icone: MapPin, badge: qtdEnderecos },
    { id: "contratos", label: "Contratos", icone: FileSignature, badge: qtdContratosAtivos },
    { id: "documentos", label: "Documentos e Mídia", icone: ImageIcon, badge: qtdAnexos },
    { id: "relacionamento", label: "Relacionamento", icone: Heart },
    { id: "portal", label: "Portal", icone: Headset },
  ];

  const salvar = handleSubmit((d) => onSubmit(d, false), onError);
  const salvarEContinuar = handleSubmit((d) => onSubmit(d, true), onError);
  const titulo = isEditing ? (initialData?.nome || "Editar cliente") : "Novo cliente";

  const BotoesAcao = ({ compact = false }: { compact?: boolean }) => (
    <div className="flex items-center gap-2 shrink-0">
      <Button type="button" variant="secondary" size={compact ? "sm" : "md"} onClick={() => router.push("/clientes")}>Cancelar</Button>
      <Button type="button" variant="outline" size={compact ? "sm" : "md"} loading={isSubmitting} onClick={salvarEContinuar}>
        <span className={compact ? "hidden lg:inline" : ""}>Salvar e continuar</span>
        <span className={compact ? "lg:hidden" : "hidden"}>Continuar</span>
      </Button>
      <Button type="button" variant="success" size={compact ? "sm" : "md"} loading={isSubmitting} onClick={salvar}>
        <FileCheck className="w-4 h-4" /> Salvar
      </Button>
    </div>
  );

  return (
    <form onSubmit={salvar} className="min-h-full -m-6 bg-[#F8FAFC] p-4 sm:p-6">
      {/* Toast de sucesso */}
      {toast && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2 bg-success-600 text-white text-sm font-medium rounded-xl px-4 py-3 shadow-card-hover animate-in fade-in slide-in-from-top-2">
          <FileCheck className="w-4 h-4" /> {toast}
        </div>
      )}

      <div className="max-w-7xl mx-auto space-y-5">
        {/* Cabeçalho fixo: título + status + ações */}
        <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#F8FAFC]/90 backdrop-blur border-b border-surface-border">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <h1 className="text-xl font-bold text-ink truncate">{titulo}</h1>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => setAba("contratos")}
                  title="Ver contratos do cliente"
                  className={cn(
                    "inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1 border transition-colors",
                    qtdContratosAtivos > 0
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                      : "bg-slate-100 border-slate-200 text-slate-500 hover:bg-slate-200",
                  )}
                >
                  <FileSignature className="w-3.5 h-3.5" />
                  {qtdContratosAtivos > 0
                    ? `${qtdContratosAtivos} contrato${qtdContratosAtivos > 1 ? "s" : ""} ativo${qtdContratosAtivos > 1 ? "s" : ""}`
                    : "Sem contratos"}
                </button>
              )}
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", COR_STATUS_FINANCEIRO_CALC[statusCalc])}>
                {LABELS_STATUS_FINANCEIRO_CALC[statusCalc]}
              </span>
              {isEditing ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setStatusOpen((o) => !o)}
                    title="Alterar status do cliente"
                    className={cn(
                      "inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1 border transition-colors",
                      ativoVal
                        ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                        : "bg-red-50 border-red-200 text-red-600 hover:bg-red-100",
                    )}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full", ativoVal ? "bg-emerald-500" : "bg-red-500")} />
                    {ativoVal ? "Ativo" : "Inativo"}
                  </button>
                  {statusOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setStatusOpen(false)} />
                      <div className="absolute left-0 mt-2 z-50 w-72 bg-white border border-surface-border rounded-xl shadow-card-hover p-3 space-y-3">
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
                <span className="inline-flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1 border bg-emerald-50 border-emerald-200 text-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Ativo
                </span>
              )}
            </div>
            <BotoesAcao compact />
          </div>
        </div>

        {erroGlobal && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {erroGlobal}
          </div>
        )}

        {/* Card central branco com abas + conteúdo */}
        <div className="bg-white rounded-2xl shadow-card border border-surface-border overflow-hidden">
          <nav className="flex gap-1.5 overflow-x-auto px-4 pt-4 pb-4 border-b border-surface-border">
            {ABAS.map((t) => {
              const ativa = aba === t.id;
              const comErro = abasErro.has(t.id);
              return (
                <button
                  key={t.id} type="button" onClick={() => setAba(t.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl whitespace-nowrap transition-all",
                    ativa ? "bg-primary-500 text-white shadow-sm" : "text-ink-muted hover:text-ink hover:bg-surface-alt",
                    comErro && !ativa && "text-red-600 bg-red-50",
                  )}
                >
                  <t.icone className="w-4 h-4" />
                  {t.label}
                  {t.badge != null && t.badge > 0 && (
                    <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", ativa ? "bg-white/25 text-white" : "bg-surface-alt text-ink-muted")}>{t.badge}</span>
                  )}
                  {comErro && <AlertCircle className={cn("w-3.5 h-3.5", ativa ? "text-white" : "text-red-500")} />}
                </button>
              );
            })}
          </nav>

          <div className="p-5 sm:p-6 lg:p-8">

      {/* ABA 1 — Dados Gerais */}
      <Painel ativo={aba === "geral"}>
        <FormSection title="Dados básicos" icon={<Building2 className="w-3.5 h-3.5" />}>
          <FormGrid>
            <FormField label="Tipo de pessoa" required>
              <Select {...register("tipoPessoa")} error={!!errors.tipoPessoa}>
                <option value="JURIDICA">Pessoa Jurídica</option>
                <option value="FISICA">Pessoa Física</option>
              </Select>
            </FormField>
            <FormField label={tipoPessoa === "FISICA" ? "CPF" : "CNPJ"} required error={errors.cpfCnpj?.message} hint={tipoPessoa === "JURIDICA" ? "Informe o CNPJ e clique em Buscar para preencher automaticamente." : undefined}>
              <div className="flex gap-2">
                <Input {...register("cpfCnpj")} placeholder={tipoPessoa === "FISICA" ? "000.000.000-00" : "00.000.000/0001-00"} error={!!errors.cpfCnpj} valido={!errors.cpfCnpj && !!cnpjInfo} className="flex-1" />
                {tipoPessoa === "JURIDICA" && (
                  <Button type="button" variant="success" loading={buscandoCnpj} onClick={buscarCnpj} className="shrink-0">
                    {!buscandoCnpj && <Search className="w-4 h-4" />}
                    <span className="hidden sm:inline ml-1">Buscar</span>
                  </Button>
                )}
              </div>
            </FormField>
          </FormGrid>
          {cnpjInfo && cnpjInfo.nome && (
            <div className="flex items-start gap-3 bg-success-50 border border-success-200 rounded-xl px-4 py-3 animate-in fade-in">
              <FileCheck className="w-5 h-5 text-success-600 shrink-0 mt-0.5" />
              <div className="text-sm min-w-0">
                <p className="font-semibold text-success-800">Dados encontrados na Receita Federal</p>
                <p className="text-success-700 truncate">
                  {cnpjInfo.nome}
                  {(cnpjInfo.cidade || cnpjInfo.estado) && ` — ${[cnpjInfo.cidade, cnpjInfo.estado].filter(Boolean).join("/")}`}
                </p>
              </div>
              <button type="button" onClick={() => setCnpjInfo(null)} className="ml-auto text-success-600 hover:text-success-800 shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <FormGrid>
            <FormField label={tipoPessoa === "FISICA" ? "Nome completo" : "Razão social"} required error={errors.nome?.message}>
              <div className="relative">
                <Input {...register("nome")} error={!!errors.nome} valido={!errors.nome && razaoSocialBloqueada} readOnly={razaoSocialBloqueada} className={razaoSocialBloqueada ? "bg-gray-100 text-gray-600 pr-20" : ""} />
                {razaoSocialBloqueada && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5 text-gray-400" />
                    <button type="button" onClick={() => setRazaoSocialBloqueada(false)} className="text-[11px] text-frivo-600 hover:underline flex items-center gap-0.5">
                      <Pencil className="w-3 h-3" /> Editar
                    </button>
                  </div>
                )}
              </div>
            </FormField>
            <FormField label={tipoPessoa === "FISICA" ? "Apelido" : "Nome fantasia"}>
              <Input {...register("nomeFantasia")} />
            </FormField>
          </FormGrid>
          {tipoPessoa === "JURIDICA" && (
            <FormGrid>
              <FormField label="Inscrição estadual"><Input {...register("inscricaoEstadual")} placeholder="Isento ou número" /></FormField>
            </FormGrid>
          )}
        </FormSection>

        <FormSection title="Classificação" icon={<Tag className="w-3.5 h-3.5" />}>
          <FormGrid cols={3}>
            <FormField label="Segmento">
              <Select {...register("segmento")} placeholder="Selecione">
                {Object.entries(LABELS_SEGMENTO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </Select>
            </FormField>
            <FormField label="Origem">
              <Select {...register("origem")} placeholder="Selecione">
                {Object.entries(LABELS_ORIGEM).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </Select>
            </FormField>
            <FormField label="Status financeiro" hint="Calculado automaticamente pelas contas a receber">
              <div className="flex flex-col gap-1.5 pt-1.5">
                <span className={cn("inline-flex w-fit items-center text-xs font-semibold px-2.5 py-1 rounded-full", COR_STATUS_FINANCEIRO_CALC[statusCalc])}>
                  {LABELS_STATUS_FINANCEIRO_CALC[statusCalc]}
                </span>
                {isEditing && statusCalc !== "SEM_HISTORICO" && totalProx > 0 && (
                  <Link
                    href={`/financeiro/contas-receber?clienteId=${initialData!.id}`}
                    className="inline-flex w-fit items-center gap-1 text-xs text-ink-muted hover:text-primary-600 transition-colors"
                  >
                    A receber (30 dias): {formatarMoeda(totalProx)}
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </FormField>
          </FormGrid>
        </FormSection>

        <FormSection title="Comercial" icon={<DollarSign className="w-3.5 h-3.5" />}>
          <FormGrid>
            <FormField label="Tabela de preços" hint="Sem seleção, usa a tabela Padrão da empresa">
              <Select value={tabelaPrecoId} onChange={(e) => setTabelaPrecoId(e.target.value)} placeholder="Padrão (automático)">
                {tabelas.map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
              </Select>
            </FormField>
          </FormGrid>
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mt-2">Perfil de Faturamento</p>
          <FormGrid>
            <FormField label="Tipo de faturamento" hint="Define o fluxo de aprovação e cobrança">
              <Select value={tipoFaturamento} onChange={(e) => setTipoFaturamento(e.target.value)} placeholder="Selecione">
                {Object.entries(LABELS_PERFIL_FATURAMENTO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </Select>
            </FormField>
            <FormField label="Dia de faturamento" hint="Dia do mês (1 a 28)">
              <Input type="number" min={1} max={28} value={diaFaturamento} onChange={(e) => setDiaFaturamento(Math.min(28, Math.max(1, Number(e.target.value) || 1)))} />
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Condição de pagamento" hint="Ex: 30 dias, 15 dias, à vista">
              <Input value={condicaoPagamento} onChange={(e) => setCondicaoPagamento(e.target.value)} placeholder="30 dias" />
            </FormField>
            <FormField label="WhatsApp para envio automático">
              <WhatsAppInput value={whatsappFaturamento} onChange={(e) => setWhatsappFaturamento(e.target.value)} placeholder="(00) 00000-0000" />
            </FormField>
          </FormGrid>
          {(tipoFaturamento === "COM_APROVACAO" || tipoFaturamento === "FATURA_UNICA") && (
            <div className="border-t border-gray-100 pt-1">
              <ToggleSwitch label="Exige PC (Pedido de Compra) antes da NF" description="A nota fiscal só pode ser emitida após o registro do PC do cliente." checked={exigePcAntesNf} onChange={setExigePcAntesNf} />
            </div>
          )}
          {tipoFaturamento === "FATURA_UNICA" && (
            <div className="divide-y divide-gray-100 border-t border-gray-100">
              <ToggleSwitch label="Agrupa adicionais do mês na fatura" description="Contrato e adicionais (OS/orçamentos) do mês entram numa fatura única." checked={agrupaAdicionais} onChange={setAgrupaAdicionais} />
              <ToggleSwitch label="Boleto único mensal" description="Gera um único boleto consolidando toda a fatura do mês." checked={boletoUnicoMensal} onChange={setBoletoUnicoMensal} />
            </div>
          )}
        </FormSection>

      </Painel>

      {/* ABA 2 — Contatos */}
      <Painel ativo={aba === "contatos"}>
        <FormSection title="Contatos do cliente" icon={<Users className="w-3.5 h-3.5" />}>
          <p className="text-xs text-gray-400 -mt-2 mb-3">
            {isEditing
              ? "Gerencie os contatos deste cliente. O tipo define quais comunicações cada um recebe (veja a aba Comunicação)."
              : "Adicione os contatos do cliente. O primeiro será marcado como principal."}
          </p>
          {isEditing ? (
            <ContatosManager clienteId={initialData!.id} contatosIniciais={initialData!.contatosCliente ?? []} />
          ) : (
            <ContatosLocal contatos={contatosNovos} onChange={setContatosNovos} />
          )}
        </FormSection>
      </Painel>

      {/* ABA — Comunicação */}
      <Painel ativo={aba === "comunicacao"}>
        <FormSection title="Contatos por área" icon={<Send className="w-3.5 h-3.5" />}>
          <p className="text-xs text-gray-400 -mt-2 mb-3">
            Os contatos são cadastrados na aba <strong>Contatos</strong> e aqui aparecem agrupados pelo tipo, indicando o que cada um recebe.
            Sem contato de um tipo, o sistema usa o e-mail principal do cliente.
          </p>
          {isEditing ? (
            <ComunicacaoContatos clienteId={initialData!.id} ativo={aba === "comunicacao"} onGerenciar={() => setAba("contatos")} />
          ) : (
            <p className="text-sm text-ink-muted">Salve o cliente para visualizar os contatos por área.</p>
          )}
        </FormSection>

        <FormSection title="Preferências de notificação" icon={<Mail className="w-3.5 h-3.5" />}>
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Operacional</p>
          <div className="divide-y divide-gray-100">
            <ToggleSwitch label="Receber atualizações de OS" description="Avisos de abertura/conclusão de ordens de serviço" checked={prefsEmail.emailReceberOs} onChange={(v) => setPref("emailReceberOs", v)} />
          </div>
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mt-4">Financeiro</p>
          <div className="divide-y divide-gray-100">
            <ToggleSwitch label="Receber boletos por e-mail" description="Envio automático de boletos emitidos" checked={prefsEmail.emailReceberBoletos} onChange={(v) => setPref("emailReceberBoletos", v)} />
            <ToggleSwitch label="Receber lembretes de vencimento" description="Avisos de cobranças a vencer/vencidas" checked={prefsEmail.emailReceberLembretes} onChange={(v) => setPref("emailReceberLembretes", v)} />
            <ToggleSwitch label="Receber confirmações de pagamento" description="Confirmação quando um pagamento é registrado" checked={prefsEmail.emailReceberConfirmacoes} onChange={(v) => setPref("emailReceberConfirmacoes", v)} />
          </div>
          <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mt-4">Contratual</p>
          <div className="divide-y divide-gray-100">
            <ToggleSwitch label="Receber orçamentos/propostas" description="Lembretes de orçamentos enviados/vencendo" checked={prefsEmail.emailReceberOrcamentos} onChange={(v) => setPref("emailReceberOrcamentos", v)} />
            <ToggleSwitch label="Receber relatórios/medições" description="Notifica quando o relatório está disponível" checked={prefsEmail.emailReceberRelatorios} onChange={(v) => setPref("emailReceberRelatorios", v)} />
          </div>
          <FormField label="E-mails adicionais para cópia (CC)" hint="Recebem cópia de todos os e-mails enviados ao cliente">
            <EmailsFaturamento emails={emailsCopia} onChange={setEmailsCopia} />
          </FormField>
        </FormSection>
      </Painel>

      {/* ABA 3 — Endereços */}
      <Painel ativo={aba === "enderecos"}>
        <FormSection title="Endereços do Cliente" icon={<MapPin className="w-3.5 h-3.5" />}>
          <p className="text-xs text-gray-400 -mt-2 mb-3">
            {isEditing
              ? "Gerencie os endereços do cliente. O endereço marcado com estrela é o principal."
              : config.clienteExigirUnidade
                ? "Adicione pelo menos o endereço principal do cliente (obrigatório)."
                : "Adicione os endereços do cliente."}
          </p>
          {isEditing ? (
            <UnidadesManager clienteId={initialData!.id} unidadesIniciais={initialData!.unidades ?? []}
              enderecoCliente={{ endereco: initialData!.endereco, numero: initialData!.numero, complemento: initialData!.complemento, bairro: initialData!.bairro, cidade: initialData!.cidade, estado: initialData!.estado, cep: initialData!.cep, telefone: initialData!.telefone }} />
          ) : (
            <UnidadesLocal unidades={unidadesNovas} onChange={setUnidadesNovas} />
          )}
        </FormSection>
      </Painel>

      {/* ABA — Contratos */}
      <Painel ativo={aba === "contratos"}>
        <FormSection title="Contratos do cliente" icon={<FileSignature className="w-3.5 h-3.5" />}>
          {isEditing ? (
            <ClienteContratos clienteId={initialData!.id} />
          ) : (
            <p className="text-sm text-ink-muted">Salve o cliente para gerenciar os contratos.</p>
          )}
        </FormSection>
      </Painel>

      {/* ABA 5 — Documentos e Mídia */}
      <Painel ativo={aba === "documentos"}>
        {isEditing && (
          <FormSection title="Logomarca" icon={<ImageIcon className="w-3.5 h-3.5" />}>
            <LogoUpload clienteId={initialData!.id} logoInicial={initialData!.logo} />
          </FormSection>
        )}
        <FormSection title="Anexos" icon={<Paperclip className="w-3.5 h-3.5" />}>
          {isEditing
            ? <AnexosManager clienteId={initialData!.id} anexosIniciais={initialData!.anexos ?? []} />
            : <AnexosLocal anexos={anexosNovos} onChange={setAnexosNovos} />}
        </FormSection>
        {!isEditing && <p className="text-xs text-gray-400">A logomarca pode ser enviada após salvar o cliente.</p>}
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
          <FormSection title="Histórico de Interações" icon={<MessageSquare className="w-3.5 h-3.5" />}>
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
        <FormSection title="Portal do Cliente" icon={<Globe className="w-3.5 h-3.5" />}>
          <p className="text-xs text-gray-400 -mt-2 mb-1">
            Habilita o acesso do cliente ao portal externo. O acesso individual e as permissões de cada contato são definidos na aba <strong>Contatos</strong>.
          </p>
          <ToggleSwitch
            label="Portal ativo"
            description="Quando desligado, nenhum contato deste cliente consegue acessar o portal."
            checked={portalAtivo}
            onChange={setPortalAtivo}
          />
          {!isEditing ? (
            <p className="text-xs text-gray-400">Salve o cliente para conceder acesso de portal aos contatos.</p>
          ) : contatosComPortal.length === 0 ? (
            <p className="text-sm text-ink-muted">Nenhum contato com acesso ao portal ainda. Conceda o acesso na aba <strong>Contatos</strong>.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Contatos com acesso</p>
              {contatosComPortal.map((c) => {
                const perms = ((c as any).permissoes as Record<string, boolean> | null) ?? {};
                const qtd = PERMISSOES_PORTAL.filter((p) => perms[p.chave]).length;
                return (
                  <div key={c.id} className="flex items-center justify-between border border-surface-border rounded-lg px-3 py-2 text-sm">
                    <span className="flex items-center gap-2"><Headset className="w-4 h-4 text-primary-600" /> {c.nome} <span className="text-ink-muted">· {c.email}</span></span>
                    <span className="text-xs text-ink-muted">{qtd} permissão(ões)</span>
                  </div>
                );
              })}
            </div>
          )}
        </FormSection>
      </Painel>
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

function EmailsFaturamento({ emails, onChange }: { emails: string[]; onChange: (e: string[]) => void }) {
  const [novo, setNovo] = useState("");

  function adicionar() {
    const e = novo.trim().toLowerCase();
    if (!e) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return;
    if (emails.includes(e)) { setNovo(""); return; }
    onChange([...emails, e]);
    setNovo("");
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          type="email"
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }}
          placeholder="financeiro@cliente.com.br"
          className="flex-1"
        />
        <Button type="button" variant="secondary" onClick={adicionar} className="shrink-0">
          <Plus className="w-4 h-4" /> Adicionar
        </Button>
      </div>
      {emails.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {emails.map((e) => (
            <span key={e} className="inline-flex items-center gap-1.5 bg-primary-50 text-primary-700 text-xs font-medium rounded-full pl-3 pr-1.5 py-1">
              <Mail className="w-3 h-3" /> {e}
              <button type="button" onClick={() => onChange(emails.filter((x) => x !== e))} className="p-0.5 hover:bg-primary-100 rounded-full">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
