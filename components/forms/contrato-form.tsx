"use client";

import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { contratoSchema, type ContratoInput } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import type { Contrato, Tecnico, Unidade } from "@prisma/client";
import { Building2 } from "lucide-react";

function toDateInput(date: Date | null | undefined) {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}

const LABELS_TIPO_CONTRATO: Record<string, string> = {
  MANUTENCAO_PREVENTIVA: "Manutenção Preventiva",
  MANUTENCAO_CORRETIVA: "Manutenção Corretiva",
  MANUTENCAO_COMPLETA: "Manutenção Completa",
  INSTALACAO: "Instalação",
  LOCACAO: "Locação",
  ASSISTENCIA_TECNICA: "Assistência Técnica",
};
const LABELS_STATUS_CONTRATO: Record<string, string> = {
  ATIVO: "Ativo", SUSPENSO: "Suspenso", ENCERRADO: "Encerrado",
  VENCIDO: "Vencido", AGUARDANDO_ASSINATURA: "Aguardando Assinatura",
};
const LABELS_PERIODICIDADE: Record<string, string> = {
  SEMANAL: "Semanal", QUINZENAL: "Quinzenal", MENSAL: "Mensal",
  BIMESTRAL: "Bimestral", TRIMESTRAL: "Trimestral", SEMESTRAL: "Semestral", ANUAL: "Anual",
};

type ClienteItem = { id: string; nome: string; nomeFantasia?: string | null };
type ResponsavelItem = Pick<Tecnico, "id" | "nome" | "crea">;

interface ContratoComUnidades extends Contrato {
  unidades?: Array<{ unidade: Unidade }>;
  responsavelTecnico?: ResponsavelItem | null;
}

interface ContratoFormProps {
  initialData?: ContratoComUnidades;
}

export function ContratoForm({ initialData }: ContratoFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [erroGlobal, setErroGlobal] = useState("");
  const [clientes, setClientes] = useState<ClienteItem[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [responsaveis, setResponsaveis] = useState<ResponsavelItem[]>([]);
  const [clienteIdSelecionado, setClienteIdSelecionado] = useState(initialData?.clienteId ?? "");

  const unidadeIdsIniciais = initialData?.unidades?.map((u) => u.unidade.id) ?? [];

  const {
    register,
    handleSubmit,
    control,
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
        }
      : {
          status: "ATIVO",
          periodicidade: "MENSAL",
          unidadeIds: [],
          numero: `CT-${new Date().getFullYear()}-`,
        },
  });

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then(setClientes).catch(() => {});
    fetch("/api/tecnicos?tipo=RESPONSAVEL_TECNICO").then((r) => r.json()).then(setResponsaveis).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clienteIdSelecionado) { setUnidades([]); return; }
    fetch(`/api/unidades?clienteId=${clienteIdSelecionado}`)
      .then((r) => r.json())
      .then(setUnidades)
      .catch(() => {});
  }, [clienteIdSelecionado]);

  useEffect(() => {
    if (initialData?.clienteId) setClienteIdSelecionado(initialData.clienteId);
  }, [initialData]);

  async function onSubmit(data: ContratoInput) {
    setErroGlobal("");
    try {
      const url = isEditing ? `/api/contratos/${initialData!.id}` : "/api/contratos";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        setErroGlobal(err.erro ?? "Erro ao salvar contrato.");
        return;
      }
      router.push("/contratos");
      router.refresh();
    } catch {
      setErroGlobal("Erro de conexão. Tente novamente.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
      {erroGlobal && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erroGlobal}</div>
      )}

      {/* Dados do contrato */}
      <FormSection title="Dados do contrato">
        <FormGrid>
          <FormField label="Cliente" required error={errors.clienteId?.message}>
            <Select
              {...register("clienteId", { onChange: (e) => setClienteIdSelecionado(e.target.value) })}
              error={!!errors.clienteId}
              placeholder="Selecione o cliente"
            >
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nomeFantasia ?? c.nome}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Número do contrato" required error={errors.numero?.message} hint="Ex: CT-2024-001">
            <Input {...register("numero")} error={!!errors.numero} placeholder="CT-2024-001" />
          </FormField>
        </FormGrid>

        <FormGrid cols={3}>
          <FormField label="Tipo" required error={errors.tipo?.message}>
            <Select {...register("tipo")} error={!!errors.tipo} placeholder="Selecione o tipo">
              {Object.entries(LABELS_TIPO_CONTRATO).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Status" required>
            <Select {...register("status")}>
              {Object.entries(LABELS_STATUS_CONTRATO).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Periodicidade" required>
            <Select {...register("periodicidade")}>
              {Object.entries(LABELS_PERIODICIDADE).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </Select>
          </FormField>
        </FormGrid>
      </FormSection>

      {/* Responsável Técnico e ART */}
      <FormSection title="Responsável técnico e ART">
        <FormGrid>
          <FormField label="Responsável técnico" hint="Engenheiro responsável por este contrato">
            <Select {...register("responsavelTecnicoId")} placeholder="Selecione o responsável técnico">
              {responsaveis.map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.nome}{rt.crea ? ` — CREA ${rt.crea}` : ""}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Número ART" hint="Anotação de Responsabilidade Técnica">
            <Input {...register("artNumero")} placeholder="Ex: ART-2024-005678" />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* Valores e vigência */}
      <FormSection title="Valores e vigência">
        <FormGrid cols={3}>
          <FormField label="Valor mensal (R$)" error={errors.valorMensal?.message}>
            <Input {...register("valorMensal", { valueAsNumber: true })} type="number" step="0.01" min="0" placeholder="0,00" error={!!errors.valorMensal} />
          </FormField>
          <FormField label="Valor total (R$)" error={errors.valorTotal?.message}>
            <Input {...register("valorTotal", { valueAsNumber: true })} type="number" step="0.01" min="0" placeholder="0,00" error={!!errors.valorTotal} />
          </FormField>
          <FormField label="Dia de vencimento" hint="1 a 31" error={errors.diaVencimento?.message}>
            <Input {...register("diaVencimento", { valueAsNumber: true })} type="number" min="1" max="31" placeholder="10" error={!!errors.diaVencimento} />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Início da vigência" required error={errors.dataInicio?.message}>
            <Input {...register("dataInicio")} type="date" error={!!errors.dataInicio} />
          </FormField>
          <FormField label="Fim da vigência" hint="Deixe em branco para vigência indeterminada">
            <Input {...register("dataFim")} type="date" />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* Endereços cobertos */}
      <FormSection title="Endereços cobertos pelo contrato">
        {!clienteIdSelecionado ? (
          <p className="text-sm text-gray-400 py-3">Selecione um cliente para ver os endereços disponíveis.</p>
        ) : unidades.length === 0 ? (
          <p className="text-sm text-gray-400 py-3">Nenhum endereço cadastrado para este cliente.</p>
        ) : (
          <Controller
            name="unidadeIds"
            control={control}
            render={({ field }) => (
              <div className="space-y-2">
                {unidades.map((u) => {
                  const selecionado = field.value?.includes(u.id) ?? false;
                  return (
                    <label key={u.id} className="flex items-start gap-3 p-3 border border-gray-200 rounded-lg hover:border-frivo-300 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={selecionado}
                        onChange={(e) => {
                          const atual = field.value ?? [];
                          field.onChange(e.target.checked ? [...atual, u.id] : atual.filter((id) => id !== u.id));
                        }}
                        className="mt-0.5 accent-frivo-600"
                      />
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-gray-800">{u.nome}</p>
                          <p className="text-xs text-gray-400">
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

      {/* Observações */}
      <FormSection title="Observações">
        <FormField label="Observações">
          <Textarea {...register("observacoes")} placeholder="Cláusulas especiais, restrições, acordos adicionais…" rows={4} />
        </FormField>
      </FormSection>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? "Salvar alterações" : "Cadastrar contrato"}
        </Button>
      </div>
    </form>
  );
}
