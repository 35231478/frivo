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
import { InteracoesManager } from "@/components/forms/interacoes-manager";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { LABELS_SEGMENTO, LABELS_ORIGEM, LABELS_STATUS_FINANCEIRO, COR_STATUS_FINANCEIRO, LABELS_PERFIL_FATURAMENTO } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Cliente, Tecnico, Unidade, Configuracao, ContatoCliente } from "@prisma/client";
import { Search, Loader2, FileCheck, Lock, Pencil, Plus, X, Mail } from "lucide-react";

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
}

export function ClienteForm({ initialData }: ClienteFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const temContrato = (initialData?._count?.contratos ?? 0) > 0;
  const [erroGlobal, setErroGlobal] = useState("");
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [responsaveis, setResponsaveis] = useState<ResponsavelItem[]>([]);
  const [unidadesNovas, setUnidadesNovas] = useState<UnidadeLocal[]>([]);
  const [anexosNovos, setAnexosNovos] = useState<AnexoLocal[]>([]);
  const [contatosNovos, setContatosNovos] = useState<ContatoLocal[]>([]);
  const [razaoSocialBloqueada, setRazaoSocialBloqueada] = useState(false);
  const [config, setConfig] = useState<Partial<Configuracao>>({});
  const [satisfacao, setSatisfacao] = useState<number | null>(initialData?.satisfacao ?? null);

  // Perfil de faturamento (gerenciado fora do RHF)
  const [tipoFaturamento, setTipoFaturamento] = useState<string>(initialData?.tipoFaturamento ?? "");
  const [diaFaturamento, setDiaFaturamento] = useState<number>(initialData?.diaFaturamento ?? 1);
  const [condicaoPagamento, setCondicaoPagamento] = useState<string>(initialData?.condicaoPagamento ?? "");
  const [exigePcAntesNf, setExigePcAntesNf] = useState<boolean>(initialData?.exigePcAntesNf ?? false);
  const [agrupaAdicionais, setAgrupaAdicionais] = useState<boolean>(initialData?.agrupaAdicionais ?? false);
  const [boletoUnicoMensal, setBoletoUnicoMensal] = useState<boolean>(initialData?.boletoUnicoMensal ?? false);
  const [emailsFaturamento, setEmailsFaturamento] = useState<string[]>(initialData?.emailsFaturamento ?? []);
  const [whatsappFaturamento, setWhatsappFaturamento] = useState<string>(initialData?.whatsappFaturamento ?? "");

  useEffect(() => {
    fetch("/api/tecnicos?tipo=RESPONSAVEL_TECNICO").then((r) => r.json()).then(setResponsaveis).catch(() => {});
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
          segmento: initialData.segmento ?? undefined, origem: initialData.origem ?? undefined,
          statusFinanceiro: initialData.statusFinanceiro, satisfacao: initialData.satisfacao,
          email: initialData.email ?? "", telefone: initialData.telefone ?? "",
          celular: initialData.celular ?? "", contato: initialData.contato ?? "",
          artNumero: initialData.artNumero ?? "",
          responsavelTecnicoId: initialData.responsavelTecnicoId ?? "",
          endereco: initialData.endereco ?? "", numero: initialData.numero ?? "",
          complemento: initialData.complemento ?? "", bairro: initialData.bairro ?? "",
          cidade: initialData.cidade ?? "", estado: initialData.estado ?? "",
          cep: initialData.cep ?? "", observacoes: initialData.observacoes ?? "",
        }
      : { tipoPessoa: "JURIDICA", statusFinanceiro: "ADIMPLENTE" },
  });

  const tipoPessoa = watch("tipoPessoa");
  const telefoneVal = watch("telefone") ?? "";
  const celularVal = watch("celular") ?? "";
  const statusFin = watch("statusFinanceiro") ?? "ADIMPLENTE";

  async function buscarCnpj() {
    const cnpj = watch("cpfCnpj")?.replace(/\D/g, "");
    if (!cnpj || cnpj.length !== 14) return;
    setBuscandoCnpj(true); setErroGlobal("");
    try {
      const res = await fetch(`/api/cnpj/${cnpj}`);
      if (!res.ok) { const err = await res.json(); setErroGlobal(err.erro ?? "Erro ao consultar CNPJ."); return; }
      const data = await res.json();
      if (data.nome) { setValue("nome", data.nome); setRazaoSocialBloqueada(true); }
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

  function validarConfigDinamica(): string | null {
    if (config.clienteEmailObrigatorio && !watch("email")) return "E-mail é obrigatório (configuração da empresa).";
    if (config.clienteWhatsappObrigatorio && !watch("celular")) return "WhatsApp é obrigatório (configuração da empresa).";
    if (config.clienteTelefoneObrigatorio && !watch("telefone")) return "Telefone é obrigatório (configuração da empresa).";
    if (config.clienteRtObrigatorio && !watch("responsavelTecnicoId")) return "Responsável técnico é obrigatório (configuração da empresa).";
    if (config.clienteArtObrigatorio && !watch("artNumero")) return "Número ART é obrigatório (configuração da empresa).";
    if (config.clienteExigirUnidade && !isEditing && unidadesNovas.length === 0) return "Adicione pelo menos um endereço antes de salvar (configuração da empresa).";
    return null;
  }

  async function onSubmit(data: ClienteInput) {
    setErroGlobal("");
    const erroCfg = validarConfigDinamica();
    if (erroCfg) { setErroGlobal(erroCfg); return; }

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
      router.push("/clientes"); router.refresh();
    } catch { setErroGlobal("Erro de conexão."); }
  }

  function reqLabel(base: string, cfgKey: keyof Configuracao): string {
    return config[cfgKey] ? `${base} *` : base;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {/* Topo: badges + satisfação */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {isEditing && temContrato && (
            <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium rounded-lg px-3 py-1.5">
              <FileCheck className="w-4 h-4" /> Cliente de Contrato
            </span>
          )}
          {statusFin && (
            <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", COR_STATUS_FINANCEIRO[statusFin])}>
              {LABELS_STATUS_FINANCEIRO[statusFin]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">Satisfação:</span>
          <StarRating value={satisfacao} onChange={(v) => { setSatisfacao(v || null); setValue("satisfacao", v || null); }} />
        </div>
      </div>

      {erroGlobal && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erroGlobal}</div>}

      {isEditing && (
        <FormSection title="Logomarca">
          <LogoUpload clienteId={initialData!.id} logoInicial={initialData!.logo} />
        </FormSection>
      )}

      {/* Dados básicos */}
      <FormSection title="Dados básicos">
        <FormGrid>
          <FormField label="Tipo de pessoa" required>
            <Select {...register("tipoPessoa")} error={!!errors.tipoPessoa}>
              <option value="JURIDICA">Pessoa Jurídica</option>
              <option value="FISICA">Pessoa Física</option>
            </Select>
          </FormField>
          <FormField label={tipoPessoa === "FISICA" ? "CPF" : "CNPJ"} required error={errors.cpfCnpj?.message}>
            <div className="flex gap-2">
              <Input {...register("cpfCnpj")} placeholder={tipoPessoa === "FISICA" ? "000.000.000-00" : "00.000.000/0001-00"} error={!!errors.cpfCnpj} className="flex-1" />
              {tipoPessoa === "JURIDICA" && (
                <Button type="button" variant="secondary" loading={buscandoCnpj} onClick={buscarCnpj} className="shrink-0">
                  {buscandoCnpj ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  <span className="hidden sm:inline ml-1">Buscar CNPJ</span>
                </Button>
              )}
            </div>
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label={tipoPessoa === "FISICA" ? "Nome completo" : "Razão social"} required error={errors.nome?.message}>
            <div className="relative">
              <Input {...register("nome")} error={!!errors.nome} readOnly={razaoSocialBloqueada} className={razaoSocialBloqueada ? "bg-gray-100 text-gray-600 pr-20" : ""} />
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

      {/* Segmento, Origem, Status */}
      <FormSection title="Classificação">
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
          <FormField label="Status financeiro">
            <Select {...register("statusFinanceiro")}>
              {Object.entries(LABELS_STATUS_FINANCEIRO).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
            </Select>
          </FormField>
        </FormGrid>
      </FormSection>

      {/* RT e ART */}
      <FormSection title="Responsável técnico e ART">
        <FormGrid>
          <FormField label={reqLabel("Responsável técnico", "clienteRtObrigatorio")} hint="Engenheiro responsável">
            <Select {...register("responsavelTecnicoId")} placeholder="Selecione">
              {responsaveis.map((rt) => (<option key={rt.id} value={rt.id}>{rt.nome}{rt.crea ? ` — CREA ${rt.crea}` : ""}</option>))}
            </Select>
          </FormField>
          <FormField label={reqLabel("Número ART", "clienteArtObrigatorio")} hint="Anotação de Responsabilidade Técnica">
            <Input {...register("artNumero")} placeholder="Ex: ART-2024-001234" />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* Contato principal (legacy) */}
      <FormSection title="Contato rápido">
        <FormGrid cols={3}>
          <FormField label={reqLabel("E-mail", "clienteEmailObrigatorio")} error={errors.email?.message}>
            <Input {...register("email")} type="email" placeholder="email@empresa.com.br" error={!!errors.email} />
          </FormField>
          <FormField label={reqLabel("Telefone", "clienteTelefoneObrigatorio")}>
            <PhoneInput {...register("telefone")} placeholder="(00) 0000-0000" value={telefoneVal} />
          </FormField>
          <FormField label={reqLabel("Celular / WhatsApp", "clienteWhatsappObrigatorio")}>
            <WhatsAppInput {...register("celular")} placeholder="(00) 00000-0000" value={celularVal} />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Nome do contato principal"><Input {...register("contato")} placeholder="João Silva" /></FormField>
        </FormGrid>
      </FormSection>

      {/* Contatos do cliente — aparece sempre */}
      <FormSection title="Contatos">
        <p className="text-xs text-gray-400 -mt-2 mb-3">
          {isEditing
            ? "Gerencie os contatos deste cliente. Contatos do tipo \"Operacional\" serão usados para abertura de chamados."
            : "Adicione os contatos do cliente. O primeiro será marcado como principal."}
        </p>
        {isEditing ? (
          <ContatosManager clienteId={initialData!.id} contatosIniciais={initialData!.contatosCliente ?? []} />
        ) : (
          <ContatosLocal contatos={contatosNovos} onChange={setContatosNovos} />
        )}
      </FormSection>

      {/* Endereços */}
      <FormSection title="Endereços do Cliente">
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

      {/* Anexos */}
      <FormSection title="Anexos">
        {isEditing
          ? <AnexosManager clienteId={initialData!.id} anexosIniciais={initialData!.anexos ?? []} />
          : <AnexosLocal anexos={anexosNovos} onChange={setAnexosNovos} />}
      </FormSection>

      {/* Histórico de interações */}
      {isEditing && (
        <FormSection title="Histórico de Interações">
          <InteracoesManager clienteId={initialData!.id} interacoesIniciais={initialData!.interacoes ?? []} />
        </FormSection>
      )}

      {/* Perfil de Faturamento */}
      <FormSection title="Perfil de Faturamento">
        <p className="text-xs text-gray-400 -mt-2 mb-3">
          Define como as medições e faturas deste cliente são geradas e enviadas.
        </p>
        <FormGrid>
          <FormField label="Tipo de faturamento" hint="Define o fluxo de aprovação e cobrança">
            <Select value={tipoFaturamento} onChange={(e) => setTipoFaturamento(e.target.value)} placeholder="Selecione">
              {Object.entries(LABELS_PERFIL_FATURAMENTO).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Dia de faturamento" hint="Dia do mês (1 a 28)">
            <Input
              type="number" min={1} max={28}
              value={diaFaturamento}
              onChange={(e) => setDiaFaturamento(Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
            />
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

        <FormField label="E-mails para envio automático" hint="Adicione um ou mais e-mails que receberão as faturas">
          <EmailsFaturamento emails={emailsFaturamento} onChange={setEmailsFaturamento} />
        </FormField>

        {/* Toggles condicionais por perfil */}
        {(tipoFaturamento === "COM_APROVACAO" || tipoFaturamento === "FATURA_UNICA") && (
          <div className="border-t border-gray-100 pt-1">
            <ToggleSwitch
              label="Exige PC (Pedido de Compra) antes da NF"
              description="A nota fiscal só pode ser emitida após o registro do PC do cliente."
              checked={exigePcAntesNf}
              onChange={setExigePcAntesNf}
            />
          </div>
        )}
        {tipoFaturamento === "FATURA_UNICA" && (
          <div className="divide-y divide-gray-100 border-t border-gray-100">
            <ToggleSwitch
              label="Agrupa adicionais do mês na fatura"
              description="Contrato e adicionais (OS/orçamentos) do mês entram numa fatura única."
              checked={agrupaAdicionais}
              onChange={setAgrupaAdicionais}
            />
            <ToggleSwitch
              label="Boleto único mensal"
              description="Gera um único boleto consolidando toda a fatura do mês."
              checked={boletoUnicoMensal}
              onChange={setBoletoUnicoMensal}
            />
          </div>
        )}
      </FormSection>

      {/* Observações */}
      <FormSection title="Observações">
        <FormField label="Observações internas">
          <Textarea {...register("observacoes")} placeholder="Informações adicionais…" rows={3} />
        </FormField>
      </FormSection>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" loading={isSubmitting}>{isEditing ? "Salvar alterações" : "Cadastrar cliente"}</Button>
      </div>
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
