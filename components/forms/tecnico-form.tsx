"use client";

import { useState, useRef, KeyboardEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { tecnicoSchema, type TecnicoInput } from "@/lib/validations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import type { Tecnico } from "@prisma/client";
import { X, Plus, Upload, Trash2 } from "lucide-react";

const ESPECIALIDADES_SUGERIDAS = [
  "Split", "VRF", "Chiller", "Câmara Fria",
  "Refrigeração Comercial", "Ar Central", "Fan Coil", "Torres de Resfriamento",
];

interface TecnicoFormProps {
  initialData?: Tecnico;
}

export function TecnicoForm({ initialData }: TecnicoFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [erroGlobal, setErroGlobal] = useState("");
  const [especialidades, setEspecialidades] = useState<string[]>(initialData?.especialidades ?? []);
  const [novaEsp, setNovaEsp] = useState("");
  const [avatar, setAvatar] = useState<string | null>(initialData?.avatar ?? null);
  const [erroFoto, setErroFoto] = useState("");
  const fotoRef = useRef<HTMLInputElement>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TecnicoInput>({
    resolver: zodResolver(tecnicoSchema),
    defaultValues: initialData
      ? {
          nome: initialData.nome,
          cpf: initialData.cpf,
          email: initialData.email ?? "",
          telefone: initialData.telefone,
          celular: initialData.celular ?? "",
          tipo: initialData.tipo,
          crea: initialData.crea ?? "",
          especialidades: initialData.especialidades,
          observacoes: initialData.observacoes ?? "",
        }
      : { especialidades: [], tipo: "TECNICO_CAMPO" },
  });

  function adicionarEsp(val: string) {
    const esp = val.trim();
    if (!esp || especialidades.includes(esp)) return;
    const novas = [...especialidades, esp];
    setEspecialidades(novas);
    setValue("especialidades", novas);
    setNovaEsp("");
  }

  function removerEsp(esp: string) {
    const novas = especialidades.filter((e) => e !== esp);
    setEspecialidades(novas);
    setValue("especialidades", novas);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); adicionarEsp(novaEsp); }
  }

  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fotoRef.current) fotoRef.current.value = "";
    if (!file) return;
    setErroFoto("");
    if (!file.type.startsWith("image/")) { setErroFoto("Envie uma imagem (PNG, JPG ou WEBP)."); return; }
    if (file.size > 2 * 1024 * 1024) { setErroFoto("Imagem muito grande. Tamanho máximo: 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => setAvatar(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function onSubmit(data: TecnicoInput) {
    setErroGlobal("");
    try {
      const url = isEditing ? `/api/tecnicos/${initialData!.id}` : "/api/tecnicos";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, especialidades, avatar: avatar ?? "" }),
      });
      if (!res.ok) {
        const err = await res.json();
        setErroGlobal(err.erro ?? "Erro ao salvar técnico.");
        return;
      }
      router.push("/tecnicos");
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

      {/* Dados pessoais */}
      <FormSection title="Dados pessoais">
        <FormField label="Foto do técnico" hint="Aparece no calendário e nas ordens de serviço">
          <div className="flex items-center gap-4">
            <AvatarTecnico nome={watch("nome")} fotoUrl={avatar} size={72} />
            <div className="flex flex-col gap-1.5">
              <input ref={fotoRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFoto} className="hidden" />
              <Button type="button" variant="secondary" onClick={() => fotoRef.current?.click()} className="text-xs py-1 px-2.5 h-auto">
                <Upload className="w-3.5 h-3.5" /> {avatar ? "Trocar foto" : "Enviar foto"}
              </Button>
              {avatar && (
                <Button type="button" variant="ghost" onClick={() => setAvatar(null)} className="text-xs text-red-500 hover:text-red-700 py-1 px-2.5 h-auto">
                  <Trash2 className="w-3.5 h-3.5" /> Remover
                </Button>
              )}
              <p className="text-xs text-gray-400">PNG, JPG ou WEBP — máx. 2 MB</p>
              {erroFoto && <p className="text-xs text-red-600">{erroFoto}</p>}
            </div>
          </div>
        </FormField>
        <FormGrid>
          <FormField label="Nome completo" required error={errors.nome?.message}>
            <Input {...register("nome")} error={!!errors.nome} />
          </FormField>
          <FormField label="CPF" required error={errors.cpf?.message}>
            <Input {...register("cpf")} placeholder="000.000.000-00" error={!!errors.cpf} />
          </FormField>
        </FormGrid>
        <FormGrid cols={3}>
          <FormField label="E-mail" error={errors.email?.message}>
            <Input {...register("email")} type="email" placeholder="tecnico@empresa.com.br" error={!!errors.email} />
          </FormField>
          <FormField label="Telefone" required error={errors.telefone?.message}>
            <Input {...register("telefone")} placeholder="(00) 0000-0000" error={!!errors.telefone} />
          </FormField>
          <FormField label="Celular / WhatsApp">
            <Input {...register("celular")} placeholder="(00) 00000-0000" />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* Dados profissionais */}
      <FormSection title="Dados profissionais">
        <FormGrid>
          <FormField label="Tipo" required error={errors.tipo?.message} hint="Define se aparece como opção de responsável técnico em outros cadastros">
            <Select {...register("tipo")} error={!!errors.tipo}>
              <option value="TECNICO_CAMPO">Técnico de Campo</option>
              <option value="RESPONSAVEL_TECNICO">Responsável Técnico (Engenheiro)</option>
            </Select>
          </FormField>
          <FormField label="CREA / Registro profissional" hint="Obrigatório para responsáveis técnicos">
            <Input {...register("crea")} placeholder="Ex: 5012345-D/SP" />
          </FormField>
        </FormGrid>

        <FormField label="Especialidades" hint="Pressione Enter ou clique em + para adicionar">
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input value={novaEsp} onChange={(e) => setNovaEsp(e.target.value)} onKeyDown={handleKeyDown} placeholder="Digite uma especialidade…" className="flex-1" />
              <Button type="button" variant="secondary" onClick={() => adicionarEsp(novaEsp)} className="shrink-0 px-3">
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {especialidades.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {especialidades.map((esp) => (
                  <span key={esp} className="inline-flex items-center gap-1 bg-frivo-100 text-frivo-800 text-xs font-medium px-2.5 py-1 rounded-full">
                    {esp}
                    <button type="button" onClick={() => removerEsp(esp)} className="text-frivo-500 hover:text-frivo-800">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              <p className="text-xs text-gray-400 w-full">Sugestões:</p>
              {ESPECIALIDADES_SUGERIDAS.filter((e) => !especialidades.includes(e)).map((esp) => (
                <button key={esp} type="button" onClick={() => adicionarEsp(esp)} className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2 py-0.5 rounded transition-colors">
                  + {esp}
                </button>
              ))}
            </div>
          </div>
        </FormField>
      </FormSection>

      {/* Observações */}
      <FormSection title="Observações">
        <FormField label="Observações internas">
          <Textarea {...register("observacoes")} placeholder="Informações adicionais sobre o técnico…" rows={3} />
        </FormField>
      </FormSection>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? "Salvar alterações" : "Cadastrar técnico"}
        </Button>
      </div>
    </form>
  );
}
