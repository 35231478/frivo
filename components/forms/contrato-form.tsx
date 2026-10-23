"use client";

import { useState, useEffect, useRef } from "react";
import { useForm, Controller } from "react-hook-form";
import { SelectCadastroRapido, CadastroRapidoModal, usePodeCriar, type CampoRapido, type PermissaoCriar } from "@/components/ui/select-cadastro-rapido";
import { CLIENTE, UNIDADE } from "@/components/cadastro-rapido/definicoes";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { contratoSchema, MAX_DESCRICAO_SERVICOS, type ContratoInput } from "@/lib/validations";
import { novoLocalDoCliente, temEndereco, textoEndereco, unidadeDoCliente, type EnderecoCliente, type NovoLocal } from "@/lib/contratos/local-padrao";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ContratoDocumentos } from "@/components/forms/contrato-documentos";
import { RecorrenciaLocais, type LocalConfig } from "@/components/forms/recorrencia-locais";
import {
  LABELS_PERIODICIDADE, LABELS_TIPO_CONTRATO, LABELS_STATUS_CONTRATO, COR_STATUS_CONTRATO, STATUS_CONTRATO_FORM,
  LABELS_AJUSTE_FIM_SEMANA, LABELS_TIPO_VENCIMENTO, LABELS_INDICE_REAJUSTE, LABELS_MES,
  formatarMoeda, formatarData, formatarDataHora, cn,
} from "@/lib/utils";
import type { Contrato, Tecnico, Unidade } from "@prisma/client";
import {
  FileText, ClipboardList, HardHat, MapPin, TrendingUp, BellRing, Settings2,
  Paperclip, Repeat, StickyNote, Building2, FileCheck, AlertCircle, Wand2, DollarSign,
  Plus, CalendarDays, ChevronDown, CheckCircle2, PauseCircle, RefreshCw, XCircle, History, User, Trash2, SlidersHorizontal,
} from "lucide-react";
import { anoBR, chaveDiaCivil, diaCivilDeChave, diasAteDiaCivil } from "@/lib/fuso";
import { InputData } from "@/components/ui/input-data";

// Opções de mudança de status oferecidas no cabeçalho (ícone, cor e descrição).
const STATUS_OPCOES: { valor: string; label: string; descricao: string; icone: any; cor: string }[] = [
  { valor: "ATIVO", label: "Ativo", descricao: "Contrato vigente e em execução", icone: CheckCircle2, cor: "text-success-600" },
  { valor: "SUSPENSO", label: "Suspenso", descricao: "Pausado temporariamente", icone: PauseCircle, cor: "text-amber-600" },
  { valor: "EM_RENOVACAO", label: "Em renovação", descricao: "Em processo de renovação", icone: RefreshCw, cor: "text-blue-600" },
  { valor: "ENCERRADO", label: "Encerrado", descricao: "Encerrado naturalmente ao fim da vigência", icone: FileCheck, cor: "text-slate-600" },
  { valor: "CANCELADO", label: "Cancelado", descricao: "Cancelado antes do prazo", icone: XCircle, cor: "text-red-600" },
];

// Endereço novo no contrato: campos do cadastro rápido de unidade + bairro/complemento (o painel antigo os tinha)
const CAMPOS_UNIDADE_CONTRATO: CampoRapido[] = [
  ...UNIDADE.campos,
  { nome: "bairro", label: "Bairro", colunas: 3 },
  { nome: "complemento", label: "Complemento", colunas: 3 },
];
const PERMISSAO_UNIDADE_CONTRATO: PermissaoCriar = [
  { modulo: "clientes", acao: "editar" },
  { modulo: "contratos", acao: "criar" },
  { modulo: "contratos", acao: "editar" },
];

function toDateInput(date: Date | null | undefined) {
  return date ? chaveDiaCivil(date) : "";
}

type ClienteItem = { id: string; nome: string; nomeFantasia?: string | null };
type ResponsavelItem = Pick<Tecnico, "id" | "nome" | "crea">;
type AnexoItem = { id: string; nome: string; tipo: string; tamanho: number; categoria?: string | null; criadoEm: string | Date };
type ReajusteItem = { id: string; data: string | Date; indice: string; percentual: any; valorAnterior: any; valorNovo: any };
type HistoricoStatusItem = { id: string; statusAnterior: string; statusNovo: string; motivo: string | null; createdAt: string | Date; usuario?: { id: string; nome: string } | null };
type RecorrenciaLocalItem = { unidadeId: string; ativa: boolean; frequencia: string | null; tipoOsId: string | null; tecnicoId: string | null; dataPrimeiraOs: string | Date | null };

interface ContratoComRelacoes extends Contrato {
  unidades?: Array<{ unidade: Unidade }>;
  responsavelTecnico?: ResponsavelItem | null;
  anexos?: AnexoItem[];
  reajustes?: ReajusteItem[];
  historicoStatus?: HistoricoStatusItem[];
  recorrenciasLocais?: RecorrenciaLocalItem[];
}

interface ContratoFormProps {
  initialData?: ContratoComRelacoes;
}

function Painel({ ativo, id, children }: { ativo: boolean; id: string; children: React.ReactNode }) {
  return <div className={cn("space-y-8", !ativo && "hidden")} data-painel-contrato={id} role="tabpanel" hidden={!ativo}>{children}</div>;
}

/**
 * As 5 abas do contrato (antes eram 10). O que saiu do formulário: NFS-e (serviços da nota,
 * período de referência, nº do contrato e vencimento na descrição, "exibir RT na NFS-e"),
 * itens inclusos e visitas. Tipo e periodicidade CONTINUAM (faturamento, relatório, filtro e
 * ficha do cliente usam), recolhidos em "Mais opções".
 */
export const ABAS_CONTRATO = [
  { id: "contrato", label: "Contrato", icone: FileText },
  { id: "escopo", label: "Escopo e locais", icone: ClipboardList },
  { id: "recorrencia", label: "Recorrência de OS", icone: Repeat },
  { id: "rt", label: "Responsável técnico e documentos", icone: HardHat },
  { id: "gestao", label: "Gestão", icone: Settings2 },
] as const;
type AbaContrato = (typeof ABAS_CONTRATO)[number]["id"];

// Campo → aba (para destacar abas com erro de validação)
const CAMPO_ABA: Record<string, AbaContrato> = {
  clienteId: "contrato", numero: "contrato", tipo: "contrato", status: "contrato", periodicidade: "contrato",
  valorMensal: "contrato", valorTotal: "contrato", dataInicio: "contrato", dataFim: "contrato",
  diaFaturamento: "contrato", diasAposVencimento: "contrato", diaFixoMes: "contrato", ajusteFinsDeSemana: "contrato",
  descricaoServicos: "escopo", unidadeIds: "escopo",
  artNumero: "rt", artVencimento: "rt", responsavelTecnicoId: "rt",
  reajusteIndice: "gestao", reajustePercentual: "gestao", reajusteMesAniversario: "gestao", reajusteNotificarDias: "gestao",
  alertaDias: "gestao", renovacaoMeses: "gestao", notificarClienteDias: "gestao", observacoes: "gestao",
};
/** Campos que ficam em "Mais opções" (a seção abre sozinha se um deles tiver erro) */
const CAMPOS_MAIS_OPCOES = ["tipo", "periodicidade", "ajusteFinsDeSemana"];

export function ContratoForm({ initialData }: ContratoFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEditing = !!initialData;
  const clienteIdParam = searchParams.get("clienteId") ?? "";
  const [erroGlobal, setErroGlobal] = useState("");
  const [aba, setAba] = useState<AbaContrato>("contrato");
  const [maisOpcoes, setMaisOpcoes] = useState(false);
  const [abasErro, setAbasErro] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  const [clientes, setClientes] = useState<ClienteItem[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [responsaveis, setResponsaveis] = useState<ResponsavelItem[]>([]);
  const [tiposOs, setTiposOs] = useState<{ id: string; nome: string }[]>([]);
  const [tecnicos, setTecnicos] = useState<{ id: string; nome: string }[]>([]);
  const [clienteIdSelecionado, setClienteIdSelecionado] = useState(initialData?.clienteId ?? clienteIdParam);
  const [gerandoNumero, setGerandoNumero] = useState(false);

  // Gerenciamento de status (cabeçalho + histórico)
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [statusAlvo, setStatusAlvo] = useState<string | null>(null);
  const [motivoStatus, setMotivoStatus] = useState("");
  const [salvandoStatus, setSalvandoStatus] = useState(false);
  const [historicoStatus, setHistoricoStatus] = useState<HistoricoStatusItem[]>(initialData?.historicoStatus ?? []);

  // Recorrência de OS por local (config fora do RHF, indexada por unidadeId)
  const [recLocais, setRecLocais] = useState<Record<string, LocalConfig>>(() => {
    const o: Record<string, LocalConfig> = {};
    for (const r of initialData?.recorrenciasLocais ?? []) {
      o[r.unidadeId] = {
        ativa: r.ativa,
        frequencia: r.frequencia ?? "MENSAL",
        tipoOsId: r.tipoOsId ?? "",
        tecnicoId: r.tecnicoId ?? "",
        dataPrimeiraOs: r.dataPrimeiraOs ? chaveDiaCivil(r.dataPrimeiraOs) : "",
      };
    }
    return o;
  });
  function onChangeRecLocal(unidadeId: string, patch: Partial<LocalConfig>) {
    setRecLocais((s) => {
      const atual: LocalConfig = s[unidadeId] ?? { ativa: false, frequencia: "MENSAL", tipoOsId: "", tecnicoId: "", dataPrimeiraOs: "" };
      return { ...s, [unidadeId]: { ...atual, ...patch } };
    });
  }

  // 1º local coberto = endereço do cadastro do cliente (sugerido ao abrir; removível; nunca duplica)
  const [enderecoCliente, setEnderecoCliente] = useState<{ clienteId: string; end: EnderecoCliente } | null>(null);
  const [localPendente, setLocalPendente] = useState<NovoLocal | null>(null);
  const localSugeridoPara = useRef<string | null>(null);

  // Novo endereço inline (aba Locais)
  // Novo endereço (local coberto) pelo cadastro rápido compartilhado
  const [novaUnidade, setNovaUnidade] = useState(false);
  // Criar endereço aqui já era permitido a quem cuida do contrato; mantém isso e soma quem edita clientes
  const podeCriarUnidade = usePodeCriar(PERMISSAO_UNIDADE_CONTRATO);

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
          // Faturamento
          faturamentoAdicionais: (initialData as any).faturamentoAdicionais ?? "SEPARADO",
          diaFaturamento: initialData.diaFaturamento ?? undefined,
          tipoVencimento: initialData.tipoVencimento ?? undefined,
          diasAposVencimento: initialData.diasAposVencimento ?? undefined,
          diaFixoMes: initialData.diaFixoMes ?? undefined,
          ajusteFinsDeSemana: initialData.ajusteFinsDeSemana ?? undefined,
          // Escopo
          descricaoServicos: initialData.descricaoServicos ?? "",
          // RT
          artVencimento: toDateInput(initialData.artVencimento),
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
          // Tipo continua obrigatório no banco: o padrão evita que a seção recolhida trave o cadastro
          tipo: "MANUTENCAO_PREVENTIVA",
          periodicidade: "MENSAL",
          unidadeIds: [],
          numero: `CT-${anoBR()}-`,
          recorrencia: false,
          faturamentoAdicionais: "SEPARADO",
          diaFaturamento: undefined,
          tipoVencimento: "DIAS_APOS_FATURAMENTO",
          ajusteFinsDeSemana: "MANTER",
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
  const tipoVencimentoVal = watch("tipoVencimento");
  const faturamentoAdicionaisVal = watch("faturamentoAdicionais");
  const statusVal = watch("status");
  const dataInicioVal = watch("dataInicio");
  const dataFimVal = watch("dataFim");
  const valorMensalVal = watch("valorMensal");
  const descricaoVal = watch("descricaoServicos") ?? "";

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then((d) => setClientes(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/tecnicos?tipo=RESPONSAVEL_TECNICO").then((r) => r.json()).then((d) => setResponsaveis(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/tipos-os").then((r) => r.json()).then((d) => setTiposOs(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/tecnicos").then((r) => r.json()).then((d) => setTecnicos(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  const [unidadesDe, setUnidadesDe] = useState<string | null>(null);
  useEffect(() => {
    if (!clienteIdSelecionado) { setUnidades([]); setUnidadesDe(null); return; }
    fetch(`/api/unidades?clienteId=${clienteIdSelecionado}`).then((r) => r.json())
      .then((d) => { setUnidades(Array.isArray(d) ? d : []); setUnidadesDe(clienteIdSelecionado); }).catch(() => {});
    // Endereço do cadastro do cliente (para o 1º local coberto)
    fetch(`/api/clientes/${clienteIdSelecionado}`).then((r) => (r.ok ? r.json() : null))
      .then((c) => { if (c?.id) setEnderecoCliente({ clienteId: c.id, end: c }); }).catch(() => {});
  }, [clienteIdSelecionado]);

  // Ao abrir o contrato SEM locais: o 1º local vem do endereço do cliente. Se o cliente já tem um
  // local com esse endereço, é ele que entra (não duplica); senão, fica pendente e é criado ao salvar.
  // Uma vez por cliente: se a pessoa excluir, não volta.
  useEffect(() => {
    if (!clienteIdSelecionado || unidadesDe !== clienteIdSelecionado || enderecoCliente?.clienteId !== clienteIdSelecionado) return;
    if (localSugeridoPara.current === clienteIdSelecionado) return;
    localSugeridoPara.current = clienteIdSelecionado;
    const atuais = (watch("unidadeIds") ?? []) as string[];
    if (atuais.length > 0 || !temEndereco(enderecoCliente.end)) return;
    const existente = unidadeDoCliente(unidades, enderecoCliente.end);
    if (existente) setValue("unidadeIds", [existente.id]);
    else if (podeCriarUnidade) setLocalPendente(novoLocalDoCliente(enderecoCliente.end));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteIdSelecionado, unidadesDe, enderecoCliente, podeCriarUnidade]);

  function mostrarToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000); }

  async function gerarNumero() {
    setGerandoNumero(true);
    try {
      const res = await fetch("/api/contratos/proximo-numero");
      if (res.ok) { const d = await res.json(); if (d.numero) setValue("numero", d.numero); }
    } catch {} finally { setGerandoNumero(false); }
  }

  function abrirConfirmacaoStatus(status: string) {
    setStatusMenuOpen(false);
    setMotivoStatus("");
    setStatusAlvo(status);
  }

  async function confirmarStatus() {
    if (!statusAlvo || !isEditing) return;
    setSalvandoStatus(true);
    try {
      const res = await fetch(`/api/contratos/${initialData!.id}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: statusAlvo, motivo: motivoStatus || undefined }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErroGlobal(e.erro ?? "Erro ao alterar status."); setStatusAlvo(null); return; }
      const data = await res.json();
      setValue("status", statusAlvo as any);
      if (data.historico) setHistoricoStatus((prev) => [data.historico, ...prev]);
      mostrarToast(`Status alterado para "${LABELS_STATUS_CONTRATO[statusAlvo] ?? statusAlvo}".`);
      setStatusAlvo(null);
    } catch { setErroGlobal("Erro de conexão."); } finally { setSalvandoStatus(false); }
  }

  // Meses COBRADOS na vigência (CO4): fim no aniversário do início conta até o mês anterior
  // (01/01 → 01/01 do ano seguinte = 12 meses); qualquer dia depois disso inclui o mês do fim.
  const mesesVigencia = (() => {
    if (!dataInicioVal || !dataFimVal) return null;
    const a = new Date(`${dataInicioVal}T00:00:00`);
    const b = new Date(`${dataFimVal}T00:00:00`);
    if (b < a) return null;
    const diff = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    return b.getDate() < a.getDate() ? diff : b.getDate() === a.getDate() ? Math.max(diff, 1) : diff + 1;
  })();
  const valorMensalNum = typeof valorMensalVal === "number" && !isNaN(valorMensalVal) ? valorMensalVal : null;
  const valorTotalCalc = valorMensalNum != null && mesesVigencia != null ? valorMensalNum * mesesVigencia : null;
  const duracaoTexto = mesesVigencia != null ? `${mesesVigencia} ${mesesVigencia === 1 ? "mês" : "meses"}` : "Indeterminado";


  function onError(errs: typeof errors) {
    const abas = new Set<string>();
    Object.keys(errs).forEach((c) => { const a = CAMPO_ABA[c]; if (a) abas.add(a); });
    if (Object.keys(errs).some((c) => CAMPOS_MAIS_OPCOES.includes(c))) setMaisOpcoes(true);
    setAbasErro(abas);
    const primeira = ABAS_CONTRATO.find((t) => abas.has(t.id));
    if (primeira) { setAba(primeira.id); setErroGlobal(`Verifique os campos obrigatórios na aba "${primeira.label}".`); }
  }

  async function onSubmit(data: ContratoInput, continuar = false) {
    setErroGlobal(""); setAbasErro(new Set());
    // 1º local vindo do cadastro do cliente: cria o local agora (só se ainda não existir um igual)
    let unidadeIds = [...(data.unidadeIds ?? [])];
    if (localPendente && data.clienteId === clienteIdSelecionado) {
      const igual = unidadeDoCliente(unidades, { endereco: localPendente.logradouro, numero: localPendente.numero, cep: localPendente.cep, cidade: localPendente.cidade });
      try {
        const id = igual?.id ?? (await UNIDADE.criar(data.clienteId, { ...localPendente }, unidades.length === 0)).id;
        if (!unidadeIds.includes(id)) unidadeIds = [id, ...unidadeIds];
        setLocalPendente(null);
        setValue("unidadeIds", unidadeIds);
      } catch (e) { setErroGlobal(e instanceof Error ? e.message : "Não foi possível cadastrar o local do cliente."); setAba("escopo"); return; }
    }
    const recPayload = unidadeIds.map((unidadeId) => {
      const c = recLocais[unidadeId];
      return c ? { unidadeId, ativa: c.ativa, frequencia: c.frequencia || null, tipoOsId: c.tipoOsId || null, tecnicoId: c.tecnicoId || null, dataPrimeiraOs: c.dataPrimeiraOs || null } : null;
    }).filter(Boolean);
    const payload: any = {
      ...data,
      unidadeIds,
      // Valor total calculado automaticamente (valor mensal × meses de vigência)
      valorTotal: valorTotalCalc ?? undefined,
      // Recorrência de OS por local coberto
      recorrenciasLocais: recPayload,
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


  const salvar = handleSubmit((d) => onSubmit(d, false), onError);
  const salvarEContinuar = handleSubmit((d) => onSubmit(d, true), onError);
  const titulo = isEditing ? (initialData?.numero || "Editar contrato") : "Novo contrato";

  function badgeVigencia(): { txt: string; cls: string } {
    if (!dataFimVal) return { txt: "Vigência indeterminada", cls: "bg-slate-100 text-slate-600" };
    const dias = diasAteDiaCivil(diaCivilDeChave(dataFimVal))!; // pelo dia de Brasília
    if (dias < 0) return { txt: `Vencido há ${Math.abs(dias)} dias`, cls: "bg-red-50 text-red-700" };
    if (dias <= 30) return { txt: `Vence em ${dias} dias`, cls: "bg-amber-50 text-amber-700" };
    return { txt: `Vence em ${dias} dias`, cls: "bg-success-50 text-success-700" };
  }
  const bv = badgeVigencia();

  // Locais cobertos atualmente selecionados (para a aba de recorrência por local)
  const unidadeIdsAtuais = (watch("unidadeIds") ?? []) as string[];
  const locaisCobertos = unidades.filter((u) => unidadeIdsAtuais.includes(u.id)).map((u) => ({ id: u.id, nome: u.nome }));

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

      {/* Modal de confirmação de mudança de status */}
      {statusAlvo && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !salvandoStatus && setStatusAlvo(null)}>
          <div className="bg-white rounded-2xl shadow-card-hover w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-ink">Alterar status para “{LABELS_STATUS_CONTRATO[statusAlvo] ?? statusAlvo}”?</h3>
            <p className="text-sm text-ink-muted">{STATUS_OPCOES.find((o) => o.valor === statusAlvo)?.descricao}</p>
            <div>
              <label className="text-xs font-semibold text-ink">Motivo (opcional)</label>
              <Textarea value={motivoStatus} onChange={(e) => setMotivoStatus(e.target.value)} rows={3} placeholder="Ex: distrato solicitado pelo cliente, pausa por inadimplência…" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setStatusAlvo(null)} disabled={salvandoStatus}>Cancelar</Button>
              <Button type="button" variant="success" loading={salvandoStatus} onClick={confirmarStatus}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto space-y-5">
        {/* Cabeçalho fixo */}
        <div className="sticky top-0 z-30 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-[#F8FAFC]/90 backdrop-blur border-b border-surface-border">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 flex-wrap min-w-0">
              <h1 className="text-xl font-bold text-ink truncate">{titulo}</h1>
              {isEditing ? (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setStatusMenuOpen((o) => !o)}
                    title="Alterar status do contrato"
                    className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full transition-opacity hover:opacity-80", COR_STATUS_CONTRATO[statusVal] ?? "bg-slate-100 text-slate-600")}
                  >
                    {LABELS_STATUS_CONTRATO[statusVal] ?? statusVal} <ChevronDown className="w-3 h-3" />
                  </button>
                  {statusMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setStatusMenuOpen(false)} />
                      <div className="absolute left-0 mt-2 z-50 w-72 bg-white border border-surface-border rounded-xl shadow-card-hover p-1.5">
                        {STATUS_OPCOES.map((o) => {
                          const atual = o.valor === statusVal;
                          return (
                            <button
                              key={o.valor} type="button" disabled={atual}
                              onClick={() => abrirConfirmacaoStatus(o.valor)}
                              className={cn("w-full flex items-start gap-2.5 p-2 rounded-lg text-left transition-colors", atual ? "opacity-50 cursor-default" : "hover:bg-surface-alt")}
                            >
                              <o.icone className={cn("w-4 h-4 mt-0.5 shrink-0", o.cor)} />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-ink">{o.label}{atual && " (atual)"}</span>
                                <span className="block text-xs text-ink-muted">{o.descricao}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", COR_STATUS_CONTRATO[statusVal] ?? "bg-slate-100 text-slate-600")}>
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
          <nav className="flex gap-1.5 overflow-x-auto px-4 pt-4 pb-4 border-b border-surface-border" role="tablist">
            {ABAS_CONTRATO.map((t) => {
              const ativa = aba === t.id;
              const comErro = abasErro.has(t.id);
              return (
                <button
                  key={t.id} type="button" role="tab" onClick={() => setAba(t.id)} data-aba-contrato={t.id} aria-selected={ativa}
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

      {/* ABA 1 — Contrato */}
      <Painel ativo={aba === "contrato"} id="contrato">
        <FormSection title="Contrato" icon={<FileText className="w-3.5 h-3.5" />}>
          <FormGrid>
            <FormField label="Cliente" required error={errors.clienteId?.message}>
              <Controller
                name="clienteId"
                control={control}
                render={({ field }) => (
                  <SelectCadastroRapido
                    value={field.value ?? ""}
                    onChange={(v) => { field.onChange(v); setClienteIdSelecionado(v); setLocalPendente(null); }}
                    opcoes={clientes.map(CLIENTE.opcao)}
                    entidade={CLIENTE.entidade}
                    placeholder="Selecione o cliente"
                    erro={!!errors.clienteId}
                    campos={CLIENTE.campos}
                    valoresIniciais={CLIENTE.valoresIniciais}
                    campoBusca="nome"
                    permissao={CLIENTE.permissao}
                    linkCadastroCompleto={CLIENTE.link}
                    criar={async (v) => {
                      const c = await CLIENTE.criar(v);
                      setClientes((l) => [...l, c]);
                      return CLIENTE.opcao(c);
                    }}
                  />
                )}
              />
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
            <FormField label="Status" required hint={isEditing ? "Altere pelo botão de status no cabeçalho" : undefined}>
              {isEditing ? (
                <div className="flex h-10 items-center">
                  <span className={cn("inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full", COR_STATUS_CONTRATO[statusVal] ?? "bg-slate-100 text-slate-600")}>
                    {LABELS_STATUS_CONTRATO[statusVal] ?? statusVal}
                  </span>
                </div>
              ) : (
                <Select {...register("status")}>
                  {STATUS_CONTRATO_FORM.map((v) => (<option key={v} value={v}>{LABELS_STATUS_CONTRATO[v]}</option>))}
                </Select>
              )}
            </FormField>
            <FormField label="Início da vigência" required error={errors.dataInicio?.message}>
              <Controller name="dataInicio" control={control} render={({ field }) => <InputData value={(field.value as string) ?? ""} onChange={field.onChange} aria-label="Início da vigência" />} />
            </FormField>
            <FormField label="Fim da vigência" hint="Em branco = indeterminado">
              <Controller name="dataFim" control={control} render={({ field }) => <InputData value={(field.value as string) ?? ""} onChange={field.onChange} aria-label="Fim da vigência" />} />
            </FormField>
          </FormGrid>
          <p className="flex items-center gap-1.5 text-xs text-ink-muted -mt-2">
            <CalendarDays className="w-3.5 h-3.5" /> Duração da vigência: <span className="font-semibold text-ink">{duracaoTexto}</span>
          </p>
        </FormSection>

        <FormSection title="Valores e faturamento" icon={<DollarSign className="w-3.5 h-3.5" />}>
          <FormGrid cols={3}>
            <FormField label="Valor mensal (R$)" hint="Gera previsão de contas a receber" error={errors.valorMensal?.message}>
              <Input {...register("valorMensal", { valueAsNumber: true })} type="number" step="0.01" min="0" placeholder="0,00" error={!!errors.valorMensal} />
            </FormField>
            <FormField label="Valor total (R$)" hint="Calculado: valor mensal × meses de vigência">
              <div className="flex h-10 items-center rounded-lg border border-surface-border bg-surface-alt/60 px-3 text-sm font-medium text-ink" data-valor-total>
                {valorTotalCalc != null ? formatarMoeda(valorTotalCalc) : "—"}
              </div>
            </FormField>
            <FormField label="Dia de faturamento" hint="1 a 28" error={errors.diaFaturamento?.message}>
              <Input {...register("diaFaturamento")} type="number" min={1} max={28} placeholder="1" />
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

          <div className="space-y-2" data-faturamento-adicionais>
            <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Serviços avulsos do contrato (itens executados e adicionais das OS)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className={cn("flex flex-col gap-1 p-3 border rounded-lg cursor-pointer transition-colors", faturamentoAdicionaisVal !== "CONSOLIDADO" ? "border-primary-400 bg-primary-50/40" : "border-surface-border hover:border-primary-300")}>
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="radio" checked={faturamentoAdicionaisVal !== "CONSOLIDADO"} onChange={() => setValue("faturamentoAdicionais", "SEPARADO")} className="accent-primary-600" />
                  Faturas separadas
                </span>
                <span className="text-xs text-ink-muted">Cada OS gera a própria medição de adicional (padrão).</span>
              </label>
              <label className={cn("flex flex-col gap-1 p-3 border rounded-lg cursor-pointer transition-colors", faturamentoAdicionaisVal === "CONSOLIDADO" ? "border-primary-400 bg-primary-50/40" : "border-surface-border hover:border-primary-300")}>
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="radio" checked={faturamentoAdicionaisVal === "CONSOLIDADO"} onChange={() => setValue("faturamentoAdicionais", "CONSOLIDADO")} className="accent-primary-600" />
                  Consolidados na fatura do mês
                </span>
                <span className="text-xs text-ink-muted">Os serviços do mês entram junto da mensalidade na medição do contrato.</span>
              </label>
            </div>
          </div>

          {/* Mais opções: ajuste de dia não útil + tipo e periodicidade (continuam valendo; só ficam recolhidos) */}
          <div className="border border-surface-border rounded-lg">
            <button
              type="button" onClick={() => setMaisOpcoes((v) => !v)} aria-expanded={maisOpcoes} data-mais-opcoes
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-ink hover:bg-surface-alt/60 rounded-lg"
            >
              <span className="flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-ink-muted" /> Mais opções</span>
              <span className="flex items-center gap-2 text-xs text-ink-muted">
                {!maisOpcoes && <span className="hidden sm:inline">{LABELS_TIPO_CONTRATO[watch("tipo")] ?? "—"} · {LABELS_PERIODICIDADE[watch("periodicidade")] ?? "—"}</span>}
                <ChevronDown className={cn("w-4 h-4 transition-transform", maisOpcoes && "rotate-180")} />
              </span>
            </button>
            {maisOpcoes && (
              <div className="px-3 pb-3 pt-1 space-y-4 border-t border-surface-border" data-mais-opcoes-conteudo>
                <FormField label="Sábados, domingos e feriados nacionais" hint="Ajuste do vencimento que cai em dia não útil">
                  <Select {...register("ajusteFinsDeSemana")}>
                    {Object.entries(LABELS_AJUSTE_FIM_SEMANA).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                  </Select>
                </FormField>
                <FormGrid>
                  <FormField label="Tipo" required error={errors.tipo?.message}>
                    <Select {...register("tipo")} error={!!errors.tipo} placeholder="Selecione o tipo">
                      {Object.entries(LABELS_TIPO_CONTRATO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                    </Select>
                  </FormField>
                  <FormField label="Periodicidade de cobrança" required hint="De quantos em quantos meses a previsão de contas a receber é gerada">
                    <Select {...register("periodicidade")}>
                      {Object.entries(LABELS_PERIODICIDADE).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
                    </Select>
                  </FormField>
                </FormGrid>
              </div>
            )}
          </div>
        </FormSection>
      </Painel>

      {/* ABA 2 — Escopo e locais */}
      <Painel ativo={aba === "escopo"} id="escopo">
        <FormSection title="Escopo dos serviços" icon={<ClipboardList className="w-3.5 h-3.5" />}>
          <FormField label="Descrição dos serviços" hint="O que está incluso no contrato" error={errors.descricaoServicos?.message}>
            <Textarea {...register("descricaoServicos")} rows={5} maxLength={MAX_DESCRICAO_SERVICOS} placeholder="Descreva os serviços contratados…" data-descricao-servicos />
            <p className={cn("text-xs text-right mt-1 tabular-nums", descricaoVal.length > MAX_DESCRICAO_SERVICOS ? "text-red-600 font-semibold" : descricaoVal.length > MAX_DESCRICAO_SERVICOS * 0.9 ? "text-amber-600" : "text-ink-subtle")} data-contador-descricao>
              {descricaoVal.length}/{MAX_DESCRICAO_SERVICOS}
            </p>
          </FormField>
        </FormSection>

        <FormSection title="Locais cobertos pelo contrato" icon={<MapPin className="w-3.5 h-3.5" />}>
          {!clienteIdSelecionado ? (
            <p className="text-sm text-ink-muted py-3">Selecione um cliente primeiro (aba &quot;Contrato&quot;).</p>
          ) : (
            <div className="space-y-4">
              {/* Locais do contrato (com excluir) */}
              <div className="space-y-2" data-locais-cobertos>
                {localPendente && (
                  <div className="flex items-start gap-3 p-3 border border-primary-200 bg-primary-50/40 rounded-lg" data-local-pendente>
                    <Building2 className="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{localPendente.nome}</p>
                      <p className="text-xs text-ink-subtle">{textoEndereco(localPendente) || "Sem endereço"}</p>
                      <p className="text-[11px] text-primary-700 mt-0.5">Preenchido com o endereço do cadastro do cliente — vira um local do cliente ao salvar.</p>
                    </div>
                    <button type="button" onClick={() => setLocalPendente(null)} className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded" title="Excluir este local" aria-label={`Excluir ${localPendente.nome}`} data-excluir-local="pendente">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
                {unidades.filter((u) => unidadeIdsAtuais.includes(u.id)).map((u) => (
                  <div key={u.id} className="flex items-start gap-3 p-3 border border-surface-border rounded-lg" data-local={u.id}>
                    <Building2 className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink">{u.nome}</p>
                      <p className="text-xs text-ink-subtle">{textoEndereco(u) || "Sem endereço"}</p>
                    </div>
                    <button
                      type="button" onClick={() => setValue("unidadeIds", unidadeIdsAtuais.filter((id) => id !== u.id))}
                      className="p-1.5 text-ink-muted hover:text-red-600 hover:bg-red-50 rounded" title="Excluir do contrato" aria-label={`Excluir ${u.nome}`} data-excluir-local={u.id}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {!localPendente && unidadeIdsAtuais.length === 0 && (
                  <p className="text-sm text-ink-muted">Nenhum local coberto ainda.</p>
                )}
              </div>

              {/* Outros endereços do cliente: adicionar */}
              {unidades.some((u) => !unidadeIdsAtuais.includes(u.id)) && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-ink-muted uppercase tracking-wider">Outros endereços do cliente</p>
                  {unidades.filter((u) => !unidadeIdsAtuais.includes(u.id)).map((u) => (
                    <button
                      key={u.id} type="button" onClick={() => setValue("unidadeIds", [...unidadeIdsAtuais, u.id])} data-adicionar-local={u.id}
                      className="w-full flex items-start gap-3 p-3 border border-dashed border-surface-border rounded-lg hover:border-primary-300 text-left transition-colors"
                    >
                      <Plus className="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{u.nome}</p>
                        <p className="text-xs text-ink-subtle">{textoEndereco(u) || "Sem endereço"}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {podeCriarUnidade && (
                <Button type="button" variant="secondary" onClick={() => setNovaUnidade(true)} className="w-full justify-center border-dashed">
                  <Plus className="w-4 h-4" /> {unidades.length === 0 ? "Cadastrar endereço" : "Adicionar novo endereço"}
                </Button>
              )}
              <CadastroRapidoModal
                aberto={novaUnidade}
                onFechar={() => setNovaUnidade(false)}
                titulo="Novo endereço"
                contexto="para este cliente"
                campos={CAMPOS_UNIDADE_CONTRATO}
                linkCadastroCompleto={UNIDADE.link(clienteIdSelecionado)}
                criar={async (v) => {
                  const nova: Unidade = await UNIDADE.criar(clienteIdSelecionado, v, unidades.length === 0);
                  setUnidades((prev) => [...prev, nova]);
                  return UNIDADE.opcao(nova);
                }}
                // Já entra marcado como local coberto pelo contrato
                onCriado={(o) => {
                  setNovaUnidade(false);
                  const atual = (watch("unidadeIds") ?? []) as string[];
                  setValue("unidadeIds", [...atual, o.value]);
                }}
              />
            </div>
          )}
        </FormSection>
      </Painel>

      {/* ABA 3 — Recorrência de OS por local (como estava) */}
      <Painel ativo={aba === "recorrencia"} id="recorrencia">
        <FormSection title="Recorrência de OS por local" icon={<Repeat className="w-3.5 h-3.5" />}>
          <p className="text-xs text-gray-400 -mt-2 mb-1">
            Cada local coberto pode ter sua própria recorrência (frequência, tipo de OS, responsável e data da primeira OS).
          </p>
          {localPendente && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              O local “{localPendente.nome}” é criado ao salvar; depois disso a recorrência dele aparece aqui.
            </p>
          )}
          <RecorrenciaLocais
            locais={locaisCobertos}
            tiposOs={tiposOs}
            tecnicos={tecnicos}
            value={recLocais}
            onChange={onChangeRecLocal}
          />
        </FormSection>
      </Painel>

      {/* ABA 4 — Responsável técnico e documentos */}
      <Painel ativo={aba === "rt"} id="rt">
        <FormSection title="Responsável técnico" icon={<HardHat className="w-3.5 h-3.5" />}>
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
              <Controller name="artVencimento" control={control} render={({ field }) => <InputData value={(field.value as string) ?? ""} onChange={field.onChange} aria-label="Vencimento da ART" />} />
            </FormField>
          </FormGrid>
          <div className="border-t border-gray-100 pt-1 divide-y divide-gray-100">
            <ToggleSwitch label="Exibir responsável técnico e ART no PDF/relatório da OS" description="" checked={!!watch("exibirRTPDF")} onChange={(v) => setValue("exibirRTPDF", v)} />
          </div>
        </FormSection>

        <FormSection title="Contrato assinado e anexos" icon={<Paperclip className="w-3.5 h-3.5" />}>
          {isEditing ? (
            <ContratoDocumentos contratoId={initialData!.id} anexosIniciais={initialData!.anexos ?? []} />
          ) : (
            <p className="text-sm text-ink-muted">Salve o contrato para anexar o contrato assinado e outros documentos.</p>
          )}
        </FormSection>
      </Painel>

      {/* ABA 5 — Gestão */}
      <Painel ativo={aba === "gestao"} id="gestao">
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
          {isEditing && !!initialData?.reajustes?.length && (
            <div className="overflow-x-auto mt-3">
              <p className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-2">Reajustes aplicados</p>
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

        <FormSection title="Renovação automática" icon={<Repeat className="w-3.5 h-3.5" />}>
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

        <FormSection title="Observações" icon={<StickyNote className="w-3.5 h-3.5" />}>
          <FormField label="Cláusulas especiais, restrições, acordos adicionais">
            <Textarea {...register("observacoes")} placeholder="Informações adicionais…" rows={5} />
          </FormField>
        </FormSection>

        <FormSection title="Histórico de status" icon={<History className="w-3.5 h-3.5" />}>
          {!isEditing || historicoStatus.length === 0 ? (
            <p className="text-sm text-ink-muted py-1">Nenhuma mudança de status registrada.</p>
          ) : (
            <div className="space-y-2">
              {historicoStatus.map((h) => (
                <div key={h.id} className="border border-surface-border rounded-lg p-3">
                  <div className="flex items-center gap-2 flex-wrap text-sm">
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", COR_STATUS_CONTRATO[h.statusAnterior] ?? "bg-slate-100 text-slate-600")}>
                      {LABELS_STATUS_CONTRATO[h.statusAnterior] ?? h.statusAnterior}
                    </span>
                    <span className="text-ink-subtle">→</span>
                    <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", COR_STATUS_CONTRATO[h.statusNovo] ?? "bg-slate-100 text-slate-600")}>
                      {LABELS_STATUS_CONTRATO[h.statusNovo] ?? h.statusNovo}
                    </span>
                    <span className="ml-auto text-xs text-ink-muted">{formatarDataHora(h.createdAt)}</span>
                  </div>
                  {h.motivo && <p className="text-sm text-ink mt-1.5">{h.motivo}</p>}
                  <p className="text-xs text-ink-subtle mt-1 flex items-center gap-1"><User className="w-3 h-3" /> {h.usuario?.nome ?? "—"}</p>
                </div>
              ))}
            </div>
          )}
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
