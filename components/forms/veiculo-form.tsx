"use client";

import { confirmar, toast } from "@/components/ui/avisos";
import { SelectCadastroRapido } from "@/components/ui/select-cadastro-rapido";
import { COLABORADOR, EQUIPE } from "@/components/cadastro-rapido/definicoes";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn, formatarData, formatarMoeda } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormField, FormSection, FormGrid } from "@/components/ui/form-field";
import { Bloco, Opcionais } from "@/components/ui/bloco-cadastro";
import { FotosVeiculo } from "@/components/veiculos/fotos-veiculo";
import { CrlvPorFoto, type DadosCrlv } from "@/components/veiculos/crlv-por-foto";
import { ChecklistsPreenchidos } from "@/components/veiculos/checklists-preenchidos";
import { aliviarFotos } from "@/lib/imagem-cliente";
import { COMBUSTIVEIS } from "@/lib/veiculo-campos";
import { organizarFotosVeiculo, type RotuloFotoVeiculo } from "@/lib/veiculo-fotos";
import {
  Truck, UserCog, FileText, Wrench, ClipboardCheck, AlertCircle, Plus, Trash2, Upload, X, ChevronLeft, CheckCircle2, Circle, ChevronDown, Lock,
  ExternalLink,
} from "lucide-react";
import { InputData } from "@/components/ui/input-data";
import { usePermissoes } from "@/components/providers/permissoes-provider";
import { AvisoInativacaoStatus } from "@/components/ui/aviso-inativacao-status";
import { mostrarOpcaoInativo } from "@/lib/cadastros/regras-arquivar";

type Aba = "identificacao" | "responsavel" | "documentos" | "manutencoes" | "checklists";

const TIPOS_VEICULO = [
  { v: "CARRO", l: "Carro" }, { v: "VAN", l: "Van" }, { v: "MOTO", l: "Moto" },
  { v: "CAMINHAO", l: "Caminhão" }, { v: "OUTRO", l: "Outro" },
];
const STATUS_VEICULO = [
  { v: "ATIVO", l: "Ativo" }, { v: "INATIVO", l: "Inativo" }, { v: "MANUTENCAO", l: "Em manutenção" },
];
const TIPOS_DOC_VEICULO = [
  { v: "CRLV", l: "CRLV" }, { v: "SEGURO", l: "Seguro" }, { v: "IPVA", l: "IPVA" },
  { v: "CNH_MOTORISTA", l: "CNH do Motorista" }, { v: "OUTRO", l: "Outro" },
];
const TIPOS_MANUT = [
  { v: "PREVENTIVA", l: "Preventiva" }, { v: "CORRETIVA", l: "Corretiva" }, { v: "REVISAO", l: "Revisão" },
];

interface Opt { id: string; nome: string }
interface DocItem { tipo: string; nome: string; arquivoUrl: string | null; dataVencimento: string | null }

function formatarPlaca(v: string): string {
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
  if (s.length >= 5 && /[A-Z]/.test(s[4])) return s; // Mercosul (LLLNLNN)
  if (s.length > 3) return `${s.slice(0, 3)}-${s.slice(3)}`;
  return s;
}

const ABAS_VEICULO: Aba[] = ["identificacao", "responsavel", "documentos", "manutencoes", "checklists"];

export function VeiculoForm({ initialData, ocorrencias, somenteLeitura = false, abaInicial }: {
  initialData?: any;
  /** A aba que abre (`?aba=` da ficha: o sino leva a Documentos ou Checklists) */
  abaInicial?: string;
  ocorrencias?: { descricao: string; count: number }[];
  /** Sem "veiculos.gerenciar": a ficha abre para consulta, sem salvar nem ler documento por IA. */
  somenteLeitura?: boolean;
}) {
  const router = useRouter();
  const { pode } = usePermissoes();
  const podeChecklist = pode("veiculos", "checklist");
  const isEditing = !!initialData;
  const veiculoId = initialData?.id as string | undefined;

  const [aba, setAba] = useState<Aba>(() => (initialData && ABAS_VEICULO.includes(abaInicial as Aba) ? (abaInicial as Aba) : "identificacao"));
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Enquanto a conferência do CRLV está aberta, o formulário manual fica escondido (evita salvar sem conferir)
  const [conferindo, setConferindo] = useState(false);

  // Fotos por ângulo (Frente = capa); veículos antigos sem rótulo aparecem em "Outros"
  const [fotos, setFotos] = useState<string[]>(() => organizarFotosVeiculo(initialData?.fotos ?? [], initialData?.fotosRotulos ?? []).fotos);
  const [fotosRotulos, setFotosRotulos] = useState<RotuloFotoVeiculo[]>(() => organizarFotosVeiculo(initialData?.fotos ?? [], initialData?.fotosRotulos ?? []).fotosRotulos);
  const mudarFotos = (f: string[], r: RotuloFotoVeiculo[]) => { setFotos(f); setFotosRotulos(r); };
  const [form, setForm] = useState({
    placa: initialData?.placa ?? "",
    marca: initialData?.marca ?? "",
    modelo: initialData?.modelo ?? "",
    ano: initialData?.ano ?? "",
    anoModelo: initialData?.anoModelo ?? "",
    combustivel: initialData?.combustivel ?? "",
    cor: initialData?.cor ?? "",
    tipo: initialData?.tipo ?? "CARRO",
    chassi: initialData?.chassi ?? "",
    renavam: initialData?.renavam ?? "",
    status: initialData?.status ?? "ATIVO",
    observacoes: initialData?.observacoes ?? "",
    responsavelId: initialData?.responsavelId ?? "",
    equipeId: initialData?.equipeId ?? "",
    quilometragemAtual: initialData?.quilometragemAtual?.toString() ?? "",
    proximaRevisaoKm: initialData?.proximaRevisaoKm?.toString() ?? "",
    proximaRevisaoData: initialData?.proximaRevisaoData ? String(initialData.proximaRevisaoData).slice(0, 10) : "",
    seguroVencimento: initialData?.seguroVencimento ? String(initialData.seguroVencimento).slice(0, 10) : "",
  });
  const upd = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const [documentos, setDocumentos] = useState<DocItem[]>(
    (initialData?.documentos ?? []).map((d: any) => ({
      tipo: d.tipo, nome: d.nome, arquivoUrl: d.arquivoUrl ?? null,
      dataVencimento: d.dataVencimento ? String(d.dataVencimento).slice(0, 10) : null,
    })),
  );
  const docRef = useRef<HTMLInputElement>(null);
  const docIdx = useRef<number | null>(null);

  const [colaboradores, setColaboradores] = useState<Opt[]>([]);
  const [equipes, setEquipes] = useState<Opt[]>([]);
  const [manutencoes, setManutencoes] = useState<any[]>(initialData?.manutencoes ?? []);

  useEffect(() => {
    fetch("/api/tecnicos").then((r) => r.json()).then((d) => setColaboradores(Array.isArray(d) ? d : [])).catch(() => {});
    // Só equipes ativas; a já vinculada continua aparecendo mesmo se tiver sido inativada
    const vinculada = initialData?.equipeId;
    fetch("/api/equipes").then((r) => r.json()).then((d) => setEquipes(Array.isArray(d)
      ? d.filter((e: any) => e.status === "ATIVA" || e.id === vinculada)
        .map((e: any) => ({ id: e.id, nome: e.status === "ATIVA" ? e.nome : `${e.nome} (inativa)` }))
      : [])).catch(() => {});
  }, []);

  /** Dados conferidos do CRLV → campos do cadastro (só os que a pessoa manteve preenchidos). */
  function aplicarCrlv(d: DadosCrlv) {
    setForm((f) => ({
      ...f,
      ...(d.placa && { placa: formatarPlaca(d.placa) }),
      ...(d.marca && { marca: d.marca }),
      ...(d.modelo && { modelo: d.modelo }),
      ...(d.ano_fabricacao && { ano: d.ano_fabricacao }),
      ...(d.ano_modelo && { anoModelo: d.ano_modelo }),
      ...(d.cor && { cor: d.cor }),
      ...(d.combustivel && { combustivel: d.combustivel }),
      ...(d.tipo && { tipo: d.tipo }),
      ...(d.chassi && { chassi: d.chassi }),
      ...(d.renavam && { renavam: d.renavam }),
    }));
    if (d.registrarCrlv && d.exercicio) {
      const nome = `CRLV ${d.exercicio}`;
      setDocumentos((p) => (p.some((x) => x.tipo === "CRLV" && x.nome === nome) ? p : [...p, { tipo: "CRLV", nome, arquivoUrl: null, dataVencimento: null }]));
    }
    setErro("");
  }

  function addDoc() { setDocumentos((p) => [...p, { tipo: "CRLV", nome: "", arquivoUrl: null, dataVencimento: null }]); }
  function updDoc(i: number, k: keyof DocItem, v: string | null) { setDocumentos((p) => p.map((d, idx) => (idx === i ? { ...d, [k]: v } : d))); }
  function removeDoc(i: number) { setDocumentos((p) => p.filter((_, idx) => idx !== i)); }
  function escolherArquivo(i: number) { docIdx.current = i; docRef.current?.click(); }
  function handleDocFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; const i = docIdx.current;
    if (docRef.current) docRef.current.value = "";
    if (!file || i == null) return;
    if (file.size > 3 * 1024 * 1024) { setErro("Arquivo muito grande. Máximo 3 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => updDoc(i, "arquivoUrl", typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  // Cadastro novo (página única): ao dar erro, leva a pessoa até a mensagem
  useEffect(() => {
    if (erro && !isEditing) document.querySelector("[data-erro]")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [erro, isEditing]);

  // Inativar pelo seletor de status (só na edição, saindo de outro status): o mesmo do botão Inativar
  const inativandoPeloStatus = isEditing && form.status === "INATIVO" && initialData?.status !== "INATIVO";
  const [motivoInativacao, setMotivoInativacao] = useState("");

  async function salvar() {
    setErro("");
    if (!form.placa.trim()) { setErro("Placa é obrigatória."); setAba("identificacao"); return; }
    if (!form.modelo.trim()) { setErro("Modelo é obrigatório."); setAba("identificacao"); return; }
    if (documentos.some((d) => !d.nome.trim())) { setErro("Preencha o nome de todos os documentos."); setAba("documentos"); return; }
    setSalvando(true);
    try {
      const url = isEditing ? `/api/veiculos/${veiculoId}` : "/api/veiculos";
      const res = await fetch(url, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, fotos: await aliviarFotos(fotos), fotosRotulos, documentos,
          ...(inativandoPeloStatus && { motivoInativacao }),
          quilometragemAtual: form.quilometragemAtual || null,
          proximaRevisaoKm: form.proximaRevisaoKm || null,
          proximaRevisaoData: form.proximaRevisaoData || null,
          seguroVencimento: form.seguroVencimento || null,
        }),
      });
      if (res.status === 413) { setErro("As fotos ficaram grandes demais para enviar. Remova alguma foto e tente de novo."); return; }
      if (!res.ok) { const e = await res.json().catch(() => ({})); setErro(e.erro ?? "Não foi possível salvar o veículo."); return; }
      toast(isEditing ? "Veículo salvo." : "Veículo cadastrado.");
      router.push("/veiculos");
      router.refresh();
    } catch { setErro("Sem conexão. Tente de novo."); } finally { setSalvando(false); }
  }

  // Responsável e equipe: escolher ou cadastrar na hora; para corrigir o cadastro, o nome abre o cadastro dele em
  // outra aba (Leva I: sem o "editar no contexto" aqui — o veículo não perde o que está sendo preenchido)
  const porNome = (a: Opt, b: Opt) => a.nome.localeCompare(b.nome, "pt-BR");
  const seletorResponsavel = (
    <div data-responsavel-veiculo={form.responsavelId}>
      <SelectCadastroRapido
        value={form.responsavelId} onChange={(v) => upd("responsavelId", v)} placeholder="Sem responsável" disabled={somenteLeitura}
        textoDesabilitado={colaboradores.find((c) => c.id === form.responsavelId)?.nome ?? "Sem responsável"}
        opcoes={colaboradores.length ? [{ value: "", label: "Sem responsável" }, ...colaboradores.map((c) => ({ value: c.id, label: c.nome }))] : []}
        entidade={COLABORADOR.entidade} campos={COLABORADOR.campos} campoBusca="nome" permissao={COLABORADOR.permissao} linkCadastroCompleto={COLABORADOR.link}
        criar={async (v) => {
          const c = await COLABORADOR.criar(v);
          setColaboradores((l) => [...l, { id: c.id, nome: c.nome }].sort(porNome));
          toast("Colaborador cadastrado.");
          return { value: c.id, label: c.nome };
        }}
      />
      {form.responsavelId && <LinkDoCadastro href={`/colaboradores/${form.responsavelId}/editar`} nome={colaboradores.find((c) => c.id === form.responsavelId)?.nome} tipo="colaborador" />}
    </div>
  );
  const seletorEquipe = (
    <div data-equipe-veiculo={form.equipeId}>
      <SelectCadastroRapido
        value={form.equipeId} onChange={(v) => upd("equipeId", v)} placeholder="Sem equipe" disabled={somenteLeitura}
        textoDesabilitado={equipes.find((e) => e.id === form.equipeId)?.nome ?? "Sem equipe"}
        opcoes={equipes.length ? [{ value: "", label: "Sem equipe" }, ...equipes.map((e) => ({ value: e.id, label: e.nome }))] : []}
        entidade={EQUIPE.entidade} campos={EQUIPE.campos} campoBusca="nome" permissao={EQUIPE.permissao} linkCadastroCompleto={EQUIPE.link}
        criar={async (v) => {
          const e = await EQUIPE.criar(v);
          setEquipes((l) => [...l, { id: e.id, nome: e.nome }].sort(porNome));
          toast("Equipe cadastrada.");
          return { value: e.id, label: e.nome };
        }}
      />
      {form.equipeId && <LinkDoCadastro href={`/equipes/${form.equipeId}/editar`} nome={equipes.find((e) => e.id === form.equipeId)?.nome} tipo="equipe" />}
    </div>
  );

  const seletorCombustivel = (
    <Select aria-label="Combustível" value={form.combustivel} onChange={(e) => upd("combustivel", e.target.value)}>
      <option value="">Selecione</option>
      {COMBUSTIVEIS.map((c) => <option key={c} value={c}>{c}</option>)}
      {form.combustivel && !(COMBUSTIVEIS as readonly string[]).includes(form.combustivel) && <option value={form.combustivel}>{form.combustivel}</option>}
    </Select>
  );

  const listaDocumentos = (
    <>
      {documentos.length === 0 ? (
        <p className="text-sm text-ink-subtle py-4 text-center border border-dashed border-surface-border rounded-lg">Nenhum documento adicionado.</p>
      ) : (
        <div className="space-y-3">
          {documentos.map((doc, i) => {
            const venc = doc.dataVencimento;
            const vencido = venc && new Date(venc).getTime() < Date.now();
            const alerta = !vencido && venc && new Date(venc).getTime() <= Date.now() + 30 * 864e5;
            return (
              <div key={i} className="border border-surface-border rounded-lg p-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <FormField label="Tipo">
                    <Select value={doc.tipo} onChange={(e) => updDoc(i, "tipo", e.target.value)}>
                      {TIPOS_DOC_VEICULO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                    </Select>
                  </FormField>
                  <FormField label="Nome / descrição"><Input value={doc.nome} onChange={(e) => updDoc(i, "nome", e.target.value)} placeholder="Ex: CRLV 2026" /></FormField>
                  <FormField label="Vencimento"><InputData value={doc.dataVencimento ?? ""} onChange={(v) => updDoc(i, "dataVencimento", v || null)} /></FormField>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="secondary" onClick={() => escolherArquivo(i)} className="text-xs py-1 px-2.5 h-auto">
                      <Upload className="w-3.5 h-3.5" /> {doc.arquivoUrl ? "Trocar arquivo" : "Anexar arquivo"}
                    </Button>
                    {doc.arquivoUrl && <span className="text-xs text-success-600">Arquivo anexado</span>}
                    {vencido && <span className="text-xs font-semibold bg-atrasado-claro text-atrasado-texto px-2 py-0.5 rounded-full">Vencido</span>}
                    {alerta && <span className="text-xs font-semibold bg-atencao-claro text-atencao-texto px-2 py-0.5 rounded-full">Vence em 30 dias</span>}
                  </div>
                  <button type="button" onClick={() => removeDoc(i)} className="text-atrasado hover:text-atrasado-texto p-1.5"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Button type="button" variant="secondary" onClick={addDoc} className="w-full justify-center border-dashed">
        <Plus className="w-4 h-4" /> Adicionar documento
      </Button>
    </>
  );

  const ABAS: { id: Aba; label: string; icone: any; badge?: number; soEdicao?: boolean }[] = [
    { id: "identificacao", label: "Identificação", icone: Truck },
    { id: "responsavel", label: "Responsável", icone: UserCog },
    { id: "documentos", label: "Documentos", icone: FileText, badge: documentos.length },
    { id: "manutencoes", label: "Manutenções", icone: Wrench, badge: manutencoes.length, soEdicao: true },
    { id: "checklists", label: "Checklists", icone: ClipboardCheck, badge: initialData?.checklists?.length, soEdicao: true },
  ];

  /* ───────── Cadastro novo: página única em blocos, com a leitura do CRLV em destaque ───────── */
  if (!isEditing) {
    const obrigatorios: [string, boolean][] = [["Placa", !!form.placa.trim()], ["Modelo", !!form.modelo.trim()]];
    const feitos = obrigatorios.filter(([, ok]) => ok).length;
    return (
      <div className="space-y-6" data-cadastro-novo-veiculo>
        <input ref={docRef} type="file" onChange={handleDocFile} className="hidden" />
        <div className="flex items-start gap-3">
          <Link href="/veiculos" title="Voltar" className="mt-1 p-1.5 -ml-1 rounded-lg text-ink-muted hover:text-primary-600 hover:bg-surface-alt"><ChevronLeft className="w-5 h-5" /></Link>
          <div>
            <h1 className="text-2xl font-bold text-ink tracking-tight">Novo veículo</h1>
            <p className="text-sm text-ink-muted mt-0.5">Só placa e modelo são obrigatórios. O resto pode ser completado depois.</p>
          </div>
        </div>

        <CrlvPorFoto onAplicar={aplicarCrlv} onConferindo={setConferindo} />

        <div className={cn("space-y-6", conferindo && "hidden")}>
        <div className="flex items-center gap-3 text-xs text-ink-subtle">
          <span className="h-px flex-1 bg-surface-border" /> ou preencha manualmente <span className="h-px flex-1 bg-surface-border" />
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs" data-progresso>
          <span className="font-semibold text-ink">Obrigatórios {feitos}/{obrigatorios.length}:</span>
          {obrigatorios.map(([rotulo, ok]) => (
            <span key={rotulo} className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border", ok ? "text-ok-texto bg-ok-claro border-ok/20" : "text-ink-muted bg-white border-surface-border")}>
              {ok ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />} {rotulo}
            </span>
          ))}
        </div>

        {erro && <div className="flex items-center gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3" data-erro><AlertCircle className="w-4 h-4 shrink-0" /> {erro}</div>}

        <Bloco numero={1} titulo="Identificação" descricao="Os dados do documento do veículo (CRLV).">
          <FormGrid cols={3}>
            <FormField label="Placa" required>
              <Input aria-label="Placa" value={form.placa} onChange={(e) => upd("placa", formatarPlaca(e.target.value))} placeholder="AAA-0000 ou AAA0A00" />
            </FormField>
            <FormField label="Marca"><Input aria-label="Marca" value={form.marca} onChange={(e) => upd("marca", e.target.value)} placeholder="Ex: Fiat" /></FormField>
            <FormField label="Modelo" required><Input aria-label="Modelo" value={form.modelo} onChange={(e) => upd("modelo", e.target.value)} placeholder="Ex: Strada Freedom" /></FormField>
          </FormGrid>
          <FormGrid cols={3}>
            <FormField label="Tipo">
              <Select aria-label="Tipo" value={form.tipo} onChange={(e) => upd("tipo", e.target.value)}>
                {TIPOS_VEICULO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </Select>
            </FormField>
            <FormField label="Combustível">{seletorCombustivel}</FormField>
            <FormField label="Cor"><Input aria-label="Cor" value={form.cor} onChange={(e) => upd("cor", e.target.value)} placeholder="Ex: Branca" /></FormField>
          </FormGrid>
          <Opcionais rotulo="Documento">
            <FormGrid cols={2}>
              <FormField label="Ano de fabricação"><Input aria-label="Ano de fabricação" value={form.ano} onChange={(e) => upd("ano", e.target.value)} placeholder="2022" inputMode="numeric" /></FormField>
              <FormField label="Ano modelo"><Input aria-label="Ano modelo" value={form.anoModelo} onChange={(e) => upd("anoModelo", e.target.value)} placeholder="2023" inputMode="numeric" /></FormField>
            </FormGrid>
            <FormGrid cols={2}>
              <FormField label="Chassi"><Input aria-label="Chassi" value={form.chassi} onChange={(e) => upd("chassi", e.target.value.toUpperCase())} placeholder="17 caracteres" /></FormField>
              <FormField label="RENAVAM"><Input aria-label="RENAVAM" value={form.renavam} onChange={(e) => upd("renavam", e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="11 dígitos" /></FormField>
            </FormGrid>
          </Opcionais>
        </Bloco>

        <Bloco numero={2} titulo="Fotos do veículo" descricao="Uma foto por ângulo. A da frente é a capa (aparece na lista)." opcional>
          <FotosVeiculo fotos={fotos} rotulos={fotosRotulos} onChange={mudarFotos} />
        </Bloco>

        <Bloco numero={3} titulo="Responsável e equipe" descricao="Quem dirige e a qual equipe o veículo pertence." opcional>
          <FormGrid>
            <FormField label="Colaborador / motorista responsável">{seletorResponsavel}</FormField>
            <FormField label="Equipe vinculada">{seletorEquipe}</FormField>
          </FormGrid>
          <FormField label="Quilometragem atual">
            <Input type="number" value={form.quilometragemAtual} onChange={(e) => upd("quilometragemAtual", e.target.value)} placeholder="0" className="sm:max-w-xs" />
          </FormField>
        </Bloco>

        <Bloco numero={4} titulo="Documentos e revisão" descricao="Seguro, CRLV, IPVA e a próxima revisão — geram alertas antes de vencer." opcional>
          <FormGrid cols={3}>
            <FormField label="Vencimento do seguro"><InputData value={form.seguroVencimento} onChange={(v) => upd("seguroVencimento", v)} /></FormField>
            <FormField label="Próxima revisão — km"><Input type="number" value={form.proximaRevisaoKm} onChange={(e) => upd("proximaRevisaoKm", e.target.value)} placeholder="Ex: 60000" /></FormField>
            <FormField label="Próxima revisão — data"><InputData value={form.proximaRevisaoData} onChange={(v) => upd("proximaRevisaoData", v)} /></FormField>
          </FormGrid>
          <details className="group/det" open={documentos.length > 0}>
            <summary className="cursor-pointer list-none inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700">
              <ChevronDown className="w-4 h-4 transition-transform group-open/det:rotate-180" /> Documentos ({documentos.length}) e observações
            </summary>
            <div className="mt-4 space-y-4" data-documentos>
              {listaDocumentos}
              <FormField label="Observações"><Textarea value={form.observacoes} onChange={(e) => upd("observacoes", e.target.value)} rows={2} /></FormField>
            </div>
          </details>
        </Bloco>

        <div className="sticky bottom-20 lg:bottom-4 z-20" data-barra-acoes>
          <div className="flex items-center justify-between gap-3 bg-white/95 backdrop-blur border border-surface-border rounded-card shadow-lg px-4 py-3">
            <span className="text-xs text-ink-muted hidden sm:inline">{feitos === obrigatorios.length ? "Campos obrigatórios preenchidos." : `Faltam ${obrigatorios.length - feitos} campo(s) obrigatório(s).`}</span>
            <div className="flex items-center gap-2 ml-auto">
              <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
              <Button type="button" onClick={salvar} loading={salvando}>Cadastrar veículo</Button>
            </div>
          </div>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {erro && (
        <div className="flex items-center gap-2 bg-atrasado-claro border border-atrasado/20 text-atrasado-texto text-sm rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0" /> {erro}
        </div>
      )}
      <input ref={docRef} type="file" onChange={handleDocFile} className="hidden" />

      <div className="bg-white rounded-card shadow-card border border-surface-border overflow-hidden">
        <nav className="flex gap-1.5 overflow-x-auto px-4 pt-4 pb-4 border-b border-surface-border">
          {ABAS.map((t) => {
            const ativa = aba === t.id;
            const desativada = t.soEdicao && !isEditing;
            return (
              <button key={t.id} type="button" disabled={desativada} onClick={() => setAba(t.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-card whitespace-nowrap transition-all",
                  ativa ? "bg-primary-500 text-white shadow-sm" : "text-ink-muted hover:text-ink hover:bg-surface-alt",
                  desativada && "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-ink-muted",
                )}>
                <t.icone className="w-4 h-4" />
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full", ativa ? "bg-white/25 text-white" : "bg-surface-alt text-ink-muted")}>{t.badge}</span>
                )}
              </button>
            );
          })}
        </nav>

        <fieldset disabled={somenteLeitura} className={cn("p-5 sm:p-6 lg:p-8 space-y-8 min-w-0", aba === "checklists" && "hidden")}>
          {/* ABA 1 — Identificação */}
          <div className={cn("space-y-8", aba !== "identificacao" && "hidden")}>
            {!somenteLeitura && <CrlvPorFoto compacto onAplicar={aplicarCrlv} onConferindo={setConferindo} />}
            <div className={cn("space-y-8", conferindo && "hidden")}>
            <FormSection title="Fotos do veículo">
              <FotosVeiculo fotos={fotos} rotulos={fotosRotulos} onChange={mudarFotos} somenteLeitura={somenteLeitura} />
            </FormSection>
            <FormSection title="Dados do veículo">
              <FormGrid cols={3}>
                <FormField label="Placa" required>
                  <Input aria-label="Placa" value={form.placa} onChange={(e) => upd("placa", formatarPlaca(e.target.value))} placeholder="AAA-0000 ou AAA0A00" />
                </FormField>
                <FormField label="Tipo">
                  <Select value={form.tipo} onChange={(e) => upd("tipo", e.target.value)}>
                    {TIPOS_VEICULO.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </Select>
                </FormField>
                <FormField label="Status">
                  <Select value={form.status} onChange={(e) => upd("status", e.target.value)}>
                    {STATUS_VEICULO.filter((s) => s.v !== "INATIVO" || mostrarOpcaoInativo(pode("veiculos", "excluir"), initialData?.status))
                      .map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
                  </Select>
                </FormField>
              </FormGrid>
              {/* "Inativo" no seletor faz o mesmo que o botão Inativar: impacto, bloqueio e motivo */}
              {isEditing && <AvisoInativacaoStatus url={`/api/veiculos/${veiculoId}`} mostrar={inativandoPeloStatus} motivo={motivoInativacao} onMotivo={setMotivoInativacao} />}
              <FormGrid cols={3}>
                <FormField label="Marca"><Input aria-label="Marca" value={form.marca} onChange={(e) => upd("marca", e.target.value)} placeholder="Ex: Fiat" /></FormField>
                <FormField label="Modelo" required><Input aria-label="Modelo" value={form.modelo} onChange={(e) => upd("modelo", e.target.value)} placeholder="Ex: Fiorino" /></FormField>
                <FormField label="Cor"><Input aria-label="Cor" value={form.cor} onChange={(e) => upd("cor", e.target.value)} /></FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Ano de fabricação"><Input aria-label="Ano de fabricação" value={form.ano} onChange={(e) => upd("ano", e.target.value)} placeholder="2022" inputMode="numeric" /></FormField>
                <FormField label="Ano modelo"><Input aria-label="Ano modelo" value={form.anoModelo} onChange={(e) => upd("anoModelo", e.target.value)} placeholder="2023" inputMode="numeric" /></FormField>
                <FormField label="Combustível">{seletorCombustivel}</FormField>
              </FormGrid>
              <FormGrid cols={3}>
                <FormField label="Chassi"><Input aria-label="Chassi" value={form.chassi} onChange={(e) => upd("chassi", e.target.value.toUpperCase())} /></FormField>
                <FormField label="RENAVAM"><Input aria-label="RENAVAM" value={form.renavam} onChange={(e) => upd("renavam", e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></FormField>
              </FormGrid>
              <FormField label="Observações"><Textarea value={form.observacoes} onChange={(e) => upd("observacoes", e.target.value)} rows={2} /></FormField>
            </FormSection>
            </div>
          </div>

          {/* ABA 2 — Responsável */}
          <div className={cn("space-y-8", aba !== "responsavel" && "hidden")}>
            <FormSection title="Responsável e equipe">
              <FormGrid>
                <FormField label="Colaborador / motorista responsável">{seletorResponsavel}</FormField>
                <FormField label="Equipe vinculada">{seletorEquipe}</FormField>
              </FormGrid>
              <FormField label="Quilometragem atual">
                <Input type="number" value={form.quilometragemAtual} onChange={(e) => upd("quilometragemAtual", e.target.value)} placeholder="0" />
              </FormField>
            </FormSection>
          </div>

          {/* ABA 3 — Documentos */}
          <div className={cn("space-y-6", aba !== "documentos" && "hidden")}>
            <FormSection title="Vencimento do seguro">
              <FormField label="Data de vencimento do seguro" dica="Gera alerta no dashboard 30 dias antes de vencer.">
                <InputData value={form.seguroVencimento} onChange={(v) => upd("seguroVencimento", v)} className="sm:max-w-xs" />
              </FormField>
            </FormSection>
            <FormSection title="Documentos do veículo" dica="CRLV, seguro, IPVA e demais documentos. Vencidos ou vencendo em 30 dias são destacados.">
              {listaDocumentos}
            </FormSection>
          </div>

          {/* ABA 4 — Manutenções */}
          <div className={cn("space-y-8", aba !== "manutencoes" && "hidden")}>
            <FormSection title="Próxima revisão">
              <FormGrid>
                <FormField label="Próxima revisão — Quilometragem"><Input type="number" value={form.proximaRevisaoKm} onChange={(e) => upd("proximaRevisaoKm", e.target.value)} placeholder="Ex: 60000" /></FormField>
                <FormField label="Próxima revisão — Data"><InputData value={form.proximaRevisaoData} onChange={(v) => upd("proximaRevisaoData", v)} /></FormField>
              </FormGrid>
            </FormSection>
            {isEditing && <ManutencoesPanel veiculoId={veiculoId!} manutencoes={manutencoes} setManutencoes={setManutencoes} somenteLeitura={somenteLeitura} />}
          </div>

        </fieldset>
        {/* Fora do fieldset: quem só consulta abre o detalhe do checklist; cada ação confere a própria permissão */}
        <div className={cn("p-5 sm:p-6 lg:p-8", aba !== "checklists" && "hidden")} data-aba-checklists-veiculo>
          {/* ABA 5 — Checklists */}
          <div className="space-y-6">
            <FormSection title="Histórico de checklists">
              {podeChecklist && (
                <Link href={`/veiculos/checklist?veiculoId=${veiculoId ?? ""}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600 hover:text-primary-700" data-preencher-checklist>
                  <ClipboardCheck className="w-4 h-4" aria-hidden /> Preencher novo checklist
                </Link>
              )}
              {/* Só monta com a aba aberta: a lista vem da rota (com Detalhe, Editar e Excluir por permissão) */}
              {aba === "checklists" && veiculoId && (
                <ChecklistsPreenchidos veiculoId={veiculoId} colaboradores={colaboradores} onMudou={() => router.refresh()} />
              )}
            </FormSection>
            {ocorrencias && ocorrencias.length > 0 && (
              <FormSection title="Ocorrências por item (alertas recorrentes)">
                <div className="space-y-2">
                  {ocorrencias.map((o) => {
                    const max = Math.max(...ocorrencias.map((x) => x.count));
                    return (
                      <div key={o.descricao} className="flex items-center gap-3">
                        <span className="text-sm text-ink w-48 shrink-0 truncate" title={o.descricao}>{o.descricao}</span>
                        <div className="flex-1 bg-surface-alt rounded-full h-4 overflow-hidden">
                          <div className="bg-atencao h-full rounded-full" style={{ width: `${(o.count / max) * 100}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-ink-muted w-8 text-right">{o.count}</span>
                      </div>
                    );
                  })}
                </div>
              </FormSection>
            )}
          </div>
        </div>
      </div>

      {conferindo ? null : somenteLeitura ? (
        <p data-somente-leitura className="flex items-center justify-end gap-1.5 text-xs text-ink-muted pt-1"><Lock className="w-3.5 h-3.5" /> Somente leitura: requer a permissão Veículos › gerenciar.</p>
      ) : (
        <div className="flex items-center justify-end gap-3 pt-1">
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancelar</Button>
          <Button type="button" loading={salvando} onClick={salvar} data-salvar-veiculo>{isEditing ? "Salvar alterações" : "Cadastrar veículo"}</Button>
        </div>
      )}
    </div>
  );
}

/** O erro que a rota devolveu ({ erro }) ou o texto de reserva */
async function erroDa(res: Response, reserva: string): Promise<string> {
  const j = await res.json().catch(() => null);
  return (j && typeof j.erro === "string" && j.erro) || reserva;
}

function ManutencoesPanel({ veiculoId, manutencoes, setManutencoes, somenteLeitura }: { veiculoId: string; manutencoes: any[]; setManutencoes: (m: any[]) => void; somenteLeitura?: boolean }) {
  const [mostra, setMostra] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [m, setM] = useState({ tipo: "PREVENTIVA", descricao: "", quilometragem: "", custo: "", dataRealizacao: "", proximaData: "", proximaKm: "" });

  async function registrar() {
    if (!m.descricao.trim() || !m.dataRealizacao) { toast("Informe a data e a descrição da manutenção.", "erro"); return; }
    setSalvando(true);
    try {
      const res = await fetch(`/api/veiculos/${veiculoId}/manutencoes`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...m,
          quilometragem: m.quilometragem || null, custo: m.custo || null,
          proximaData: m.proximaData || null, proximaKm: m.proximaKm || null,
        }),
      });
      // Recusado: o formulário fica aberto com o que foi digitado e a tela diz por quê
      if (!res.ok) { toast(await erroDa(res, "Não foi possível registrar a manutenção."), "erro"); return; }
      const nova = await res.json();
      setManutencoes([nova, ...manutencoes]);
      setM({ tipo: "PREVENTIVA", descricao: "", quilometragem: "", custo: "", dataRealizacao: "", proximaData: "", proximaKm: "" });
      setMostra(false);
      toast("Manutenção registrada.");
    } catch { toast("Sem conexão. Tente de novo.", "erro"); } finally { setSalvando(false); }
  }

  async function remover(id: string) {
    if (!(await confirmar({ titulo: "Excluir esta manutenção?", mensagem: "O registro sai do histórico do veículo. Não dá para desfazer.", perigo: true, confirmarTexto: "Excluir" }))) return;
    try {
      const res = await fetch(`/api/veiculos/${veiculoId}/manutencoes?manutencaoId=${id}`, { method: "DELETE" });
      // Recusado (sem permissão…): a manutenção continua na lista
      if (!res.ok) { toast(await erroDa(res, "Não foi possível excluir a manutenção."), "erro"); return; }
      setManutencoes(manutencoes.filter((x) => x.id !== id));
      toast("Manutenção excluída.");
    } catch { toast("Sem conexão. Tente de novo.", "erro"); }
  }

  return (
    <FormSection title="Histórico de manutenções">
      {manutencoes.length === 0 ? (
        <p className="text-sm text-ink-subtle py-4 text-center border border-dashed border-surface-border rounded-lg">Nenhuma manutenção registrada.</p>
      ) : (
        <div className="space-y-2">
          {manutencoes.map((mn) => (
            <div key={mn.id} className="flex items-start justify-between gap-3 border border-surface-border rounded-lg p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">{TIPOS_MANUT.find((t) => t.v === mn.tipo)?.l ?? mn.tipo}</span>
                  <span className="text-sm font-medium text-ink">{mn.descricao}</span>
                </div>
                <p className="text-xs text-ink-muted mt-1">
                  {formatarData(mn.dataRealizacao)}
                  {mn.quilometragem != null && ` · ${mn.quilometragem} km`}
                  {mn.custo != null && ` · ${formatarMoeda(Number(mn.custo))}`}
                </p>
              </div>
              {!somenteLeitura && (
                <button type="button" onClick={() => remover(mn.id)} aria-label={`Excluir a manutenção ${mn.descricao}`} title="Excluir" className="text-atrasado hover:text-atrasado-texto p-1.5 shrink-0" data-excluir-manutencao={mn.id}><Trash2 className="w-4 h-4" aria-hidden /></button>
              )}
            </div>
          ))}
        </div>
      )}

      {mostra ? (
        <div className="border border-surface-border bg-surface-alt/60 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-ink">Registrar manutenção</h4>
            <button type="button" onClick={() => setMostra(false)} className="text-ink-muted hover:text-ink"><X className="w-4 h-4" /></button>
          </div>
          <FormGrid cols={3}>
            <FormField label="Tipo"><Select value={m.tipo} onChange={(e) => setM((s) => ({ ...s, tipo: e.target.value }))}>{TIPOS_MANUT.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}</Select></FormField>
            <FormField label="Data" required><InputData value={m.dataRealizacao} onChange={(v) => setM((s) => ({ ...s, dataRealizacao: v }))} /></FormField>
            <FormField label="Quilometragem"><Input type="number" value={m.quilometragem} onChange={(e) => setM((s) => ({ ...s, quilometragem: e.target.value }))} /></FormField>
          </FormGrid>
          <FormField label="Descrição" required><Input value={m.descricao} onChange={(e) => setM((s) => ({ ...s, descricao: e.target.value }))} placeholder="Ex: Troca de óleo e filtros" /></FormField>
          <FormGrid cols={3}>
            <FormField label="Custo"><Input type="number" step="0.01" value={m.custo} onChange={(e) => setM((s) => ({ ...s, custo: e.target.value }))} placeholder="0,00" /></FormField>
            <FormField label="Próxima — Data"><InputData value={m.proximaData} onChange={(v) => setM((s) => ({ ...s, proximaData: v }))} /></FormField>
            <FormField label="Próxima — Km"><Input type="number" value={m.proximaKm} onChange={(e) => setM((s) => ({ ...s, proximaKm: e.target.value }))} /></FormField>
          </FormGrid>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setMostra(false)}>Cancelar</Button>
            <Button type="button" loading={salvando} onClick={registrar} data-registrar-manutencao>Registrar</Button>
          </div>
        </div>
      ) : !somenteLeitura && (
        <Button type="button" variant="secondary" onClick={() => setMostra(true)} className="w-full justify-center border-dashed" data-nova-manutencao>
          <Plus className="w-4 h-4" aria-hidden /> Registrar manutenção
        </Button>
      )}
    </FormSection>
  );
}

/** O nome do escolhido como link para o cadastro dele, em outra aba (o formulário do veículo continua aberto) */
function LinkDoCadastro({ href, nome, tipo }: { href: string; nome?: string; tipo: "colaborador" | "equipe" }) {
  if (!nome) return null;
  return (
    <a href={href} target="_blank" rel="noopener" className="mt-1 inline-flex items-center gap-1 text-xs text-primary-700 hover:underline" data-link-cadastro={tipo}
      title={`Abrir o cadastro ${tipo === "equipe" ? "da equipe" : "do colaborador"} em outra aba`}>
      {nome} <ExternalLink className="w-3 h-3" aria-hidden />
    </a>
  );
}
