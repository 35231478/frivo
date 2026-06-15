"use client";

import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { contratoSchema, type ContratoInput } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ContratoDocumentos } from "@/components/forms/contrato-documentos";
import {
  FREQUENCIAS_RECORRENCIA, LABELS_PERIODICIDADE, LABELS_TRATAMENTO_FIM_SEMANA,
  LABELS_TIPO_CONTRATO, LABELS_STATUS_CONTRATO, STATUS_CONTRATO_FORM,
  LABELS_AJUSTE_FIM_SEMANA, LABELS_TIPO_VENCIMENTO, LABELS_INDICE_REAJUSTE,
  LABELS_PERIODO_REF_NFSE, LABELS_PERIODO_VISITA, LABELS_MES, ITENS_INCLUSOS_CONTRATO,
  formatarMoeda, formatarData, cn,
} from "@/lib/utils";
import type { Contrato, Tecnico, Unidade } from "@prisma/client";
import {
  FileText, CalendarClock, ClipboardList, HardHat, MapPin, TrendingUp, BellRing,
  Paperclip, Repeat, StickyNote, Building2, FileCheck, AlertCircle, Wand2, DollarSign, Receipt,
} from "lucide-react";

function toDateInput(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}

type ClienteItem = { id: string; nome: string; nomeFantasia?: string | null };
type ResponsavelItem = Pick<Tecnico, "id" | "nome" | "crea">;
type AnexoItem = { id: string; nome: string; tipo: string; tamanho: number; categoria?: string | null; criadoEm: string | Date };
type ReajusteItem = { id: string; data: string | Date; indice: string; percentual: any; valorAnterior: any; valorNovo: any };

interface ContratoComRelacoes extends Contrato {
  unidades?: Array<{ unidade: Unidade }>;
  responsavelTecnico?: ResponsavelItem | null;
  anexos?: AnexoItem[];
  reajustes?: ReajusteItem[];
}

interface ContratoFormProps {
  initialData?: ContratoComRelacoes;
}

function Painel({ ativo, children }: { ativo: boolean; children: React.ReactNode }) {
  return <div className={cn("space-y-8", !ativo && "hidden")}>{children}</div>;
}

// Campo → aba (para destacar abas com erro de validação)
const CAMPO_ABA: Record<string, string> = {
  clienteId: "dados", numero: "dados", tipo: "dados", status: "dados", periodicidade: "dados",
  valorMensal: "vigencia", valorTotal: "vigencia", dataInicio: "vigencia", dataFim: "vigencia",
};

export function ContratoForm({ initialData }: ContratoFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEditing = !!initialData;
  const clienteIdParam = searchParams.get("clienteId") ?? "";
  const [erroGlobal, setErroGlobal] = useState("");
  const [aba, setAba] = useState("dados");
  const [abasErro, setAbasErro] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const [clientes, setClientes] = useState<ClienteItem[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [responsaveis, setResponsaveis] = useState<ResponsavelItem[]>([]);
  const [tiposOs, setTiposOs] = useState<{ id: string; nome: string }[]>([]);
  const [tecnicos, setTecnicos] = useState<{ id: string; nome: string }[]>([]);
  const [clienteIdSelecionado, setClienteIdSelecionado] = useState(initialData?.clienteId ?? clienteIdParam);
  const [gerandoNumero, setGerandoNumero] = useState(false);

  // Itens inclusos do escopo (JSON) — gerenciado fora do RHF
  const itensIniciais = (initialData?.itensInclusos as Record<string, any> | null) ?? {};
  const [itensInclusos, setItensInclusos] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const it of ITENS_INCLUSOS_CONTRATO) o[it.chave] = !!itensIniciais[it.chave];
    return o;
  });
  const [outrosItens, setOutrosItens] = useState<string>(itensIniciais.outros ?? "");

  const unidadeIdsIniciais = initialData?.unidades?.map((u) => u.unidade.id) ?? [];

  const {
    register, handleSubmit, control, watch, setValue,
    formState: { errors, isSubmitting },
  } = useForm<ContratoInput>({
    resolver: zodResolver(contratoSchema),
    defaultValues: initialData
      ? {
          clienteId: initialData.clienteId,
          numero: initialData.numero,
          tipo: initialData.tipo,
          status: initialData.status,
          periodicidade: initialData.periodicidade,
          valorMensal: initialData.valorMensal ? Number(initialData.valorMensal) : undefined,
          valorTotal: initialData.valorTotal ? Number(initialData.valorTotal) : undefined,
          dataInicio: toDateInput(initialData.dataInicio),
          dataFim: toDateInput(initialData.dataFim),
          diaVencimento: initialData.diaVencimento ?? undefined,
          artNumero: initialData.artNumero ?? "",
          responsavelTecnicoId: initialData.responsavelTecnicoId ?? "",
          observacoes: initialData.observacoes ?? "",
          unidadeIds: unidadeIdsIniciais,
          recorrencia: initialData.recorrencia ?? false,
          frequenciaRecorrencia: initialData.frequenciaRecorrencia ?? null,
          diaRecorrencia: initialData.diaRecorrencia ?? null,
          fimSemanaRecorrencia: initialData.fimSemanaRecorrencia ?? null,
          tipoOsRecorrenciaId: initialData.tipoOsRecorrenciaId ?? "",
          tecnicoRecorrenciaId: initialData.tecnicoRecorrenciaId ?? "",
          // Faturamento / NFS-e
          diaFaturamento: initialData.diaFaturamento ?? undefined,
          tipoVencimento: initialData.tipoVencimento ?? undefined,
          diasAposVencimento: initialData.diasAposVencimento ?? undefined,
          diaFixoMes: initialData.diaFixoMes ?? undefined,
          ajusteFinsDeSemana: initialData.ajusteFinsDeSemana ?? undefined,
          descricaoNFSe: initialData.descricaoNFSe ?? "",
          adicionarPeriodoRef: initialData.adicionarPeriodoRef ?? false,
          periodoRefOpcao: initialData.periodoRefOpcao ?? undefined,
          adicionarNumContrato: initialData.adicionarNumContrato ?? false,
          adicionarVencimentoNFSe: initialData.adicionarVencimentoNFSe ?? false,
          // Escopo
          descricaoServicos: initialData.descricaoServicos ?? "",
          qtdVisitas: initialData.qtdVisitas ?? undefined,
          periodoVisitas: initialData.periodoVisitas ?? undefined,
          // RT
          artVencimento: toDateInput(initialData.artVencimento),
          exibirRTNFSe: initialData.exibirRTNFSe ?? false,
          exibirRTPDF: initialData.exibirRTPDF ?? false,
          // Reajuste
          reajusteAtivo: initialData.reajusteAtivo ?? false,
          reajusteIndice: initialData.reajusteIndice ?? undefined,
          reajustePercentual: initialData.reajustePercentual ? Number(initialData.reajustePercentual) : undefined,
          reajusteMesAniversario: initialData.reajusteMesAniversario ?? undefined,
          reajusteNotificar: initialData.reajusteNotificar ?? false,
          reajusteNotificarDias: initialData.reajusteNotificarDias ?? undefined,
          // Alertas
          alertaDias: initialData.alertaDias ?? 30,
          renovacaoAutomatica: initialData.renovacaoAutomatica ?? false,
          renovacaoMeses: initialData.renovacaoMeses ?? undefined,
          notificarClienteRenovacao: initialData.notificarClienteRenovacao ?? false,
          notificarClienteDias: initialData.notificarClienteDias ?? undefined,
          alertaEmailCliente: initialData.alertaEmailCliente ?? false,
        }
      : {
          clienteId: clienteIdParam || undefined,
          status: "ATIVO",
          periodicidade: "MENSAL",
          unidadeIds: [],
          numero: `CT-${new Date().getFullYear()}-`,
          recorrencia: false,
          diaFaturamento: undefined,
          tipoVencimento: "DIAS_APOS_FATURAMENTO",
          ajusteFinsDeSemana: "MANTER",
          adicionarPeriodoRef: false,
          adicionarNumContrato: false,
          adicionarVencimentoNFSe: false,
          exibirRTNFSe: false,
          exibirRTPDF: false,
          reajusteAtivo: false,
          reajusteNotificar: false,
          alertaDias: 30,
          renovacaoAutomatica: false,
          notificarClienteRenovacao: false,
          alertaEmailCliente: false,
        },
  });

  const recorrenciaAtiva = watch("recorrencia");
  const reajusteAtivo = watch("reajusteAtivo");
  const reajusteIndiceVal = watch("reajusteIndice");
  const renovacaoAtiva = watch("renovacaoAutomatica");
  const notificarRenov = watch("notificarClienteRenovacao");
  const reajusteNotificarVal = watch("reajusteNotificar");
  const adicionarPeriodoRefVal = watch("adicionarPeriodoRef");
  const tipoVencimentoVal = watch("tipoVencimento");
  const statusVal = watch("status");
  const dataFimVal = watch("dataFim");

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then((d) => setClientes(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/tecnicos?tipo=RESPONSAVEL_TECNICO").then((r) => r.json()).then((d) => setResponsaveis(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/tipos-os").then((r) => r.json()).then((d) => setTiposOs(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/tecnicos").then((r) => r.json()).then((d) => setTecnicos(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clienteIdSelecionado) { setUnidades([]); return; }
    fetch(`/api/unidades?clienteId=${clienteIdSelecionado}`).then((r) => r.json()).then((d) => setUnidades(Array.isArray(d) ? d : [])).catch(() => {});
  }, [clienteIdSelecionado]);

  function mostrarToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  async function gerarNumero() {
    setGerandoNumero(true);
    try {
      const res = await fetch("/api/contratos/proximo-numero");
      if (res.ok) { const d = await res.json(); if (d.numero) setValue("numero", d.numero); }
    } catch {} finally { setGerandoNumero(false); }
  }

  function onError(errs: typeof errors) {
    const abas = new Set<string>();
    Object.keys(errs).forEach((c) => { const a = CAMPO_ABA[c]; if (a) abas.add(a); });
    setAbasErro(abas);
    const primeira = ABAS.find((t) => abas.has(t.id));
    if (primeira) { setAba(primeira.id); setErroGlobal(`Verifique os campos obrigatórios na aba "${primeira.label}".`); }
  }

  async function onSubmit(data: ContratoInput, continuar = false) {
    setErroGlobal(""); setAbasErro(new Set());
    const payload: any = {
      ...data,
      itensInclusos: { ...itensInclusos, outros: outrosItens || undefined },
      // Fallback: vencimento da ART = fim da vigência, se não informado
      artVencimento: data.artVencimento || data.dataFim || undefined,
    };
    try {
      const url = isEditing ? `/api/contratos/${initialData!.id}` : "/api/contratos";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const err = await res.json(); setErroGlobal(err.erro ?? "Erro ao salvar contrato."); return; }
      const saved = await res.json().catch(() => ({}));
      if (continuar) {
        mostrarToast(isEditing ? "Alterações salvas!" : "Contrato cadastrado!");
        if (!isEditing && saved?.id) { router.push(`/contratos/${saved.id}/editar`); router.refresh(); }
        else router.refresh();
      } else {
        router.push("/contratos"); router.refresh();
      }
    } catch { setErroGlobal("Erro de conexão. Tente novamente."); }
  }

  const ABAS = [
    { id: "dados", label: "Dados do contrato", icone: FileText },
    { id: "vigencia", label: "Vigência e Valores", icone: CalendarClock },
    { id: "escopo", label: "Escopo", icone: ClipboardList },
    { id: "rt", label: "Responsabilidade Técnica", icone: HardHat },
    { id: "locais", label: "Locais cobertos", icone: MapPin },
    { id: "reajuste", label: "Reajuste", icone: TrendingUp },
    { id: "alertas", label: "Alertas e Renovação", icone: BellRing },
    { id: "documentos", label: "Documentos", icone: Paperclip },
    { id: "recorrencia", label: "Recorrência de OS", icone: Repeat },
    { id: "observacoes", label: "Observações", icone: StickyNote },
  ];

  const salvar = handleSubmit((d) => onSubmit(d, false), onError);
  const salvarEContinuar = handleSubmit((d) => onSubmit(d, true), onError);
  const titulo = isEditing ? (initialData?.numero || "Editar contrato") : "Novo contrato";

  function badgeVigencia(): { txt: string; cls: string } {
    if (!dataFimVal) return { txt: "Vigência indeterminada", cls: "bg-slate-100 text-slate-600" };
    const fim = new Date(`${dataFimVal}T00:00:00`);
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const dias = Math.round((fim.getTime() - hoje.getTime()) / 86400000);
    if (dias < 0) return { txt: `Vencido há ${Math.abs(dias)} dias`, cls: "bg-red-50 text-red-700" };
    if (dias <= 30) return { txt: `Vence em ${dias} dias`, cls: "bg-amber-50 text-amber-700" };
    return { txt: `Vence em ${dias} dias`, cls: "bg-success-50 text-success-700" };
  }
  const bv = badgeVigencia();

  const BotoesAcao = ({ compact = false }: { compact?: boolean }) => (
    <div className="flex items-center gap-2 shrink-0">
      <Button type="button" variant="secondary" size={compact ? "sm" : "md"} onClick={() => router.push("/contratos")}>Cancelar</Button>
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
      {toast && (
        <div className="fixed top-5 right-5 z-50 flex items-center gap-2 bg-success-600 text-white text-sm font-medium rounded-xl px-4 py-3 shadow-card-hover animate-in fade-in slide-in-from-top-2">
          <FileCheck className="w-4 h-4" /> {toast}
        </div>
      )}

      <div className="max-w-7xl mx-auto space-y-5">
        {/* Cabeçalho fixo */}
        <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#F8FAFC]/90 backdrop-blur border-b border-surface-border">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <h1 className="text-xl font-bold text-ink truncate">{titulo}</h1>
              {statusVal && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary-50 text-primary-700">
                  {LABELS_STATUS_CONTRATO[statusVal] ?? statusVal}
                </span>
              )}
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", bv.cls)}>{bv.txt}</span>
            </div>
            <BotoesAcao compact />
          </div>
        </div>

        {erroGlobal && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" /> {erroGlobal}
          </div>
        )}

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
                  {comErro && <AlertCircle className={cn("w-3.5 h-3.5", ativa ? "text-white" : "text-red-500")} />}
                </button>
              );
            })}
          </nav>

          <div className="p-5 sm:p-6 lg:p-8">

      {/* ABA 1 — Dados do contrato */}
      <Painel ativo={aba === "dados"}>
        <FormSection title="Dados do contrato" icon={<FileText className="w-3.5 h-3.5" />}>
          <FormGrid>
            <FormField label="Cliente" required error={errors.clienteId?.message}>
              <Select
                {...register("clienteId", { onChange: (e) => setClienteIdSelecionado(e.target.value) })}
                error={!!errors.clienteId}
                placeholder="Selecione o cliente"
              >
                {clientes.map((c) => (<option key={c.id} value={c.id}>{c.nomeFantasia ?? c.nome}</option>))}
              </Select>
            </FormField>
            <FormField label="Número do contrato" required error={errors.numero?.message} hint="Ex: CT-2024-001">
              <div className="flex gap-2">
                <Input {...register("numero")} error={!!errors.numero} placeholder="CT-2024-001" className="flex-1" />
                <Button type="button" variant="secondary" loading={gerandoNumero} onClick={gerarNumero} className="shrink-0">
                  <Wand2 className="w-4 h-4" /> <span className="hidden sm:inline">Gerar automático</span>
                </Button>
              </div>
            </FormField>
          </FormGrid>
          <FormGrid cols={3}>
            <FormField label="Tipo" required error={errors.tipo?.message}>
              <Select {...register("tipo")} error={!!errors.tipo} placeholder="Selecione o tipo">
                {Object.entries(LABELS_TIPO_CONTRATO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </Select>
            </FormField>
            <FormField label="Status" required>
              <Select {...register("status")}>
                {STATUS_CONTRATO_FORM.map((v) => (<option key={v} value={v}>{LABELS_STATUS_CONTRATO[v]}</option>))}
              </Select>
            </FormField>
            <FormField label="Periodicidade" required>
              <Select {...register("periodicidade")}>
                {Object.entries(LABELS_PERIODICIDADE).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </Select>
            </FormField>
          </FormGrid>
        </FormSection>
      </Painel>

      {/* ABA 2 — Vigência e Valores */}
      <Painel ativo={aba === "vigencia"}>
        <FormSection title="Valores e vigência" icon={<DollarSign className="w-3.5 h-3.5" />}>
          <FormGrid cols={3}>
            <FormField label="Valor mensal (R$)" hint="Gera previsão de contas a receber" error={errors.valorMensal?.message}>
              <Input {...register("valorMensal", { valueAsNumber: true })} type="number" step="0.01" min="0" placeholder="0,00" error={!!errors.valorMensal} />
            </FormField>
            <FormField label="Valor total (R$)" error={errors.valorTotal?.message}>
              <Input {...register("valorTotal", { valueAsNumber: true })} type="number" step="0.01" min="0" placeholder="0,00" error={!!errors.valorTotal} />
            </FormField>
            <FormField label="Dia de faturamento" hint="1 a 28">
              <Input {...register("diaFaturamento")} type="number" min={1} max={28} placeholder="1" />
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Início da vigência" required error={errors.dataInicio?.message}>
              <Input {...register("dataInicio")} type="date" error={!!errors.dataInicio} />
            </FormField>
            <FormField label="Fim da vigência" hint="Em branco = indeterminado">
              <Input {...register("dataFim")} type="date" />
            </FormField>
          </FormGrid>

          <div className="space-y-2">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Tipo de vencimento</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={cn("flex flex-col gap-2 p-3 border rounded-lg cursor-pointer transition-colors", tipoVencimentoVal === "DIAS_APOS_FATURAMENTO" ? "border-primary-400 bg-primary-50/40" : "border-surface-border hover:border-primary-300")}>
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="radio" checked={tipoVencimentoVal === "DIAS_APOS_FATURAMENTO"} onChange={() => setValue("tipoVencimento", "DIAS_APOS_FATURAMENTO")} className="accent-primary-600" />
                  {LABELS_TIPO_VENCIMENTO.DIAS_APOS_FATURAMENTO}
                </span>
                <Input {...register("diasAposVencimento")} type="number" min={0} placeholder="30" disabled={tipoVencimentoVal !== "DIAS_APOS_FATURAMENTO"} />
              </label>
              <label className={cn("flex flex-col gap-2 p-3 border rounded-lg cursor-pointer transition-colors", tipoVencimentoVal === "DIA_FIXO_MES" ? "border-primary-400 bg-primary-50/40" : "border-surface-border hover:border-primary-300")}>
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="radio" checked={tipoVencimentoVal === "DIA_FIXO_MES"} onChange={() => setValue("tipoVencimento", "DIA_FIXO_MES")} className="accent-primary-600" />
                  {LABELS_TIPO_VENCIMENTO.DIA_FIXO_MES}
                </span>
                <Input {...register("diaFixoMes")} type="number" min={1} max={31} placeholder="10" disabled={tipoVencimentoVal !== "DIA_FIXO_MES"} />
              </label>
            </div>
          </div>

          <FormField label="Sábados, domingos e feriados nacionais" hint="Ajuste do vencimento que cai em dia não útil">
            <Select {...register("ajusteFinsDeSemana")}>
              {Object.entries(LABELS_AJUSTE_FIM_SEMANA).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </Select>
          </FormField>
        </FormSection>

        <FormSection title="Configurações da NFS-e" icon={<Receipt className="w-3.5 h-3.5" />}>
          <FormField label="Descrição para NFS-e" hint="Aparece na nota fiscal exatamente como escrito">
            <Textarea {...register("descricaoNFSe")} rows={3} placeholder="Serviços de manutenção preventiva de climatização…" />
          </FormField>
          <div className="border-t border-gray-100 pt-1 divide-y divide-gray-100">
            <ToggleSwitch
              label="Adicionar período de referência"
              description="Inclui o mês de referência na descrição da NFS-e."
              checked={!!adicionarPeriodoRefVal}
              onChange={(v) => setValue("adicionarPeriodoRef", v)}
            />
            {adicionarPeriodoRefVal && (
              <div className="py-3">
                <FormField label="Período de referência">
                  <Select {...register("periodoRefOpcao")} placeholder="Selecione">
                    {Object.entries(LABELS_PERIODO_REF_NFSE).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                  </Select>
                </FormField>
              </div>
            )}
            <ToggleSwitch
              label="Adicionar Nº do contrato à descrição dos serviços"
              description="Inclui o número do contrato na descrição da NFS-e."
              checked={!!watch("adicionarNumContrato")}
              onChange={(v) => setValue("adicionarNumContrato", v)}
            />
            <ToggleSwitch
              label="Adicionar vencimento da parcela à descrição"
              description={'Formato: "Contrato N. XXXX - Ref. Mês/Ano - Vencto. DD/MM/AAAA"'}
              checked={!!watch("adicionarVencimentoNFSe")}
              onChange={(v) => setValue("adicionarVencimentoNFSe", v)}
            />
          </div>
        </FormSection>
      </Painel>

      {/* ABA 3 — Escopo */}
      <Painel ativo={aba === "escopo"}>
        <FormSection title="Escopo dos serviços" icon={<ClipboardList className="w-3.5 h-3.5" />}>
          <FormField label="Descrição dos serviços" hint="O que está incluso no contrato">
            <Textarea {...register("descricaoServicos")} rows={4} placeholder="Descreva os serviços contratados…" />
          </FormField>

          <div className="space-y-2">
            <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Itens inclusos</p>
            <div className="space-y-2">
              {ITENS_INCLUSOS_CONTRATO.map((it) => (
                <label key={it.chave} className="flex items-center gap-3 p-2.5 border border-surface-border rounded-lg cursor-pointer hover:border-primary-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={!!itensInclusos[it.chave]}
                    onChange={(e) => setItensInclusos((p) => ({ ...p, [it.chave]: e.target.checked }))}
                    className="accent-primary-600"
                  />
                  <span className="text-sm text-ink">{it.label}</span>
                </label>
              ))}
            </div>
            <FormField label="Outros itens inclusos">
              <Input value={outrosItens} onChange={(e) => setOutrosItens(e.target.value)} placeholder="Descreva outros itens (texto livre)" />
            </FormField>
          </div>

          <FormGrid>
            <FormField label="Quantidade de visitas inclusas">
              <Input {...register("qtdVisitas")} type="number" min={0} placeholder="1" />
            </FormField>
            <FormField label="Período das visitas">
              <Select {...register("periodoVisitas")} placeholder="Selecione">
                {Object.entries(LABELS_PERIODO_VISITA).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </Select>
            </FormField>
          </FormGrid>
        </FormSection>
      </Painel>

      {/* ABA 4 — Responsabilidade Técnica */}
      <Painel ativo={aba === "rt"}>
        <FormSection title="Responsabilidade técnica" icon={<HardHat className="w-3.5 h-3.5" />}>
          <FormGrid>
            <FormField label="Responsável técnico" hint="Colaborador responsável por este contrato">
              <Select {...register("responsavelTecnicoId")} placeholder="Selecione">
                {responsaveis.map((rt) => (<option key={rt.id} value={rt.id}>{rt.nome}{rt.crea ? ` — CREA ${rt.crea}` : ""}</option>))}
              </Select>
            </FormField>
            <FormField label="Número ART" hint="Anotação de Responsabilidade Técnica">
              <Input {...register("artNumero")} placeholder="Ex: ART-2024-005678" />
            </FormField>
          </FormGrid>
          <FormGrid>
            <FormField label="Vencimento da ART" hint="Se vazio, assume o fim da vigência do contrato">
              <Input {...register("artVencimento")} type="date" />
            </FormField>
          </FormGrid>
          <div className="border-t border-gray-100 pt-1 divide-y divide-gray-100">
            <ToggleSwitch label="Exibir responsável técnico e ART na NFS-e" description="" checked={!!watch("exibirRTNFSe")} onChange={(v) => setValue("exibirRTNFSe", v)} />
            <ToggleSwitch label="Exibir responsável técnico e ART no PDF/relatório da OS" description="" checked={!!watch("exibirRTPDF")} onChange={(v) => setValue("exibirRTPDF", v)} />
          </div>
        </FormSection>
      </Painel>

      {/* ABA 5 — Locais cobertos */}
      <Painel ativo={aba === "locais"}>
        <FormSection title="Locais cobertos pelo contrato" icon={<MapPin className="w-3.5 h-3.5" />}>
          {!clienteIdSelecionado ? (
            <p className="text-sm text-ink-muted py-3">Selecione um cliente primeiro (aba "Dados do contrato").</p>
          ) : unidades.length === 0 ? (
            <p className="text-sm text-ink-muted py-3">Nenhum endereço cadastrado para este cliente.</p>
          ) : (
            <Controller
              name="unidadeIds"
              control={control}
              render={({ field }) => (
                <div className="space-y-2">
                  {unidades.map((u) => {
                    const selecionado = field.value?.includes(u.id) ?? false;
                    return (
                      <label key={u.id} className="flex items-start gap-3 p-3 border border-surface-border rounded-lg hover:border-primary-300 cursor-pointer transition-colors">
                        <input
                          type="checkbox"
                          checked={selecionado}
                          onChange={(e) => {
                            const atual = field.value ?? [];
                            field.onChange(e.target.checked ? [...atual, u.id] : atual.filter((id) => id !== u.id));
                          }}
                          className="mt-0.5 accent-primary-600"
                        />
                        <div className="flex items-center gap-2">
                          <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-ink">{u.nome}</p>
                            <p className="text-xs text-ink-subtle">
                              {[u.logradouro, u.numero, u.bairro, u.cidade, u.estado].filter(Boolean).join(", ") || "Sem endereço"}
                            </p>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            />
          )}
        </FormSection>
      </Painel>

      {/* ABA 6 — Reajuste */}
      <Painel ativo={aba === "reajuste"}>
        <FormSection title="Reajuste automático" icon={<TrendingUp className="w-3.5 h-3.5" />}>
          <ToggleSwitch
            label="Reajuste automático"
            description="Aplica reajuste periódico ao valor do contrato."
            checked={!!reajusteAtivo}
            onChange={(v) => setValue("reajusteAtivo", v)}
          />
          {reajusteAtivo && (
            <div className="space-y-4 border-l-2 border-primary-200 pl-4 mt-2">
              <FormGrid cols={3}>
                <FormField label="Índice">
                  <Select {...register("reajusteIndice")} placeholder="Selecione">
                    {Object.entries(LABELS_INDICE_REAJUSTE).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                  </Select>
                </FormField>
                {reajusteIndiceVal === "PERCENTUAL_FIXO" && (
                  <FormField label="Percentual fixo (%)">
                    <Input {...register("reajustePercentual")} type="number" step="0.001" min={0} placeholder="0,00" />
                  </FormField>
                )}
                <FormField label="Mês de aniversário">
                  <Select {...register("reajusteMesAniversario")} placeholder="Selecione">
                    {Object.entries(LABELS_MES).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                  </Select>
                </FormField>
              </FormGrid>
              <div className="border-t border-gray-100 pt-1 divide-y divide-gray-100">
                <ToggleSwitch label="Notificar antes do reajuste" description="" checked={!!reajusteNotificarVal} onChange={(v) => setValue("reajusteNotificar", v)} />
              </div>
              {reajusteNotificarVal && (
                <FormField label="Dias de antecedência">
                  <Input {...register("reajusteNotificarDias")} type="number" min={0} placeholder="30" />
                </FormField>
              )}
            </div>
          )}
        </FormSection>

        <FormSection title="Histórico de reajustes" icon={<TrendingUp className="w-3.5 h-3.5" />}>
          {!isEditing || !initialData?.reajustes?.length ? (
            <p className="text-sm text-ink-muted py-2">Nenhum reajuste aplicado ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-alt border-b border-surface-border">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Data</th>
                    <th className="text-left px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Índice</th>
                    <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase">% aplicado</th>
                    <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Valor anterior</th>
                    <th className="text-right px-3 py-2 font-semibold text-ink-muted text-xs uppercase">Valor novo</th>
                  </tr>
                </thead>
                <tbody>
                  {initialData!.reajustes!.map((r) => (
                    <tr key={r.id} className="border-b border-surface-border">
                      <td className="px-3 py-2 text-ink">{formatarData(r.data)}</td>
                      <td className="px-3 py-2 text-ink">{LABELS_INDICE_REAJUSTE[r.indice] ?? r.indice}</td>
                      <td className="px-3 py-2 text-right text-ink">{Number(r.percentual).toFixed(2)}%</td>
                      <td className="px-3 py-2 text-right text-ink-muted">{formatarMoeda(Number(r.valorAnterior))}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">{formatarMoeda(Number(r.valorNovo))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </FormSection>
      </Painel>

      {/* ABA 7 — Alertas e Renovação */}
      <Painel ativo={aba === "alertas"}>
        <FormSection title="Alertas de vencimento" icon={<BellRing className="w-3.5 h-3.5" />}>
          <FormGrid>
            <FormField label="Alertar antes do vencimento" hint="Gera notificação no sistema">
              <div className="flex items-center gap-2">
                <Input {...register("alertaDias")} type="number" min={0} placeholder="30" className="w-28" />
                <span className="text-sm text-ink-muted">dias antes</span>
              </div>
            </FormField>
          </FormGrid>
          <div className="border-t border-gray-100 pt-1 divide-y divide-gray-100">
            <ToggleSwitch label="Enviar alerta de vencimento por e-mail ao cliente" description="" checked={!!watch("alertaEmailCliente")} onChange={(v) => setValue("alertaEmailCliente", v)} />
          </div>
        </FormSection>

        <FormSection title="Renovação" icon={<Repeat className="w-3.5 h-3.5" />}>
          <ToggleSwitch
            label="Renovação automática"
            description="Renova o contrato automaticamente ao fim da vigência."
            checked={!!renovacaoAtiva}
            onChange={(v) => setValue("renovacaoAutomatica", v)}
          />
          {renovacaoAtiva && (
            <div className="space-y-4 border-l-2 border-primary-200 pl-4 mt-2">
              <FormField label="Renovar por (meses)">
                <Input {...register("renovacaoMeses")} type="number" min={1} placeholder="12" className="w-40" />
              </FormField>
              <div className="border-t border-gray-100 pt-1 divide-y divide-gray-100">
                <ToggleSwitch label="Notificar cliente sobre renovação" description="" checked={!!notificarRenov} onChange={(v) => setValue("notificarClienteRenovacao", v)} />
              </div>
              {notificarRenov && (
                <FormField label="Dias de antecedência">
                  <Input {...register("notificarClienteDias")} type="number" min={0} placeholder="30" className="w-40" />
                </FormField>
              )}
            </div>
          )}
        </FormSection>
      </Painel>

      {/* ABA 8 — Documentos */}
      <Painel ativo={aba === "documentos"}>
        <FormSection title="Documentos do contrato" icon={<Paperclip className="w-3.5 h-3.5" />}>
          {isEditing ? (
            <ContratoDocumentos contratoId={initialData!.id} anexosIniciais={initialData!.anexos ?? []} />
          ) : (
            <p className="text-sm text-ink-muted">Salve o contrato para anexar documentos.</p>
          )}
        </FormSection>
      </Painel>

      {/* ABA 9 — Recorrência de OS */}
      <Painel ativo={aba === "recorrencia"}>
        <FormSection title="Recorrência de OS" icon={<Repeat className="w-3.5 h-3.5" />}>
          <p className="text-xs text-gray-400 -mt-2 mb-1">Gere ordens de serviço automaticamente conforme a frequência configurada.</p>
          <ToggleSwitch
            label="Ativar recorrência de OS"
            description="Quando ativo, o contrato entra na geração automática de OS recorrentes."
            checked={!!recorrenciaAtiva}
            onChange={(v) => setValue("recorrencia", v)}
          />
          {recorrenciaAtiva && (
            <div className="space-y-4 border-l-2 border-primary-200 pl-4 mt-2">
              <FormGrid cols={3}>
                <FormField label="Frequência">
                  <Select {...register("frequenciaRecorrencia")} placeholder="Selecione">
                    {FREQUENCIAS_RECORRENCIA.map((f) => (<option key={f} value={f}>{LABELS_PERIODICIDADE[f]}</option>))}
                  </Select>
                </FormField>
                <FormField label="Dia do mês" hint="1 a 28">
                  <Input {...register("diaRecorrencia")} type="number" min={1} max={28} placeholder="1" />
                </FormField>
                <FormField label="Finais de semana">
                  <Select {...register("fimSemanaRecorrencia")} placeholder="Selecione">
                    {Object.entries(LABELS_TRATAMENTO_FIM_SEMANA).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                  </Select>
                </FormField>
              </FormGrid>
              <FormGrid>
                <FormField label="Tipo de OS padrão">
                  <Select {...register("tipoOsRecorrenciaId")} placeholder="Selecione">
                    {tiposOs.map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
                  </Select>
                </FormField>
                <FormField label="Técnico responsável padrão">
                  <Select {...register("tecnicoRecorrenciaId")} placeholder="Selecione">
                    {tecnicos.map((t) => (<option key={t.id} value={t.id}>{t.nome}</option>))}
                  </Select>
                </FormField>
              </FormGrid>
              <p className="text-xs text-gray-400 flex items-center gap-1.5">
                <Repeat className="w-3.5 h-3.5" /> A vigência segue as datas de início/fim do contrato.
              </p>
            </div>
          )}
        </FormSection>
      </Painel>

      {/* ABA 10 — Observações */}
      <Painel ativo={aba === "observacoes"}>
        <FormSection title="Observações" icon={<StickyNote className="w-3.5 h-3.5" />}>
          <FormField label="Cláusulas especiais, restrições, acordos adicionais">
            <Textarea {...register("observacoes")} placeholder="Informações adicionais…" rows={6} />
          </FormField>
        </FormSection>
      </Painel>

          </div>{/* fim do conteúdo */}

          <div className="flex items-center justify-end gap-3 px-5 sm:px-6 lg:px-8 py-4 bg-surface-alt/40 border-t border-surface-border">
            <BotoesAcao />
          </div>
        </div>
      </div>
    </form>
  );
}
