"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { equipamentoSchema, type EquipamentoInput } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";

const TIPOS_EQUIPAMENTO = Object.entries(LABELS_TIPO_EQUIPAMENTO);
const FLUIDOS_COMUNS = ["R-410A", "R-22", "R-32", "R-134a", "R-404A", "R-407C", "R-290", "R-600A"];
const TENSOES_COMUNS = ["110V", "220V", "110/220V", "380V", "220/380V"];

function toDateInput(date: Date | null | undefined): string {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}

type ClienteItem = { id: string; nome: string; nomeFantasia?: string | null };
type UnidadeItem = { id: string; nome: string; cidade?: string | null; clienteId: string };

interface EquipamentoFormProps {
  initialData?: any;
  unidadeIdFixo?: string;
}

export function EquipamentoForm({ initialData, unidadeIdFixo }: EquipamentoFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [erroGlobal, setErroGlobal] = useState("");
  const [clientes, setClientes] = useState<ClienteItem[]>([]);
  const [unidades, setUnidades] = useState<UnidadeItem[]>([]);
  const [clienteIdSelecionado, setClienteIdSelecionado] = useState(
    initialData?.unidade?.clienteId ?? ""
  );

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EquipamentoInput>({
    resolver: zodResolver(equipamentoSchema),
    defaultValues: initialData
      ? {
          unidadeId: initialData.unidadeId,
          tipo: initialData.tipo,
          marca: initialData.marca,
          modelo: initialData.modelo,
          numeroSerie: initialData.numeroSerie ?? "",
          patrimonio: initialData.patrimonio ?? "",
          capacidade: initialData.capacidade ?? "",
          fluido: initialData.fluido ?? "",
          tensao: initialData.tensao ?? "",
          localizacao: initialData.localizacao ?? "",
          dataInstalacao: toDateInput(initialData.dataInstalacao),
          dataFabricacao: toDateInput(initialData.dataFabricacao),
          garantiaAte: toDateInput(initialData.garantiaAte),
          observacoes: initialData.observacoes ?? "",
        }
      : { unidadeId: unidadeIdFixo ?? "" },
  });

  useEffect(() => {
    fetch("/api/clientes").then((r) => r.json()).then(setClientes).catch(() => {});
  }, []);

  useEffect(() => {
    if (!clienteIdSelecionado) { setUnidades([]); return; }
    fetch(`/api/unidades?clienteId=${clienteIdSelecionado}`)
      .then((r) => r.json())
      .then(setUnidades)
      .catch(() => {});
  }, [clienteIdSelecionado]);

  // Pré-carrega unidades se estiver editando
  useEffect(() => {
    if (initialData?.unidade?.clienteId) {
      setClienteIdSelecionado(initialData.unidade.clienteId);
    }
  }, [initialData]);

  async function onSubmit(data: EquipamentoInput) {
    setErroGlobal("");
    try {
      const url = isEditing ? `/api/equipamentos/${initialData!.id}` : "/api/equipamentos";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const err = await res.json();
        setErroGlobal(err.erro ?? "Erro ao salvar equipamento.");
        return;
      }

      router.push("/equipamentos");
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

      {/* Cliente → Unidade (cascata) */}
      <FormSection title="Localização">
        <FormField label="Cliente" required hint="Selecione o cliente para carregar os endereços">
          <Select
            value={clienteIdSelecionado}
            onChange={(e) => {
              setClienteIdSelecionado(e.target.value);
              setValue("unidadeId", "");
            }}
            placeholder="Selecione o cliente"
          >
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nomeFantasia ?? c.nome}</option>
            ))}
          </Select>
        </FormField>

        <FormField label="Endereço" required error={errors.unidadeId?.message}>
          <Select
            {...register("unidadeId")}
            error={!!errors.unidadeId}
            placeholder={clienteIdSelecionado ? "Selecione o endereço" : "Selecione um cliente primeiro"}
            disabled={!clienteIdSelecionado}
          >
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}{u.cidade ? ` — ${u.cidade}` : ""}
              </option>
            ))}
          </Select>
        </FormField>
      </FormSection>

      {/* Identificação do equipamento */}
      <FormSection title="Identificação">
        <FormGrid>
          <FormField label="Tipo de equipamento" required error={errors.tipo?.message}>
            <Select {...register("tipo")} error={!!errors.tipo} placeholder="Selecione o tipo">
              {TIPOS_EQUIPAMENTO.map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </Select>
          </FormField>
        </FormGrid>
        <FormGrid cols={3}>
          <FormField label="Marca" required error={errors.marca?.message}>
            <Input {...register("marca")} placeholder="Ex: Trane, Carrier, LG" error={!!errors.marca} />
          </FormField>
          <FormField label="Modelo" required error={errors.modelo?.message}>
            <Input {...register("modelo")} error={!!errors.modelo} />
          </FormField>
          <FormField label="Número de série">
            <Input {...register("numeroSerie")} placeholder="S/N ou código" />
          </FormField>
        </FormGrid>
        <FormGrid>
          <FormField label="Número de patrimônio" hint="Código interno de identificação">
            <Input {...register("patrimonio")} />
          </FormField>
          <FormField label="Localização no local" hint="Onde o equipamento está instalado neste endereço">
            <Input {...register("localizacao")} placeholder="Ex: Sala 3, Cobertura, Cozinha" />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* Dados técnicos */}
      <FormSection title="Dados técnicos">
        <FormGrid cols={3}>
          <FormField label="Capacidade" hint="BTUs, TR, HP…">
            <Input {...register("capacidade")} placeholder="Ex: 12.000 BTU" />
          </FormField>
          <FormField label="Fluido refrigerante">
            <Select {...register("fluido")} placeholder="Selecione ou deixe em branco">
              {FLUIDOS_COMUNS.map((f) => (<option key={f} value={f}>{f}</option>))}
            </Select>
          </FormField>
          <FormField label="Tensão elétrica">
            <Select {...register("tensao")} placeholder="Selecione">
              {TENSOES_COMUNS.map((t) => (<option key={t} value={t}>{t}</option>))}
            </Select>
          </FormField>
        </FormGrid>
      </FormSection>

      {/* Datas */}
      <FormSection title="Datas">
        <FormGrid cols={3}>
          <FormField label="Data de instalação">
            <Input {...register("dataInstalacao")} type="date" />
          </FormField>
          <FormField label="Data de fabricação">
            <Input {...register("dataFabricacao")} type="date" />
          </FormField>
          <FormField label="Garantia até">
            <Input {...register("garantiaAte")} type="date" />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* Observações */}
      <FormSection title="Observações">
        <FormField label="Observações">
          <Textarea {...register("observacoes")} placeholder="Histórico, particularidades, acessórios…" rows={3} />
        </FormField>
      </FormSection>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? "Salvar alterações" : "Cadastrar equipamento"}
        </Button>
      </div>
    </form>
  );
}
