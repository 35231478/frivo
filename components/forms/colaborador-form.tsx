"use client";

import { CampoCep } from "@/components/ui/campo-cep";
import { enderecoDoCep } from "@/lib/cep";
import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useForm, Controller } from "react-hook-form";
import { chaveDiaCivil } from "@/lib/fuso";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { tecnicoSchema, type TecnicoInput } from "@/lib/validations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { ErrosDoFormulario, IndicadorErroAba, ResumoDeErros, useErrosDoFormulario } from "@/components/ui/formulario-erros";
import { rotuloVeiculo, sufixoStatusVeiculo, type VeiculoResumo } from "@/lib/veiculo-sugestao";
import { useModulos } from "@/components/providers/modulos-provider";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { mostrarOpcaoInativo } from "@/lib/cadastros/regras-arquivar";
import { AvatarTecnico } from "@/components/ui/avatar-tecnico";
import { reduzirImagem } from "@/lib/imagem-cliente";
import { FolhaColaborador } from "@/components/folha/folha-colaborador";
import { AcessoAppColaborador } from "@/components/forms/acesso-app-colaborador";
import { AJUDA_DOCUMENTOS, DocumentosColaborador, type ContratoAssinado } from "@/components/colaborador/documentos-colaborador";
import { resumoValidade } from "@/lib/colaborador/documentos";
import type { DocumentoLinha } from "@/lib/colaborador/documentos-server";
import type { EmitidoDaTela, ModeloDaLista } from "@/components/colaborador/gerar-documento";
import { PainelAdmissao } from "@/components/admissao/painel-admissao";
import type { OpcaoCargo } from "@/components/admissao/nova-admissao";
import type { AdmissaoDoRh } from "@/lib/admissao/admissao-server";
import { SeletorCadastro, useCadastro } from "@/components/cadastros/seletor-cadastro";
import { AvisoInativacaoStatus } from "@/components/ui/aviso-inativacao-status";
import {
  X, Plus, Upload, Trash2, CalendarClock, User, Briefcase, ListChecks, FileText, Wallet, KeyRound, UserPlus,
} from "lucide-react";
import { InputData } from "@/components/ui/input-data";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { JornadaFaixas } from "@/components/colaborador/jornada-faixas";
import { faixasDoColaborador, jornadaValida, problemasDaJornada, type FaixaJornada } from "@/lib/colaborador/jornada";
import { DICA_CAMPO, DICA_RT, MSG_RT_SEM_CREA, ROTULO_CAMPO, ROTULO_RT, funcaoDaFicha, gravarFuncao } from "@/lib/colaborador/funcao";

const ESPECIALIDADES_SUGERIDAS = [
  "Split", "VRF", "Chiller", "Câmara Fria",
  "Refrigeração Comercial", "Ar Central", "Fan Coil", "Torres de Resfriamento",
];

interface TipoOsOpt { id: string; nome: string; cor: string; ativo?: boolean }

interface ColaboradorFormProps {
  initialData?: any;
}

type Aba = "pessoais" | "profissionais" | "competencias" | "documentos" | "folha" | "acesso" | "admissao";

// Cada campo na aba onde ele está: o ponto vermelho da aba e o "abre a aba sozinha" (ERRO NO CAMPO)
const CAMPO_ABA: Record<string, Aba> = {
  nome: "pessoais", cpf: "pessoais", rg: "pessoais", dataNascimento: "pessoais", email: "pessoais", telefone: "pessoais",
  celular: "pessoais", whatsapp: "pessoais", cep: "pessoais", endereco: "pessoais", numero: "pessoais", complemento: "pessoais",
  bairro: "pessoais", cidade: "pessoais", estado: "pessoais", avatar: "pessoais",
  cargoId: "profissionais", perfilAcessoId: "profissionais", veiculoId: "profissionais", crea: "profissionais", tipo: "profissionais",
  dataAdmissao: "profissionais", statusColaborador: "profissionais", jornadaFaixas: "profissionais", observacoes: "profissionais",
  competenciaIds: "competencias", especialidades: "competencias",
};

interface EstadoAcessoInicial { email: string | null; temLogin: boolean; acessoAtivo: boolean; role: string | null }

/**
 * `podeFolha` (permissão "Financeiro › Custo de pessoal") mostra a aba "Dados financeiros / Folha".
 * Sem ela, salário e benefícios não aparecem nem chegam ao navegador.
 * `podeAdmissao` (permissão "Admissão digital › gerenciar") mostra a aba "Admissão": o convite, o
 * progresso do link e a prova da assinatura.
 */
export function ColaboradorForm({ initialData, somenteLeitura = false, podeFolha = false, podeAcesso = false, acessoInicial, podeAdmissao = false, admissao = null, cargosAdmissao = [], validadeAdmissao = 7, documentosIniciais = [], podeExcluirDocumento = false, contratoAssinado = null, podeGerarDocumento = false, podeDisciplinar = false, modelosDocumento = [], emitidosIniciais = [] }: ColaboradorFormProps & { somenteLeitura?: boolean; podeFolha?: boolean; podeAcesso?: boolean; acessoInicial?: EstadoAcessoInicial; podeAdmissao?: boolean; admissao?: AdmissaoDoRh | null; cargosAdmissao?: OpcaoCargo[]; validadeAdmissao?: number; documentosIniciais?: DocumentoLinha[]; podeExcluirDocumento?: boolean; contratoAssinado?: ContratoAssinado | null; podeGerarDocumento?: boolean; podeDisciplinar?: boolean; modelosDocumento?: ModeloDaLista[]; emitidosIniciais?: EmitidoDaTela[] }) {
  const router = useRouter();
  const isEditing = !!initialData;
  // "Inativo" no status = inativar (exige "Equipes › Excluir", como o botão; o servidor confere de novo)
  const podeInativarColab = usePermissoes().pode("equipes", "excluir");
  const [aba, setAba] = useState<Aba>("pessoais");

  const [avatar, setAvatar] = useState<string | null>(initialData?.avatar ?? null);
  const [erroFoto, setErroFoto] = useState("");
  const fotoRef = useRef<HTMLInputElement>(null);

  const [especialidades, setEspecialidades] = useState<string[]>(initialData?.especialidades ?? []);
  const [novaEsp, setNovaEsp] = useState("");
  // Leva J: a jornada em faixas (a antiga, de um horário só, abre como uma faixa); colaborador novo nasce com Seg–Sex
  const [faixas, setFaixas] = useState<FaixaJornada[]>(() => (initialData ? faixasDoColaborador(initialData)
    : [{ dias: ["SEG", "TER", "QUA", "QUI", "SEX"], entrada: "08:00", saida: "17:00", intervaloInicio: "12:00", intervaloFim: "13:00" }]));
  const [competenciaIds, setCompetenciaIds] = useState<string[]>(
    initialData?.competencias?.map((c: any) => c.id) ?? [],
  );
  // Os documentos têm vida própria (API por documento): o estado aqui em cima serve ao contador da
  // aba e ao aviso de vencido, e é a seção que o atualiza.
  const [documentos, setDocumentos] = useState<DocumentoLinha[]>(documentosIniciais);
  // Papel gerado que ainda aguarda assinatura conta na aba: é pendência, e some quando assinam.
  const [docsPendentes, setDocsPendentes] = useState(0);
  const validade = resumoValidade(documentos.map((d) => ({ dataVencimento: d.dataVencimento })));

  const [tiposOs, setTiposOs] = useState<TipoOsOpt[]>([]);
  // Perfis (ativos e inativos): o SeletorCadastro só oferece os ativos e mantém o atual se inativo
  const { itens: perfis } = useCadastro("perfis-acesso");
  const [perfilAcessoId, setPerfilAcessoId] = useState<string>(initialData?.perfilAcessoId ?? "");
  // Leva J: "Usa o app de campo" + "Responsável técnico (ART/PMOC)" no lugar de "Tipo" + "Tipo de equipe" (lib/colaborador/funcao)
  const [campo, setCampo] = useState<boolean>(() => funcaoDaFicha(initialData ?? {}).campo);
  const [rt, setRt] = useState<boolean>(() => funcaoDaFicha(initialData ?? {}).rt);
  // Veículo "padrão" (opcional): puxado automaticamente na OS quando ele executa sozinho
  const [veiculoId, setVeiculoId] = useState<string>(initialData?.veiculoId ?? "");
  const [veiculos, setVeiculos] = useState<VeiculoResumo[]>([]);
  // CAMPO-PONTE (Loja de Módulos): o colaborador é do núcleo, o veículo padrão é da Frota.
  // Frota desligada: o campo some (o vínculo que já existia fica no banco e volta ao religar).
  const temFrota = useModulos().tem("veiculos");

  useEffect(() => {
    // Competências = os tipos de OS da empresa (Configurações › Tipos de OS); o inativo some da lista, menos o já marcado
    fetch("/api/tipos-os").then((r) => r.json()).then((d) => setTiposOs(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/veiculos?resumo=1").then((r) => (r.ok ? r.json() : [])).then((d) => setVeiculos(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  // Ao marcar/desmarcar "Usa o app de campo", sugere um perfil compatível (se nenhum estiver escolhido)
  function escolherCampo(novo: boolean) {
    setCampo(novo);
    if (perfilAcessoId) return;
    const alvo = novo ? ["TECNICO"] : ["SUPERVISOR", "FINANCEIRO"];
    const sugestao = perfis.find((p) => p.ativo !== false && alvo.includes(String(p.tipo)));
    if (sugestao) setPerfilAcessoId(sugestao.id);
  }

  const dataIso = (v: any) => (v ? chaveDiaCivil(v) : "");

  const {
    register, handleSubmit, watch, setValue, control,
    formState: { errors, isSubmitting },
  } = useForm<TecnicoInput>({
    resolver: zodResolver(tecnicoSchema),
    // O foco no 1º erro é do padrão do formulário (abre a aba certa antes de focar)
    shouldFocusError: false,
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
          statusColaborador: initialData.statusColaborador ?? "ATIVO",
          observacoes: initialData.observacoes ?? "",
        }
      : { tipo: "TECNICO_CAMPO", statusColaborador: "ATIVO" },
  });

  // Status → Inativo (editando): mostra o impacto e pede motivo, como o botão Inativar
  const [motivoInativacao, setMotivoInativacao] = useState("");
  const inativandoPeloStatus = isEditing && watch("statusColaborador") === "INATIVO" && initialData?.ativo !== false && initialData?.statusColaborador !== "INATIVO";

  const jornadaOk = jornadaValida(faixas);
  // ERRO NO CAMPO: os erros do zod + os da tela/servidor no mesmo lugar; o 1º erro abre a aba e recebe o foco
  const erros = useErrosDoFormulario({ rhf: errors, abaDoCampo: CAMPO_ABA, abrirAba: (a) => setAba(a as Aba) });
  // A jornada voltou a fechar: o erro dela some (as faixas já mostram o problema de cada uma)
  useEffect(() => { if (jornadaOk) erros.limpar("jornadaFaixas"); }, [jornadaOk, erros]);
  // Desmarcou "Responsável técnico": o CREA deixa de ser exigido
  useEffect(() => { if (!rt) erros.limpar("crea"); }, [rt, erros]);
  const tiposOsVisiveis = tiposOs.filter((t) => t.ativo !== false || competenciaIds.includes(t.id));
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

  async function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fotoRef.current) fotoRef.current.value = "";
    if (!file) return;
    setErroFoto("");
    if (!file.type.startsWith("image/")) { setErroFoto("Envie uma imagem (PNG, JPG ou WEBP)."); return; }
    // Foto de perfil: reduzida no navegador (lado maior 512px, JPEG) — fica leve na listagem
    try {
      const { imagem } = await reduzirImagem(file, 512, 0.85);
      setAvatar(imagem.dataUrl);
    } catch { setErroFoto("Não foi possível abrir esta imagem."); }
  }

  async function onSubmit(data: TecnicoInput) {
    erros.limparTudo();
    const daTela: Record<string, string> = {};
    if (!jornadaOk) {
      const p = problemasDaJornada(faixas);
      daTela.jornadaFaixas = `Jornada: ${[...p.geral, ...p.faixas.flatMap((x, i) => x.map((m) => `faixa ${i + 1}: ${m}`))][0] ?? "confira as faixas."}`;
    }
    // RT sem CREA: a rota recusa (MSG_RT_SEM_CREA); a ficha avisa antes, no próprio campo
    if (rt && !(data.crea ?? "").trim()) daTela.crea = MSG_RT_SEM_CREA;
    if (!erros.validar(daTela)) return;
    try {
      const url = isEditing ? `/api/tecnicos/${initialData.id}` : "/api/tecnicos";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          avatar: avatar ?? "",
          perfilAcessoId: perfilAcessoId || null,
          veiculoId: veiculoId || null,
          ...gravarFuncao({ campo, rt }, initialData?.tipo),
          especialidades, competenciaIds, jornadaFaixas: faixas,
          ...(inativandoPeloStatus && { motivoInativacao }),
        }),
      });
      // O erro do servidor cai no campo certo ({ erro, campos }: CPF já cadastrado, e-mail em uso, CREA…)
      if (!res.ok) { erros.erroDaApi(await res.json().catch(() => ({})), "Erro ao salvar colaborador."); return; }
      router.push("/colaboradores");
      router.refresh();
    } catch {
      erros.definirGeral("Erro de conexão. Tente novamente.");
      erros.focar();
    }
  }

  // Zod recusou: os erros já estão nos campos (rhf); rola e foca o primeiro, abrindo a aba dele
  function invalido() {
    erros.definir({});
    erros.focar();
  }

  // `curto`: o rótulo no celular (as abas ficam 3 por linha em vez de uma por linha)
  const ABAS: { id: Aba; label: string; curto: string; icone: any; badge?: number }[] = [
    { id: "pessoais", label: "Dados pessoais", curto: "Pessoais", icone: User },
    { id: "profissionais", label: "Dados profissionais", curto: "Profissionais", icone: Briefcase },
    { id: "competencias", label: "Competências", curto: "Competências", icone: ListChecks, badge: competenciaIds.length },
    { id: "documentos", label: "Documentos", curto: "Documentos", icone: FileText, badge: documentos.length + docsPendentes },
    ...(podeAdmissao ? [{ id: "admissao" as const, label: "Admissão", curto: "Admissão", icone: UserPlus }] : []),
    ...(podeAcesso ? [{ id: "acesso" as const, label: "Acesso ao app", curto: "Acesso", icone: KeyRound }] : []),
    ...(podeFolha ? [{ id: "folha" as const, label: "Dados financeiros / Folha", curto: "Folha", icone: Wallet }] : []),
  ];

  const inputCls = "w-full bg-white border border-surface-border rounded-lg px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition-all";

  return (
    <ErrosDoFormulario valor={erros}>
    <form ref={erros.ref} onSubmit={handleSubmit(onSubmit, invalido)} className="space-y-5" noValidate>
      {/* A faixa do topo é só o resumo: o erro mora no campo (ERRO NO CAMPO) */}
      <ResumoDeErros />

      {/* Documento vencido é sinal da FICHA, não só da aba: aparece em qualquer aba, com o atalho.
          Dentro da própria aba, não: lá a seção já avisa, e com mais detalhe — dois avisos iguais
          na mesma tela são poluição. */}
      {validade.vencidos > 0 && aba !== "documentos" && (
        <button
          type="button" onClick={() => setAba("documentos")} data-ficha-doc-vencido
          className="flex w-full items-center gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3 text-left hover:bg-atrasado-claro/70 transition-colors"
        >
          <CalendarClock className="w-4 h-4 shrink-0" />
          <span className="flex-1">
            <strong>{validade.vencidos === 1 ? "1 documento vencido" : `${validade.vencidos} documentos vencidos`}</strong> nesta ficha.
          </span>
          <span className="underline underline-offset-2">Ver os documentos</span>
        </button>
      )}

      <div className="bg-white rounded-card shadow-card border border-surface-border overflow-hidden">
        {/* Leva J: as abas quebram linha como na ficha do cliente (sem rolagem lateral; no celular, todas à vista) */}
        <nav className="flex flex-wrap gap-1 sm:gap-1.5 px-3 sm:px-4 py-3 sm:py-4 border-b border-surface-border" data-abas-colaborador>
          {ABAS.map((t) => {
            const ativa = aba === t.id;
            // A jornada errada marca a aba já enquanto se edita (as faixas mostram o problema); o salvar conta igual
            const nErros = (erros.porAba[t.id] ?? 0) + (t.id === "profissionais" && !jornadaOk && !erros.erroDe("jornadaFaixas") ? 1 : 0);
            return (
              <button
                key={t.id} type="button" onClick={() => setAba(t.id)} data-aba={t.id} aria-current={ativa ? "page" : undefined} title={t.label}
                className={cn(
                  "flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 text-[13px] sm:text-sm font-medium rounded-card whitespace-nowrap transition-all",
                  ativa ? "bg-primary-500 text-white shadow-sm" : "text-ink-muted hover:text-ink hover:bg-surface-alt",
                )}
              >
                <t.icone className="w-4 h-4 shrink-0" />
                <span className="sm:hidden">{t.curto}</span>
                <span className="hidden sm:inline">{t.label}</span>
                {t.badge != null && t.badge > 0 && (
                  <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", ativa ? "bg-white/25 text-white" : "bg-surface-alt text-ink-muted")}>{t.badge}</span>
                )}
                <IndicadorErroAba n={nErros} />
              </button>
            );
          })}
        </nav>

        <fieldset disabled={somenteLeitura} className={cn("min-w-0 p-5 sm:p-6 lg:p-8 space-y-8", (aba === "folha" || aba === "acesso" || aba === "admissao" || aba === "documentos") && "hidden")}>
          {/* ABA 1 — Dados Pessoais */}
          <div className={cn("space-y-8", aba !== "pessoais" && "hidden")} data-aba-painel="pessoais">
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
                      <Button type="button" variant="ghost" onClick={() => setAvatar(null)} className="text-xs text-atrasado hover:text-atrasado-texto py-1 px-2.5 h-auto">
                        <Trash2 className="w-3.5 h-3.5" /> Excluir
                      </Button>
                    )}
                    <p className="text-xs text-ink-subtle">PNG, JPG ou WEBP — máx. 2 MB</p>
                    {erroFoto && <p className="text-xs text-atrasado">{erroFoto}</p>}
                  </div>
                </div>
              </FormField>
              <FormGrid>
                <FormField label="Nome completo" required name="nome">
                  <Input {...register("nome")} caixa="nome" />
                </FormField>
                <FormField label="CPF" required name="cpf" formato="cpf">
                  <Input {...register("cpf")} placeholder="000.000.000-00" inputMode="numeric" />
                </FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="RG" name="rg">
                  <Input {...register("rg")} placeholder="00.000.000-0" />
                </FormField>
                <FormField label="Data de nascimento" name="dataNascimento" formato="data">
                  <Controller name="dataNascimento" control={control} render={({ field }) => <InputData value={(field.value as string) ?? ""} onChange={field.onChange} aria-label="Data de nascimento" />} />
                </FormField>
                <FormField label="E-mail" name="email" formato="email">
                  <Input {...register("email")} caixa="email" type="email" placeholder="colaborador@empresa.com.br" />
                </FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Telefone" required name="telefone" formato="telefone">
                  <Input {...register("telefone")} placeholder="(00) 0000-0000" inputMode="tel" />
                </FormField>
                <FormField label="Celular" name="celular" formato="celular">
                  <Input {...register("celular")} placeholder="(00) 00000-0000" inputMode="tel" />
                </FormField>
                <FormField label="WhatsApp" name="whatsapp" formato="telefone">
                  <Input {...register("whatsapp")} placeholder="(00) 00000-0000" />
                </FormField>
              </FormGrid>
            </FormSection>

            <FormSection title="Endereço">
              <FormGrid cols={3}>
                <CampoCep nome="cep" valor={watch("cep") ?? ""} onValor={(v) => setValue("cep", v, { shouldDirty: true })}
                  onEndereco={(d) => {
                    // O mesmo jeito de toda tela (lib/cep › enderecoDoCep): o logradouro do colaborador é "endereco"
                    const novo = enderecoDoCep({ endereco: watch("endereco"), bairro: watch("bairro"), cidade: watch("cidade"), estado: watch("estado") }, d, { logradouro: "endereco", bairro: "bairro", cidade: "cidade", estado: "estado" });
                    for (const [k, v] of Object.entries(novo)) setValue(k as "endereco", (v as string) ?? "", { shouldDirty: true });
                  }} />
                <FormField label="Logradouro" className="sm:col-span-2" name="endereco"><Input {...register("endereco")} caixa="endereco" placeholder="Rua, avenida…" /></FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Número" name="numero"><Input {...register("numero")} /></FormField>
                <FormField label="Complemento"><Input {...register("complemento")} /></FormField>
                <FormField label="Bairro"><Input {...register("bairro")} caixa="endereco" /></FormField>
              </FormGrid>
              <FormGrid>
                <FormField label="Cidade" name="cidade"><Input {...register("cidade")} caixa="cidade" /></FormField>
                <FormField label="Estado" name="estado"><Input {...register("estado")} placeholder="UF" maxLength={2} /></FormField>
              </FormGrid>
            </FormSection>
          </div>

          {/* ABA 2 — Dados Profissionais */}
          <div className={cn("space-y-8", aba !== "profissionais" && "hidden")} data-aba-painel="profissionais">
            <FormSection title="Função">
              <FormGrid>
                <FormField label="Cargo" name="cargoId" valor={watch("cargoId") ?? ""}>
                  {/* Só cargos ativos para nova escolha; o cargo atual segue visível mesmo inativo */}
                  <SeletorCadastro
                    entidade="cargos" valor={watch("cargoId") ?? ""} placeholder="Selecione…"
                    onChange={(v) => setValue("cargoId", v, { shouldDirty: true })}
                  />
                </FormField>
                <FormField label="Perfil de acesso" hint="Permissões no sistema (Configurações › Perfis)" name="perfilAcessoId" valor={perfilAcessoId}>
                  <SeletorCadastro entidade="perfis-acesso" itens={perfis} valor={perfilAcessoId} vazio="Sem perfil" onChange={setPerfilAcessoId} />
                </FormField>
              </FormGrid>
              {temFrota && (
                <FormField label="Veículo padrão" name="veiculoId" hint="Opcional — puxado automaticamente na OS quando este colaborador executa (dá para trocar na OS)">
                  <Select aria-label="Veículo padrão" value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
                    <option value="">Sem veículo padrão</option>
                    {veiculos.filter((v) => v.status === "ATIVO" || v.id === veiculoId).map((v) => (
                      <option key={v.id} value={v.id}>{rotuloVeiculo(v)}{sufixoStatusVeiculo(v.status)}</option>
                    ))}
                  </Select>
                </FormField>
              )}
              {/* Leva J: dois conceitos claros no lugar de "Tipo" e "Tipo de equipe" (decisão no doc da leva) */}
              <div className="grid gap-3 sm:grid-cols-2" data-funcao-colaborador>
                <div data-usa-app-campo={campo ? "sim" : "nao"}><ToggleSwitch label={ROTULO_CAMPO} dica={DICA_CAMPO} checked={campo} onChange={escolherCampo} disabled={somenteLeitura} /></div>
                <div data-responsavel-tecnico={rt ? "sim" : "nao"}><ToggleSwitch label={ROTULO_RT} dica={DICA_RT} checked={rt} onChange={setRt} disabled={somenteLeitura} /></div>
              </div>
              {rt && (
                <FormField label="CREA / Registro profissional" required hint="Obrigatório para responsáveis técnicos" name="crea">
                  <Input {...register("crea")} placeholder="Ex: 5012345-D/SP" data-campo-crea />
                </FormField>
              )}
              <FormGrid>
                <FormField label="Data de admissão" name="dataAdmissao" formato="data">
                  <Controller name="dataAdmissao" control={control} render={({ field }) => <InputData value={(field.value as string) ?? ""} onChange={field.onChange} aria-label="Data de admissão" />} />
                </FormField>
                <FormField label="Status" name="statusColaborador">
                  <Select {...register("statusColaborador")}>
                    <option value="ATIVO">Ativo</option>
                    {mostrarOpcaoInativo(podeInativarColab, initialData?.statusColaborador) && <option value="INATIVO">Inativo</option>}
                    <option value="FERIAS">Férias</option>
                    <option value="AFASTADO">Afastado</option>
                  </Select>
                </FormField>
              </FormGrid>
              {isEditing && <AvisoInativacaoStatus url={`/api/tecnicos/${initialData.id}`} mostrar={inativandoPeloStatus} motivo={motivoInativacao} onMotivo={setMotivoInativacao} />}
            </FormSection>

            <FormSection title="Jornada de trabalho" dica="Uma faixa por grupo de dias com o mesmo horário (ex.: Seg–Qui 07:30–17:30 e Sex 07:30–16:30). O intervalo é descontado das horas. Vai para o contrato e os documentos.">
              {/* A jornada é um campo do formulário (jornadaFaixas): o erro dela leva até aqui; cada faixa diz o seu problema */}
              <div data-campo-nome="jornadaFaixas" data-campo-com-erro={erros.erroDe("jornadaFaixas") ? "" : undefined}>
                <JornadaFaixas faixas={faixas} onChange={setFaixas} disabled={somenteLeitura} />
              </div>
            </FormSection>

            <FormSection title="Observações">
              <FormField label="Observações internas" name="observacoes">
                <Textarea {...register("observacoes")} placeholder="Informações adicionais…" rows={3} />
              </FormField>
            </FormSection>
          </div>

          {/* ABA 3 — Competências */}
          <div className={cn("space-y-8", aba !== "competencias" && "hidden")} data-aba-painel="competencias">
            <FormSection title="Competências para execução">
              <p className="text-sm text-ink-muted -mt-1">
                Tipos de OS que este colaborador pode executar; só eles são sugeridos ao criar a OS.
              </p>
              {tiposOsVisiveis.length === 0 ? (
                <p className="text-sm text-ink-subtle" data-competencias-vazio>Nenhum tipo de OS cadastrado. Cadastre em Configurações → Tipos de OS.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-competencias>
                  {tiposOsVisiveis.map((t) => {
                    const sel = competenciaIds.includes(t.id);
                    return (
                      <label key={t.id} data-competencia={t.id} className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors",
                        sel ? "border-primary-300 bg-primary-50" : "border-surface-border hover:bg-surface-alt",
                      )}>
                        <input type="checkbox" checked={sel} onChange={() => toggleCompetencia(t.id)}
                          className="w-4 h-4 rounded border-surface-border text-primary-600 focus:ring-primary-500" />
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.cor }} />
                        <span className="text-sm text-ink">{t.nome}</span>
                        {t.ativo === false && <span className="text-xs text-ink-subtle" data-competencia-inativa>(inativo)</span>}
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
        </fieldset>

        {/* ABA — Documentos (cada arquivo tem a sua própria rota; salvar o cadastro não mexe neles) */}
        {aba === "documentos" && (
          <div className="p-5 sm:p-6 lg:p-8">
            <FormSection title="Documentos" dica={AJUDA_DOCUMENTOS}>
              {isEditing ? (
                <DocumentosColaborador
                  colaboradorId={initialData.id}
                  documentosIniciais={documentos}
                  podeExcluir={podeExcluirDocumento}
                  somenteLeitura={somenteLeitura}
                  contratoAssinado={contratoAssinado}
                  podeGerar={podeGerarDocumento}
                  podeDisciplinar={podeDisciplinar}
                  modelos={modelosDocumento}
                  emitidosIniciais={emitidosIniciais}
                  onMudou={setDocumentos}
                  onPendentes={setDocsPendentes}
                />
              ) : (
                <p className="text-sm text-ink-muted">
                  Salve o colaborador primeiro para anexar os documentos dele.
                </p>
              )}
            </FormSection>
          </div>
        )}

        {/* ABA — Admissão digital (o convite e o acompanhamento; tudo por API própria) */}
        {podeAdmissao && aba === "admissao" && (
          <div className="p-5 sm:p-6 lg:p-8">
            <FormSection title="Admissão digital">
              {isEditing ? (
                <PainelAdmissao
                  colaborador={{ id: initialData.id, nome: initialData.nome, cargoId: initialData.cargoId ?? null }}
                  admissao={admissao} cargos={cargosAdmissao} validadePadrao={validadeAdmissao}
                />
              ) : (
                <p className="text-sm text-ink-muted">Salve o colaborador primeiro para gerar o convite de admissão.</p>
              )}
            </FormSection>
          </div>
        )}

        {/* ABA — Acesso ao app (login de técnico; salva por API própria, fora do cadastro) */}
        {podeAcesso && aba === "acesso" && (
          <div className="p-5 sm:p-6 lg:p-8">
            <FormSection title="Acesso ao app">
              {isEditing && acessoInicial ? (
                <AcessoAppColaborador tecnicoId={initialData.id} emailSalvo={acessoInicial.email} inicial={acessoInicial} />
              ) : (
                <p className="text-sm text-ink-muted">Salve o colaborador primeiro para liberar o acesso ao app.</p>
              )}
            </FormSection>
          </div>
        )}

        {/* ABA 5 — Dados financeiros / Folha (só com a permissão; salva separado do cadastro) */}
        {podeFolha && aba === "folha" && (
          <div className="p-5 sm:p-6 lg:p-8">
            {isEditing ? <FolhaColaborador colaboradorId={initialData.id} /> : (
              <p className="text-sm text-ink-muted">Salve o colaborador; os dados financeiros ficam disponíveis na edição.</p>
            )}
          </div>
        )}
      </div>

      {aba === "folha" || aba === "acesso" || aba === "documentos" ? null : somenteLeitura ? (
        <p data-somente-leitura className="text-right text-xs text-ink-muted pt-1">Somente leitura: requer a permissão Equipes › gerenciar.</p>
      ) : (
        <div className="flex items-center justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
          <Button type="submit" loading={isSubmitting}>
            {isEditing ? "Salvar alterações" : "Cadastrar colaborador"}
          </Button>
        </div>
      )}
    </form>
    </ErrosDoFormulario>
  );
}
