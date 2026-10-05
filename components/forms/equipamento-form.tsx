"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { ClienteCombobox } from "@/components/ui/cliente-combobox";
import { GaleriaImagens } from "@/components/ui/galeria-imagens";
import { MapaEndereco } from "@/components/ui/mapa-endereco";
import { EquipamentoQrSection } from "@/components/forms/equipamento-qr-section";
import { TipoBadge, TipoIcone } from "@/components/equipamentos/tipo-equipamento";
import { StatusSelo } from "@/components/equipamentos/selos";
import { SelectCadastroRapido, type CampoRapido, type OpcaoCadastro } from "@/components/ui/select-cadastro-rapido";
import Link from "next/link";
import { LABELS_TIPO_EQUIPAMENTO, cn } from "@/lib/utils";
import { Thermometer, ImageIcon, MapPin, Cog, QrCode, History, CheckCircle2, ClipboardList, ChevronLeft, ExternalLink } from "lucide-react";

const TIPOS_EQUIPAMENTO = Object.entries(LABELS_TIPO_EQUIPAMENTO);

/** Tipos personalizados (sem `chaveEnum`) entram no select como "custom:<id>". */
const PREFIXO_CUSTOM = "custom:";
type TipoCustom = { id: string; nome: string; chaveEnum: string | null; ativo: boolean };

// Cadastro rápido: só o essencial (o cadastro completo fica a um link de distância)
const CAMPOS_UNIDADE: CampoRapido[] = [
  { nome: "nome", label: "Nome do local", obrigatorio: true, placeholder: "Ex: Matriz, Loja Centro, Bloco A" },
  { nome: "cep", label: "CEP", tipo: "cep", placeholder: "00000-000", colunas: 2 },
  { nome: "logradouro", label: "Endereço", placeholder: "Rua / Avenida", colunas: 4 },
  { nome: "numero", label: "Número", placeholder: "Nº", colunas: 2 },
  { nome: "cidade", label: "Cidade", colunas: 2 },
  { nome: "estado", label: "UF", tipo: "uf", colunas: 2 },
];
const CAMPOS_TIPO: CampoRapido[] = [
  { nome: "nome", label: "Nome do tipo", obrigatorio: true, placeholder: "Ex: Cortina de ar, Bebedouro, Purificador" },
];
const FLUIDOS = ["R22", "R410A", "R32", "R407C", "R404A", "R134a", "R290", "Outro"];
const TENSOES = ["110V", "127V", "220V", "380V", "440V"];
const FASES = ["Monofásico", "Bifásico", "Trifásico"];

const STATUS_OS: Record<string, { label: string; cor: string }> = {
  ABERTA: { label: "Aberta", cor: "text-sky-600 bg-sky-50" },
  AGUARDANDO_ATENDIMENTO: { label: "Aguardando", cor: "text-amber-600 bg-amber-50" },
  AGENDADA: { label: "Agendada", cor: "text-indigo-600 bg-indigo-50" },
  EM_ANDAMENTO: { label: "Em andamento", cor: "text-sky-600 bg-sky-50" },
  PAUSADA: { label: "Pausada", cor: "text-gray-500 bg-gray-100" },
  AGUARDANDO_PECA: { label: "Aguardando peça", cor: "text-amber-600 bg-amber-50" },
  CONCLUIDA: { label: "Concluída", cor: "text-emerald-600 bg-emerald-50" },
  CANCELADA: { label: "Cancelada", cor: "text-red-600 bg-red-50" },
};

function toDateInput(date: any): string {
  if (!date) return "";
  return new Date(date).toISOString().split("T")[0];
}
function dataBR(d: any): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
const UNIDADES_CAPACIDADE = ["BTU/h", "TR"];

/** Separa "12.000 BTU/h" / "5 TR" em valor + unidade (valores antigos sem unidade = BTU/h). */
function separarCapacidade(cap?: string | null): { valor: string; unidade: string } {
  const txt = (cap ?? "").trim();
  const m = txt.match(/^(.*?)\s*(BTU\/h|BTU|TR)$/i);
  if (!m) return { valor: txt, unidade: "BTU/h" };
  return { valor: m[1].trim(), unidade: m[2].toUpperCase() === "TR" ? "TR" : "BTU/h" };
}

function opcoesComValor(base: string[], valor?: string) {
  return valor && !base.includes(valor) ? [valor, ...base] : base;
}

type UnidadeItem = { id: string; nome: string; cidade?: string | null; logradouro?: string | null; numero?: string | null; estado?: string | null; cep?: string | null; clienteId: string };

type Aba = "identificacao" | "localizacao" | "tecnicos" | "qrcode" | "historico";

interface EquipamentoFormProps {
  initialData?: any;
  unidadeIdFixo?: string;
  abaInicial?: string;
}

const ABAS_VALIDAS: Aba[] = ["identificacao", "localizacao", "tecnicos", "qrcode", "historico"];

export function EquipamentoForm({ initialData, unidadeIdFixo, abaInicial }: EquipamentoFormProps) {
  const router = useRouter();
  const isEditing = !!initialData;

  const abaInicialValida =
    abaInicial && ABAS_VALIDAS.includes(abaInicial as Aba) && (isEditing || (abaInicial !== "qrcode" && abaInicial !== "historico"))
      ? (abaInicial as Aba)
      : "identificacao";
  const [aba, setAba] = useState<Aba>(abaInicialValida);
  const [erroGlobal, setErroGlobal] = useState("");
  const [salvando, setSalvando] = useState(false);

  const [fotos, setFotos] = useState<string[]>(initialData?.fotos ?? []);
  const [clienteId, setClienteId] = useState<string>(initialData?.unidade?.clienteId ?? "");
  const [unidades, setUnidades] = useState<UnidadeItem[]>([]);
  const [carregandoUnidades, setCarregandoUnidades] = useState(false);
  const [tiposCustom, setTiposCustom] = useState<TipoCustom[]>([]);
  // Sugestões de setor/ambiente já usados em outros equipamentos do mesmo endereço
  const [sugestoesLocal, setSugestoesLocal] = useState<{ setores: string[]; ambientes: string[] }>({ setores: [], ambientes: [] });

  const [form, setForm] = useState({
    nome: initialData?.nome ?? "",
    marca: initialData?.marca ?? "",
    modelo: initialData?.modelo ?? "",
    numeroSerie: initialData?.numeroSerie ?? "",
    patrimonio: initialData?.patrimonio ?? "",
    // Tipo personalizado (sem chave do enum) é identificado pelo id do cadastro
    tipo: initialData?.tipoEquipamento && !initialData.tipoEquipamento.chaveEnum
      ? `${PREFIXO_CUSTOM}${initialData.tipoEquipamento.id}`
      : initialData?.tipo ?? "",
    anoFabricacao: initialData?.anoFabricacao ?? "",
    observacoes: initialData?.observacoes ?? "",
    unidadeId: initialData?.unidadeId ?? unidadeIdFixo ?? "",
    setor: initialData?.setor ?? "",
    localizacao: initialData?.localizacao ?? "",
    fluido: initialData?.fluido ?? "",
    capacidade: separarCapacidade(initialData?.capacidade).valor,
    capacidadeUnidade: separarCapacidade(initialData?.capacidade).unidade,
    tensao: initialData?.tensao ?? "",
    potencia: initialData?.potencia ?? "",
    fase: initialData?.fase ?? "",
    correnteNominal: initialData?.correnteNominal ?? "",
    dataInstalacao: toDateInput(initialData?.dataInstalacao),
    garantiaInicio: toDateInput(initialData?.garantiaInicio),
    garantiaAte: toDateInput(initialData?.garantiaAte),
    observacoesTecnicas: initialData?.observacoesTecnicas ?? "",
  });

  function set(campo: string, valor: any) {
    setForm((f) => ({ ...f, [campo]: valor }));
  }

  // Carrega unidades ao escolher cliente
  useEffect(() => {
    if (!clienteId) { setUnidades([]); return; }
    setCarregandoUnidades(true);
    fetch(`/api/unidades?clienteId=${clienteId}`)
      .then((r) => r.json())
      .then((lista: UnidadeItem[]) => {
        setUnidades(Array.isArray(lista) ? lista : []);
        // Auto-seleciona se houver apenas uma unidade (e ainda não há seleção)
        if (Array.isArray(lista) && lista.length === 1 && !form.unidadeId) set("unidadeId", lista[0].id);
      })
      .catch(() => {})
      .finally(() => setCarregandoUnidades(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId]);

  // Tipos personalizados da empresa (os padrões vêm do enum)
  useEffect(() => {
    fetch("/api/tipos-equipamento")
      .then((r) => r.json())
      .then((d) => setTiposCustom(Array.isArray(d) ? d.filter((t: TipoCustom) => !t.chaveEnum && t.ativo !== false) : []))
      .catch(() => {});
  }, []);

  const opcoesTipo: OpcaoCadastro[] = useMemo(() => [
    ...TIPOS_EQUIPAMENTO.map(([value, label]) => ({ value, label })),
    ...tiposCustom.map((t) => ({ value: `${PREFIXO_CUSTOM}${t.id}`, label: t.nome, descricao: "personalizado" })),
  ], [tiposCustom]);

  const opcoesUnidade: OpcaoCadastro[] = useMemo(
    () => unidades.map((u) => ({ value: u.id, label: u.nome, descricao: u.cidade ?? undefined })),
    [unidades],
  );

  async function criarUnidade(v: Record<string, string>): Promise<OpcaoCadastro> {
    const res = await fetch("/api/unidades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Primeiro endereço do cliente vira o principal
      body: JSON.stringify({ ...v, clienteId, principal: unidades.length === 0 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro ?? "Erro ao cadastrar a unidade.");
    setUnidades((lista) => [...lista, data].sort((a, b) => a.nome.localeCompare(b.nome)));
    return { value: data.id, label: data.nome, descricao: data.cidade ?? undefined };
  }

  async function criarTipo(v: Record<string, string>): Promise<OpcaoCadastro> {
    const res = await fetch("/api/tipos-equipamento", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: v.nome }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro ?? "Erro ao cadastrar o tipo.");
    setTiposCustom((lista) => [...lista, data].sort((a, b) => a.nome.localeCompare(b.nome)));
    return { value: `${PREFIXO_CUSTOM}${data.id}`, label: data.nome };
  }

  // Carrega setores/ambientes já usados no endereço selecionado (autocomplete)
  useEffect(() => {
    if (!form.unidadeId) { setSugestoesLocal({ setores: [], ambientes: [] }); return; }
    fetch(`/api/equipamentos?unidadeId=${form.unidadeId}`)
      .then((r) => r.json())
      .then((d) => {
        const lista: any[] = Array.isArray(d) ? d : [];
        const unicos = (vals: (string | null | undefined)[]) =>
          [...new Set(vals.map((v) => (v ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
        setSugestoesLocal({ setores: unicos(lista.map((e) => e.setor)), ambientes: unicos(lista.map((e) => e.localizacao)) });
      })
      .catch(() => {});
  }, [form.unidadeId]);

  const ultimaManutencao = useMemo(() => {
    const concluidas = (initialData?.ordensServico ?? []).filter((o: any) => o.status === "CONCLUIDA" && o.dataConclusao);
    if (concluidas.length === 0) return null;
    return concluidas.reduce((a: any, b: any) => (new Date(a.dataConclusao) > new Date(b.dataConclusao) ? a : b)).dataConclusao;
  }, [initialData]);

  const unidadeSel = unidades.find((u) => u.id === form.unidadeId);

  async function salvar() {
    setErroGlobal("");
    // Validações mínimas com salto para a aba do erro
    if (!form.marca || !form.modelo || !form.tipo) {
      setAba("identificacao");
      setErroGlobal("Preencha marca, modelo e tipo de equipamento.");
      return;
    }
    if (!form.unidadeId) {
      setAba("localizacao");
      setErroGlobal("Selecione o cliente e o endereço/unidade.");
      return;
    }

    if (form.garantiaInicio && form.garantiaAte && form.garantiaInicio > form.garantiaAte) {
      setAba("tecnicos");
      setErroGlobal("O início da garantia deve ser anterior ao fim.");
      return;
    }

    setSalvando(true);
    try {
      const tipoCustomId = form.tipo.startsWith(PREFIXO_CUSTOM) ? form.tipo.slice(PREFIXO_CUSTOM.length) : null;
      const payload = {
        unidadeId: form.unidadeId,
        // Tipo personalizado: a API usa tipoEquipamentoId (o enum fica como OUTRO)
        tipo: tipoCustomId ? "OUTRO" : form.tipo,
        tipoEquipamentoId: tipoCustomId ?? undefined,
        nome: form.nome || undefined,
        marca: form.marca,
        modelo: form.modelo,
        numeroSerie: form.numeroSerie || undefined,
        patrimonio: form.patrimonio || undefined,
        anoFabricacao: form.anoFabricacao || undefined,
        capacidade: form.capacidade.trim() ? `${form.capacidade.trim()} ${form.capacidadeUnidade}` : undefined,
        fluido: form.fluido || undefined,
        tensao: form.tensao || undefined,
        potencia: form.potencia || undefined,
        fase: form.fase || undefined,
        correnteNominal: form.correnteNominal || undefined,
        setor: form.setor || undefined,
        localizacao: form.localizacao || undefined,
        dataInstalacao: form.dataInstalacao || undefined,
        garantiaInicio: form.garantiaInicio || undefined,
        garantiaAte: form.garantiaAte || undefined,
        observacoes: form.observacoes || undefined,
        observacoesTecnicas: form.observacoesTecnicas || undefined,
        fotos,
      };
      const url = isEditing ? `/api/equipamentos/${initialData.id}` : "/api/equipamentos";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) { const e = await res.json(); setErroGlobal(e.erro ?? "Erro ao salvar equipamento."); return; }
      router.push("/equipamentos");
      router.refresh();
    } catch { setErroGlobal("Erro de conexão. Tente novamente."); } finally { setSalvando(false); }
  }

  const tipoLabel = form.tipo ? (opcoesTipo.find((o) => o.value === form.tipo)?.label ?? LABELS_TIPO_EQUIPAMENTO[form.tipo] ?? null) : null;
  // Ícone/cor: tipo personalizado usa o visual de "Outro"
  const tipoVisual = form.tipo.startsWith(PREFIXO_CUSTOM) ? "OUTRO" : form.tipo;
  const nomeExibicao = form.nome || [form.marca, form.modelo].filter(Boolean).join(" ") || "Novo equipamento";
  const ativo = initialData?.ativo ?? true;
  const clienteNome = initialData?.unidade?.cliente
    ? (initialData.unidade.cliente.nomeFantasia ?? initialData.unidade.cliente.nome)
    : null;
  const localResumo = [clienteNome && clienteId === initialData?.unidade?.clienteId ? clienteNome : null, unidadeSel?.nome, form.setor, form.localizacao]
    .filter(Boolean).join(" › ");

  const abas: { id: Aba; label: string; icone: any; oculta?: boolean }[] = [
    { id: "identificacao", label: "Identificação", icone: ImageIcon },
    { id: "localizacao", label: "Localização", icone: MapPin },
    { id: "tecnicos", label: "Dados Técnicos", icone: Cog },
    { id: "qrcode", label: "QR Code", icone: QrCode },
    { id: "historico", label: "Atendimentos", icone: History, oculta: !isEditing },
  ];

  return (
    <div className="space-y-5">
      {/* Cabeçalho fixo — mesmo vocabulário visual da ficha (ícone do tipo, selos, local) */}
      <div className="sticky top-0 z-20 bg-white border border-surface-border rounded-xl shadow-sm px-3 sm:px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Link href={isEditing ? `/equipamentos/${initialData.id}` : "/equipamentos"} title="Voltar" className="p-1.5 -ml-1 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          {fotos[0]
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={fotos[0]} alt="" className="w-12 h-12 rounded-lg object-cover border border-surface-border shrink-0" />
            : form.tipo ? <TipoIcone tipo={tipoVisual} tamanho="lg" className="w-12 h-12" /> : (
              <div className="w-12 h-12 rounded-lg bg-surface-alt border border-surface-border flex items-center justify-center shrink-0"><Thermometer className="w-6 h-6 text-ink-subtle" /></div>
            )}
          <div className="min-w-0">
            <h2 className="font-semibold text-ink truncate">{isEditing ? nomeExibicao : (form.marca || form.modelo || form.nome ? nomeExibicao : "Novo equipamento")}</h2>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {form.tipo && <TipoBadge tipo={tipoVisual} label={tipoLabel ?? undefined} />}
              <StatusSelo ativo={ativo} />
              {localResumo && <span className="text-[11px] text-ink-muted truncate max-w-[280px] flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" />{localResumo}</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
          <Button type="button" onClick={salvar} loading={salvando}>{isEditing ? "Salvar" : "Cadastrar"}</Button>
        </div>
      </div>

      {erroGlobal && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erroGlobal}</div>}

      {/* Abas */}
      <div className="bg-white border border-surface-border rounded-xl overflow-hidden">
        <div className="flex border-b border-surface-border overflow-x-auto">
          {abas.filter((a) => !a.oculta).map((a) => {
            const Icone = a.icone;
            const ativa = aba === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAba(a.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                  ativa ? "border-primary-500 text-primary-600 bg-primary-50/40" : "border-transparent text-ink-muted hover:text-ink hover:bg-surface-alt",
                )}
              >
                <Icone className="w-4 h-4" /> {a.label}
              </button>
            );
          })}
        </div>

        <div className="p-4 sm:p-6">
          {/* ABA 1 — Identificação */}
          {aba === "identificacao" && (
            <div className="space-y-5">
              <GaleriaImagens fotos={fotos} onChange={setFotos} />
              <FormGrid>
                <FormField label="Nome do equipamento" hint="Apelido/identificação (opcional)">
                  <Input value={form.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Ex: Split Sala de Reuniões" />
                </FormField>
                <FormField label="Tipo de equipamento" required>
                  <SelectCadastroRapido
                    value={form.tipo}
                    onChange={(v) => set("tipo", v)}
                    opcoes={opcoesTipo}
                    entidade={{ singular: "tipo de equipamento", plural: "tipos de equipamento" }}
                    placeholder="Selecione o tipo"
                    campos={CAMPOS_TIPO}
                    campoBusca="nome"
                    criar={criarTipo}
                    permissao={{ modulo: "configuracoes", acao: "gerenciar" }}
                    linkCadastroCompleto="/configuracoes/tipos-equipamento"
                  />
                </FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Marca" required>
                  <Input value={form.marca} onChange={(e) => set("marca", e.target.value)} placeholder="Ex: Trane, Carrier, LG" />
                </FormField>
                <FormField label="Modelo" required>
                  <Input value={form.modelo} onChange={(e) => set("modelo", e.target.value)} />
                </FormField>
                <FormField label="Número de série">
                  <Input value={form.numeroSerie} onChange={(e) => set("numeroSerie", e.target.value)} placeholder="S/N ou código" />
                </FormField>
              </FormGrid>
              <FormGrid>
                <FormField label="Patrimônio / TAG" hint="Código de patrimônio do cliente ou etiqueta do equipamento">
                  <Input value={form.patrimonio} onChange={(e) => set("patrimonio", e.target.value)} placeholder="Ex: PAT-00123, TAG AC-07" />
                </FormField>
                <FormField label="Ano de fabricação">
                  <Input value={form.anoFabricacao} onChange={(e) => set("anoFabricacao", e.target.value)} placeholder="Ex: 2022" />
                </FormField>
              </FormGrid>
              <FormField label="Observações">
                <Textarea value={form.observacoes} onChange={(e) => set("observacoes", e.target.value)} rows={3} placeholder="Histórico, particularidades, acessórios…" />
              </FormField>
            </div>
          )}

          {/* ABA 2 — Localização */}
          {aba === "localizacao" && (
            <div className="space-y-5">
              <FormField label="Cliente" required hint="Digite 2+ letras para buscar">
                <ClienteCombobox
                  value={clienteId}
                  initialLabel={initialData?.unidade?.cliente ? (initialData.unidade.cliente.nomeFantasia ?? initialData.unidade.cliente.nome) : undefined}
                  onChange={(id) => { setClienteId(id); set("unidadeId", ""); }}
                />
              </FormField>
              <FormField label="Endereço / Unidade" required>
                <SelectCadastroRapido
                  value={form.unidadeId}
                  onChange={(v) => set("unidadeId", v)}
                  opcoes={opcoesUnidade}
                  entidade={{ singular: "unidade", plural: "unidades", feminino: true }}
                  contexto="para este cliente"
                  placeholder="Selecione o endereço"
                  disabled={!clienteId}
                  textoDesabilitado="Selecione um cliente primeiro"
                  carregando={carregandoUnidades}
                  campos={CAMPOS_UNIDADE}
                  campoBusca="nome"
                  criar={criarUnidade}
                  // Unidade é endereço do cliente: criar exige poder editar o cliente
                  permissao={{ modulo: "clientes", acao: "editar" }}
                  linkCadastroCompleto={clienteId ? `/clientes/${clienteId}/editar` : undefined}
                />
              </FormField>
              <FormGrid>
                <FormField label="Setor" hint="Andar, bloco ou área dentro do endereço">
                  <Input value={form.setor} onChange={(e) => set("setor", e.target.value)} placeholder="Ex: 2º andar, Bloco B, Administrativo" list="sugestoes-setor" />
                  <datalist id="sugestoes-setor">{sugestoesLocal.setores.map((v) => <option key={v} value={v} />)}</datalist>
                </FormField>
                <FormField label="Ambiente" hint="Sala/ambiente onde está instalado">
                  <Input value={form.localizacao} onChange={(e) => set("localizacao", e.target.value)} placeholder="Ex: Sala de Reuniões, Recepção, CPD" list="sugestoes-ambiente" />
                  <datalist id="sugestoes-ambiente">{sugestoesLocal.ambientes.map((v) => <option key={v} value={v} />)}</datalist>
                </FormField>
              </FormGrid>
              {unidadeSel && (unidadeSel.logradouro || unidadeSel.cidade) && (
                <MapaEndereco logradouro={unidadeSel.logradouro ?? undefined} numero={unidadeSel.numero ?? undefined} cidade={unidadeSel.cidade ?? undefined} estado={unidadeSel.estado ?? undefined} cep={unidadeSel.cep ?? undefined} />
              )}
            </div>
          )}

          {/* ABA 3 — Dados Técnicos */}
          {aba === "tecnicos" && (
            <div className="space-y-5">
              <FormGrid cols={3}>
                <FormField label="Fluido refrigerante">
                  <Select value={form.fluido} onChange={(e) => set("fluido", e.target.value)} placeholder="Selecione">
                    {opcoesComValor(FLUIDOS, form.fluido).map((f) => (<option key={f} value={f}>{f}</option>))}
                  </Select>
                </FormField>
                <FormField label="Capacidade térmica">
                  <div className="flex gap-2">
                    <Input value={form.capacidade} onChange={(e) => set("capacidade", e.target.value)} placeholder={form.capacidadeUnidade === "TR" ? "Ex: 5" : "Ex: 12.000"} inputMode="decimal" />
                    <Select value={form.capacidadeUnidade} onChange={(e) => set("capacidadeUnidade", e.target.value)} className="w-28 shrink-0">
                      {UNIDADES_CAPACIDADE.map((u) => (<option key={u} value={u}>{u}</option>))}
                    </Select>
                  </div>
                </FormField>
                <FormField label="Tensão">
                  <Select value={form.tensao} onChange={(e) => set("tensao", e.target.value)} placeholder="Selecione">
                    {opcoesComValor(TENSOES, form.tensao).map((t) => (<option key={t} value={t}>{t}</option>))}
                  </Select>
                </FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Potência (kW)">
                  <Input value={form.potencia} onChange={(e) => set("potencia", e.target.value)} placeholder="Ex: 3,5" inputMode="decimal" />
                </FormField>
                <FormField label="Fase">
                  <Select value={form.fase} onChange={(e) => set("fase", e.target.value)} placeholder="Selecione">
                    {opcoesComValor(FASES, form.fase).map((f) => (<option key={f} value={f}>{f}</option>))}
                  </Select>
                </FormField>
                <FormField label="Corrente nominal (A)">
                  <Input value={form.correnteNominal} onChange={(e) => set("correnteNominal", e.target.value)} placeholder="Ex: 10" inputMode="decimal" />
                </FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Data de instalação">
                  <Input type="date" value={form.dataInstalacao} onChange={(e) => set("dataInstalacao", e.target.value)} />
                </FormField>
                <FormField label="Última manutenção" hint="Preenchido automaticamente">
                  <Input value={dataBR(ultimaManutencao)} disabled readOnly />
                </FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Início da garantia">
                  <Input type="date" value={form.garantiaInicio} onChange={(e) => set("garantiaInicio", e.target.value)} />
                </FormField>
                <FormField label="Fim da garantia">
                  <Input type="date" value={form.garantiaAte} onChange={(e) => set("garantiaAte", e.target.value)} />
                </FormField>
              </FormGrid>
              <FormField label="Observações técnicas">
                <Textarea value={form.observacoesTecnicas} onChange={(e) => set("observacoesTecnicas", e.target.value)} rows={3} placeholder="Notas técnicas, calibrações, peças trocadas…" />
              </FormField>
            </div>
          )}

          {/* ABA 4 — QR Code */}
          {aba === "qrcode" && (
            isEditing ? (
              <EquipamentoQrSection
                equipamentoId={initialData.id}
                qrInicial={initialData.qrcode ? { id: initialData.qrcode.id, codigo: initialData.qrcode.codigo } : null}
              />
            ) : (
              <div className="text-center py-10 text-ink-muted">
                <QrCode className="w-10 h-10 mx-auto mb-2 text-ink-subtle" />
                <p>Salve o equipamento primeiro para gerar ou vincular um QR Code.</p>
              </div>
            )
          )}

          {/* ABA 5 — Histórico */}
          {aba === "historico" && isEditing && (
            <div className="space-y-3">
              <Link href={`/equipamentos/${initialData.id}?aba=atendimentos`} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700">
                Ver linha do tempo completa na ficha <ExternalLink className="w-3.5 h-3.5" />
              </Link>
              {(initialData?.ordensServico ?? []).length === 0 ? (
                <div className="text-center py-10 text-ink-muted">
                  <ClipboardList className="w-10 h-10 mx-auto mb-2 text-ink-subtle" />
                  <p>Nenhuma ordem de serviço registrada para este equipamento.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-surface-border">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-alt text-ink-muted text-xs uppercase tracking-wide">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold">OS</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Data</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Tipo</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Técnico</th>
                        <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(initialData.ordensServico as any[]).map((o) => {
                        const st = STATUS_OS[o.status] ?? { label: o.status, cor: "text-gray-500 bg-gray-100" };
                        return (
                          <tr key={o.id} className="hover:bg-surface-alt/50">
                            <td className="px-4 py-2.5 font-mono text-ink">{o.numero}</td>
                            <td className="px-4 py-2.5 text-ink-muted">{dataBR(o.dataConclusao ?? o.criadoEm)}</td>
                            <td className="px-4 py-2.5 text-ink">{o.atividades?.[0]?.tipoOs?.nome ?? "—"}</td>
                            <td className="px-4 py-2.5 text-ink-muted">{o.atividades?.[0]?.tecnico?.nome ?? "—"}</td>
                            <td className="px-4 py-2.5">
                              <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", st.cor)}>
                                {o.status === "CONCLUIDA" && <CheckCircle2 className="w-3 h-3" />}{st.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
