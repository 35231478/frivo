"use client";

import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { tecnicoSchema, type TecnicoInput } from "@/lib/validations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import {
  X, Plus, Upload, Trash2, AlertCircle, User, Briefcase, ListChecks, FileText,
} from "lucide-react";

const ESPECIALIDADES_SUGERIDAS = [
  "Split", "VRF", "Chiller", "Câmara Fria",
  "Refrigeração Comercial", "Ar Central", "Fan Coil", "Torres de Resfriamento",
];

const DIAS_SEMANA = [
  { code: "SEG", label: "Seg" }, { code: "TER", label: "Ter" }, { code: "QUA", label: "Qua" },
  { code: "QUI", label: "Qui" }, { code: "SEX", label: "Sex" }, { code: "SAB", label: "Sáb" },
  { code: "DOM", label: "Dom" },
];

const TIPOS_DOC = ["CNH", "Certificado NR-35", "Certificado NR-10", "ASO", "Carteira de Trabalho", "Diploma", "Outro"];

interface CargoOpt { id: string; nome: string }
interface TipoOsOpt { id: string; nome: string; cor: string }
interface DocItem { tipo: string; nome: string; arquivoUrl: string | null; dataVencimento: string | null }

interface ColaboradorFormProps {
  initialData?: any;
}

type Aba = "pessoais" | "profissionais" | "competencias" | "documentos";

function vencendoEm30(data: string | null): boolean {
  if (!data) return false;
  const venc = new Date(data).getTime();
  const limite = Date.now() + 30 * 864e5;
  return venc <= limite;
}

export function ColaboradorForm({ initialData }: ColaboradorFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;
  const [aba, setAba] = useState<Aba>("pessoais");
  const [erroGlobal, setErroGlobal] = useState("");

  const [avatar, setAvatar] = useState<string | null>(initialData?.avatar ?? null);
  const [erroFoto, setErroFoto] = useState("");
  const fotoRef = useRef<HTMLInputElement>(null);

  const [especialidades, setEspecialidades] = useState<string[]>(initialData?.especialidades ?? []);
  const [novaEsp, setNovaEsp] = useState("");
  const [jornadaDias, setJornadaDias] = useState<string[]>(initialData?.jornadaDias ?? ["SEG", "TER", "QUA", "QUI", "SEX"]);
  const [competenciaIds, setCompetenciaIds] = useState<string[]>(
    initialData?.competencias?.map((c: any) => c.id) ?? [],
  );
  const [documentos, setDocumentos] = useState<DocItem[]>(
    (initialData?.documentos ?? []).map((d: any) => ({
      tipo: d.tipo, nome: d.nome, arquivoUrl: d.arquivoUrl ?? null,
      dataVencimento: d.dataVencimento ? String(d.dataVencimento).slice(0, 10) : null,
    })),
  );

  const [cargos, setCargos] = useState<CargoOpt[]>([]);
  const [tiposOs, setTiposOs] = useState<TipoOsOpt[]>([]);
  const [perfis, setPerfis] = useState<{ id: string; nome: string; tipo: string }[]>([]);
  const [perfilAcessoId, setPerfilAcessoId] = useState<string>(initialData?.perfilAcessoId ?? "");
  const [tipoEquipe, setTipoEquipe] = useState<string>(initialData?.tipoEquipe ?? "CAMPO");
  const docRef = useRef<HTMLInputElement>(null);
  const docIdx = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/cargos").then((r) => r.json()).then((d) => setCargos(Array.isArray(d) ? d.filter((c: any) => c.ativo !== false) : [])).catch(() => {});
    fetch("/api/tipos-os").then((r) => r.json()).then((d) => setTiposOs(Array.isArray(d) ? d.filter((t: any) => t.ativo !== false) : [])).catch(() => {});
    fetch("/api/perfis-acesso").then((r) => r.json()).then((d) => setPerfis(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // Ao escolher o tipo de equipe, sugere um perfil compatível (se nenhum estiver escolhido)
  function escolherTipoEquipe(novo: string) {
    setTipoEquipe(novo);
    if (perfilAcessoId) return;
    const alvo = novo === "CAMPO" ? ["TECNICO"] : ["SUPERVISOR", "FINANCEIRO"];
    const sugestao = perfis.find((p) => alvo.includes(p.tipo));
    if (sugestao) setPerfilAcessoId(sugestao.id);
  }

  const dataIso = (v: any) => (v ? String(v).slice(0, 10) : "");

  const {
    register, handleSubmit, watch,
    formState: { errors, isSubmitting },
  } = useForm<TecnicoInput>({
    resolver: zodResolver(tecnicoSchema),
    defaultValues: initialData
      ? {
          nome: initialData.nome, cpf: initialData.cpf, rg: initialData.rg ?? "",
          dataNascimento: dataIso(initialData.dataNascimento),
          email: initialData.email ?? "", telefone: initialData.telefone,
          celular: initialData.celular ?? "", whatsapp: initialData.whatsapp ?? "",
          endereco: initialData.endereco ?? "", numero: initialData.numero ?? "",
          complemento: initialData.complemento ?? "", bairro: initialData.bairro ?? "",
          cidade: initialData.cidade ?? "", estado: initialData.estado ?? "", cep: initialData.cep ?? "",
          cargoId: initialData.cargoId ?? "", tipo: initialData.tipo, crea: initialData.crea ?? "",
          dataAdmissao: dataIso(initialData.dataAdmissao),
          salario: initialData.salario != null ? Number(initialData.salario) : undefined,
          jornadaEntrada: initialData.jornadaEntrada ?? "", jornadaSaida: initialData.jornadaSaida ?? "",
          statusColaborador: initialData.statusColaborador ?? "ATIVO",
          observacoes: initialData.observacoes ?? "",
        }
      : { tipo: "TECNICO_CAMPO", statusColaborador: "ATIVO" },
  });

  const tipo = watch("tipo");

  function toggleDia(code: string) {
    setJornadaDias((p) => (p.includes(code) ? p.filter((d) => d !== code) : [...p, code]));
  }
  function toggleCompetencia(id: string) {
    setCompetenciaIds((p) => (p.includes(id) ? p.filter((c) => c !== id) : [...p, id]));
  }
  function adicionarEsp(val: string) {
    const esp = val.trim();
    if (!esp || especialidades.includes(esp)) return;
    setEspecialidades([...especialidades, esp]);
    setNovaEsp("");
  }
  function handleEspKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); adicionarEsp(novaEsp); }
  }

  function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fotoRef.current) fotoRef.current.value = "";
    if (!file) return;
    setErroFoto("");
    if (!file.type.startsWith("image/")) { setErroFoto("Envie uma imagem (PNG, JPG ou WEBP)."); return; }
    if (file.size > 2 * 1024 * 1024) { setErroFoto("Imagem muito grande. Máximo 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => setAvatar(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  function addDocumento() {
    setDocumentos((p) => [...p, { tipo: "Outro", nome: "", arquivoUrl: null, dataVencimento: null }]);
  }
  function updDoc(idx: number, campo: keyof DocItem, valor: string | null) {
    setDocumentos((p) => p.map((d, i) => (i === idx ? { ...d, [campo]: valor } : d)));
  }
  function removeDoc(idx: number) {
    setDocumentos((p) => p.filter((_, i) => i !== idx));
  }
  function escolherArquivoDoc(idx: number) {
    docIdx.current = idx;
    docRef.current?.click();
  }
  function handleDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const idx = docIdx.current;
    if (docRef.current) docRef.current.value = "";
    if (!file || idx == null) return;
    if (file.size > 3 * 1024 * 1024) { setErroGlobal("Documento muito grande. Máximo 3 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => updDoc(idx, "arquivoUrl", typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function onSubmit(data: TecnicoInput) {
    setErroGlobal("");
    if (documentos.some((d) => !d.nome.trim())) { setErroGlobal("Preencha o nome de todos os documentos."); setAba("documentos"); return; }
    try {
      const url = isEditing ? `/api/tecnicos/${initialData.id}` : "/api/tecnicos";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          avatar: avatar ?? "",
          perfilAcessoId: perfilAcessoId || null,
          tipoEquipe,
          especialidades, competenciaIds, jornadaDias,
          documentos,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setErroGlobal(err.erro ?? "Erro ao salvar colaborador.");
        return;
      }
      router.push("/colaboradores");
      router.refresh();
    } catch {
      setErroGlobal("Erro de conexão. Tente novamente.");
    }
  }

  const ABAS: { id: Aba; label: string; icone: any; badge?: number }[] = [
    { id: "pessoais", label: "Dados Pessoais", icone: User },
    { id: "profissionais", label: "Dados Profissionais", icone: Briefcase },
    { id: "competencias", label: "Competências", icone: ListChecks, badge: competenciaIds.length },
    { id: "documentos", label: "Documentos", icone: FileText, badge: documentos.length },
  ];

  const inputCls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {erroGlobal && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {erroGlobal}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-card border border-surface-border overflow-hidden">
        <nav className="flex gap-1.5 overflow-x-auto px-4 pt-4 pb-4 border-b border-surface-border">
          {ABAS.map((t) => {
            const ativa = aba === t.id;
            return (
              <button
                key={t.id} type="button" onClick={() => setAba(t.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl whitespace-nowrap transition-all",
                  ativa ? "bg-primary-500 text-white shadow-sm" : "text-ink-muted hover:text-ink hover:bg-surface-alt",
                )}
              >
                <t.icone className="w-4 h-4" />
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", ativa ? "bg-white/25 text-white" : "bg-surface-alt text-ink-muted")}>{t.badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-5 sm:p-6 lg:p-8 space-y-8">
          {/* ABA 1 — Dados Pessoais */}
          <div className={cn("space-y-8", aba !== "pessoais" && "hidden")}>
            <FormSection title="Identificação">
              <FormField label="Foto do colaborador" hint="Aparece no calendário, equipes e ordens de serviço">
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
                    <p className="text-xs text-ink-subtle">PNG, JPG ou WEBP — máx. 2 MB</p>
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
                <FormField label="RG">
                  <Input {...register("rg")} placeholder="00.000.000-0" />
                </FormField>
                <FormField label="Data de nascimento">
                  <Input type="date" {...register("dataNascimento")} />
                </FormField>
                <FormField label="E-mail" error={errors.email?.message}>
                  <Input {...register("email")} type="email" placeholder="colaborador@empresa.com.br" error={!!errors.email} />
                </FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Telefone" required error={errors.telefone?.message}>
                  <Input {...register("telefone")} placeholder="(00) 0000-0000" error={!!errors.telefone} />
                </FormField>
                <FormField label="Celular">
                  <Input {...register("celular")} placeholder="(00) 00000-0000" />
                </FormField>
                <FormField label="WhatsApp">
                  <Input {...register("whatsapp")} placeholder="(00) 00000-0000" />
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection title="Endereço">
              <FormGrid cols={3}>
                <FormField label="CEP"><Input {...register("cep")} placeholder="00000-000" /></FormField>
                <FormField label="Logradouro" className="sm:col-span-2"><Input {...register("endereco")} placeholder="Rua, avenida…" /></FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Número"><Input {...register("numero")} /></FormField>
                <FormField label="Complemento"><Input {...register("complemento")} /></FormField>
                <FormField label="Bairro"><Input {...register("bairro")} /></FormField>
              </FormGrid>
              <FormGrid>
                <FormField label="Cidade"><Input {...register("cidade")} /></FormField>
                <FormField label="Estado"><Input {...register("estado")} placeholder="UF" maxLength={2} /></FormField>
              </FormGrid>
            </FormSection>
          </div>

          {/* ABA 2 — Dados Profissionais */}
          <div className={cn("space-y-8", aba !== "profissionais" && "hidden")}>
            <FormSection title="Função">
              <FormGrid>
                <FormField label="Cargo" hint="Cadastre cargos em Configurações → Cargos">
                  <Select {...register("cargoId")}>
                    <option value="">Selecione…</option>
                    {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </Select>
                </FormField>
                <FormField label="Tipo" required>
                  <Select {...register("tipo")}>
                    <option value="TECNICO_CAMPO">Técnico de Campo</option>
                    <option value="RESPONSAVEL_TECNICO">Responsável Técnico</option>
                    <option value="ADMINISTRATIVO">Administrativo</option>
                    <option value="MOTORISTA">Motorista</option>
                    <option value="OUTRO">Outro</option>
                  </Select>
                </FormField>
              </FormGrid>
              <FormGrid>
                <FormField label="Tipo de Equipe" hint="Define em qual equipe o colaborador aparece">
                  <Select value={tipoEquipe} onChange={(e) => escolherTipoEquipe(e.target.value)}>
                    <option value="CAMPO">Campo</option>
                    <option value="ADMINISTRATIVO">Administrativo</option>
                  </Select>
                </FormField>
                <FormField label="Perfil de Acesso" hint="Define as permissões no sistema (Configurações → Perfis)">
                  <Select value={perfilAcessoId} onChange={(e) => setPerfilAcessoId(e.target.value)}>
                    <option value="">Sem perfil</option>
                    {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </Select>
                </FormField>
              </FormGrid>
              {tipo === "RESPONSAVEL_TECNICO" && (
                <FormField label="CREA / Registro profissional" hint="Obrigatório para responsáveis técnicos">
                  <Input {...register("crea")} placeholder="Ex: 5012345-D/SP" />
                </FormField>
              )}
              <FormGrid cols={3}>
                <FormField label="Data de admissão">
                  <Input type="date" {...register("dataAdmissao")} />
                </FormField>
                <FormField label="Salário" hint="Reservado para o módulo de RH">
                  <Input type="number" step="0.01" {...register("salario")} placeholder="0,00" />
                </FormField>
                <FormField label="Status">
                  <Select {...register("statusColaborador")}>
                    <option value="ATIVO">Ativo</option>
                    <option value="INATIVO">Inativo</option>
                    <option value="FERIAS">Férias</option>
                    <option value="AFASTADO">Afastado</option>
                  </Select>
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection title="Jornada de trabalho">
              <FormGrid>
                <FormField label="Horário de entrada">
                  <Input type="time" {...register("jornadaEntrada")} />
                </FormField>
                <FormField label="Horário de saída">
                  <Input type="time" {...register("jornadaSaida")} />
                </FormField>
              </FormGrid>
              <FormField label="Dias da semana">
                <div className="flex flex-wrap gap-2">
                  {DIAS_SEMANA.map((d) => {
                    const sel = jornadaDias.includes(d.code);
                    return (
                      <button key={d.code} type="button" onClick={() => toggleDia(d.code)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                          sel ? "bg-primary-500 border-primary-500 text-white" : "bg-white border-surface-border text-ink-muted hover:border-primary-300",
                        )}>
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </FormField>
            </FormSection>

            <FormSection title="Observações">
              <FormField label="Observações internas">
                <Textarea {...register("observacoes")} placeholder="Informações adicionais…" rows={3} />
              </FormField>
            </FormSection>
          </div>

          {/* ABA 3 — Competências */}
          <div className={cn("space-y-8", aba !== "competencias" && "hidden")}>
            <FormSection title="Competências para execução">
              <p className="text-sm text-ink-muted -mt-1">
                Marque os tipos de OS que este colaborador está habilitado a executar. Na criação de ordens de serviço,
                apenas os colaboradores com competência no tipo selecionado serão sugeridos.
              </p>
              {tiposOs.length === 0 ? (
                <p className="text-sm text-ink-subtle">Nenhum tipo de OS cadastrado. Cadastre em Configurações → Tipos de OS.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {tiposOs.map((t) => {
                    const sel = competenciaIds.includes(t.id);
                    return (
                      <label key={t.id} className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
                        sel ? "border-primary-300 bg-primary-50" : "border-surface-border hover:bg-surface-alt",
                      )}>
                        <input type="checkbox" checked={sel} onChange={() => toggleCompetencia(t.id)}
                          className="w-4 h-4 rounded border-surface-border text-primary-600 focus:ring-primary-500" />
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
                        <span className="text-sm text-ink">{t.nome}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </FormSection>

            <FormSection title="Especialidades">
              <FormField label="Especialidades" hint="Pressione Enter ou clique em + para adicionar">
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Input value={novaEsp} onChange={(e) => setNovaEsp(e.target.value)} onKeyDown={handleEspKey} placeholder="Digite uma especialidade…" className="flex-1" />
                    <Button type="button" variant="secondary" onClick={() => adicionarEsp(novaEsp)} className="shrink-0 px-3"><Plus className="w-4 h-4" /></Button>
                  </div>
                  {especialidades.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {especialidades.map((esp) => (
                        <span key={esp} className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 text-xs font-medium px-2.5 py-1 rounded-full">
                          {esp}
                          <button type="button" onClick={() => setEspecialidades(especialidades.filter((x) => x !== esp))} className="text-primary-500 hover:text-primary-800"><X className="w-3 h-3" /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <p className="text-xs text-ink-subtle w-full">Sugestões:</p>
                    {ESPECIALIDADES_SUGERIDAS.filter((e) => !especialidades.includes(e)).map((esp) => (
                      <button key={esp} type="button" onClick={() => adicionarEsp(esp)} className="text-xs bg-surface-alt hover:bg-surface-border text-ink-muted px-2 py-0.5 rounded transition-colors">+ {esp}</button>
                    ))}
                  </div>
                </div>
              </FormField>
            </FormSection>
          </div>

          {/* ABA 4 — Documentos */}
          <div className={cn("space-y-6", aba !== "documentos" && "hidden")}>
            <input ref={docRef} type="file" onChange={handleDocFile} className="hidden" />
            <FormSection title="Documentos">
              <p className="text-sm text-ink-muted -mt-1">CNH, certificados, ASO e demais documentos. Documentos vencendo em até 30 dias são destacados.</p>
              {documentos.length === 0 ? (
                <p className="text-sm text-ink-subtle py-4 text-center border border-dashed border-surface-border rounded-lg">Nenhum documento adicionado.</p>
              ) : (
                <div className="space-y-3">
                  {documentos.map((doc, idx) => {
                    const venc = doc.dataVencimento;
                    const vencido = venc && new Date(venc).getTime() < Date.now();
                    const alerta = !vencido && vencendoEm30(venc);
                    return (
                      <div key={idx} className="border border-surface-border rounded-lg p-3 space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <FormField label="Tipo">
                            <select value={doc.tipo} onChange={(e) => updDoc(idx, "tipo", e.target.value)} className={inputCls}>
                              {TIPOS_DOC.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </FormField>
                          <FormField label="Nome / descrição">
                            <Input value={doc.nome} onChange={(e) => updDoc(idx, "nome", e.target.value)} placeholder="Ex: CNH categoria D" />
                          </FormField>
                          <FormField label="Vencimento">
                            <Input type="date" value={doc.dataVencimento ?? ""} onChange={(e) => updDoc(idx, "dataVencimento", e.target.value || null)} />
                          </FormField>
                        </div>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Button type="button" variant="secondary" onClick={() => escolherArquivoDoc(idx)} className="text-xs py-1 px-2.5 h-auto">
                              <Upload className="w-3.5 h-3.5" /> {doc.arquivoUrl ? "Trocar arquivo" : "Anexar arquivo"}
                            </Button>
                            {doc.arquivoUrl && <span className="text-xs text-success-600">Arquivo anexado</span>}
                            {vencido && <span className="text-xs font-semibold bg-red-50 text-red-700 px-2 py-0.5 rounded-full">Vencido</span>}
                            {alerta && <span className="text-xs font-semibold bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">Vence em 30 dias</span>}
                          </div>
                          <button type="button" onClick={() => removeDoc(idx)} className="text-red-500 hover:text-red-700 p-1.5"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button type="button" variant="secondary" onClick={addDocumento} className="w-full justify-center border-dashed">
                <Plus className="w-4 h-4" /> Adicionar documento
              </Button>
            </FormSection>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-1">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" loading={isSubmitting}>
          {isEditing ? "Salvar alterações" : "Cadastrar colaborador"}
        </Button>
      </div>
    </form>
  );
}
