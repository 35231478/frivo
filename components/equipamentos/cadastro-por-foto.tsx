"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera, ImagePlus, Loader2, ShieldAlert, Sparkles, AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight,
  DoorOpen, QrCode, Keyboard, RotateCcw, Pencil, Star, Tag, X,
} from "lucide-react";
import { cn, LABELS_TIPO_EQUIPAMENTO } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormField } from "@/components/ui/form-field";
import { ClienteCombobox } from "@/components/ui/cliente-combobox";
import { SelectCadastroRapido, type CampoRapido, type OpcaoCadastro } from "@/components/ui/select-cadastro-rapido";
import { UNIDADE } from "@/components/cadastro-rapido/definicoes";
import { reduzirImagem, type QualidadeImagem } from "@/lib/imagem-cliente";
import { AvisoSerieDuplicada } from "@/components/equipamentos/aviso-serie-duplicada";

/* ───────── Campos lidos da etiqueta (mesmos nomes do JSON pedido à IA) ───────── */
type Campo =
  | "tipo" | "marca" | "modelo" | "capacidade_valor" | "capacidade_unidade" | "tensao" | "fluido" | "numero_serie"
  | "fase" | "tag_patrimonio" | "ano_fabricacao" | "potencia_kw" | "corrente_nominal_a";
type Valores = Record<Campo, string>;

const VAZIO: Valores = {
  tipo: "", marca: "", modelo: "", capacidade_valor: "", capacidade_unidade: "BTU/h", tensao: "", fluido: "",
  numero_serie: "", fase: "", tag_patrimonio: "", ano_fabricacao: "", potencia_kw: "", corrente_nominal_a: "",
};

const FLUIDOS = ["R22", "R410A", "R32", "R407C", "R404A", "R134a", "R290", "Outro"];
const TENSOES = ["110V", "127V", "220V", "380V", "440V"];
const FASES = ["Monofásico", "Bifásico", "Trifásico"];
const PREFIXO_CUSTOM = "custom:";
const CAMPOS_TIPO: CampoRapido[] = [{ nome: "nome", label: "Nome do tipo", obrigatorio: true, placeholder: "Ex: Cortina de ar, Bebedouro" }];

/** Ordem do mini-questionário (o que a IA não leu é perguntado nesta ordem). */
const PERGUNTAS: { campo: Campo; pergunta: string; rotulo: string; obrigatorio?: boolean; tipo: "texto" | "select" | "tipo" | "capacidade"; opcoes?: string[]; placeholder?: string; inputMode?: "decimal" | "numeric" }[] = [
  { campo: "tipo", rotulo: "Tipo", pergunta: "Qual é o tipo do equipamento?", obrigatorio: true, tipo: "tipo" },
  { campo: "marca", rotulo: "Marca", pergunta: "Qual é a marca?", obrigatorio: true, tipo: "texto", placeholder: "Ex: LG, Carrier, Daikin" },
  { campo: "modelo", rotulo: "Modelo", pergunta: "Qual é o modelo?", obrigatorio: true, tipo: "texto", placeholder: "Como está na etiqueta" },
  { campo: "capacidade_valor", rotulo: "Capacidade", pergunta: "Qual é a capacidade térmica?", tipo: "capacidade" },
  { campo: "tensao", rotulo: "Tensão", pergunta: "Qual é a tensão?", tipo: "select", opcoes: TENSOES },
  { campo: "fluido", rotulo: "Gás refrigerante", pergunta: "Qual é o gás refrigerante?", tipo: "select", opcoes: FLUIDOS },
  { campo: "numero_serie", rotulo: "Nº de série", pergunta: "Qual é o número de série?", tipo: "texto", placeholder: "S/N" },
  { campo: "fase", rotulo: "Fase", pergunta: "Monofásico, bifásico ou trifásico?", tipo: "select", opcoes: FASES },
  { campo: "tag_patrimonio", rotulo: "Patrimônio / TAG", pergunta: "Tem patrimônio ou TAG do cliente?", tipo: "texto", placeholder: "Ex: PAT-00123, TAG AC-07" },
  { campo: "ano_fabricacao", rotulo: "Ano de fabricação", pergunta: "Qual é o ano de fabricação?", tipo: "texto", placeholder: "Ex: 2022", inputMode: "numeric" },
  { campo: "potencia_kw", rotulo: "Potência (kW)", pergunta: "Qual é a potência elétrica (kW)?", tipo: "texto", placeholder: "Ex: 1,15", inputMode: "decimal" },
  { campo: "corrente_nominal_a", rotulo: "Corrente nominal (A)", pergunta: "Qual é a corrente nominal (A)?", tipo: "texto", placeholder: "Ex: 5,2", inputMode: "decimal" },
];
const ROTULO: Record<string, string> = Object.fromEntries(PERGUNTAS.map((p) => [p.campo, p.rotulo]));

type Etapa = "foto" | "conferencia" | "faltantes" | "local" | "revisao" | "pronto";
type UnidadeItem = { id: string; nome: string; cidade?: string | null; clienteId: string };
type TipoCustom = { id: string; nome: string; chaveEnum: string | null; ativo: boolean };

/** Chama a leitura por IA com limite de tempo; qualquer falha vira mensagem para o fallback manual. */
async function lerComIa(tipo: "etiqueta" | "placa", imagem: string): Promise<{ ok: true; dados: any } | { ok: false; erro: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 50_000);
  try {
    const res = await fetch("/api/equipamentos/ocr", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo, imagem }), signal: ctrl.signal,
    });
    const dados = await res.json().catch(() => null);
    if (!res.ok || !dados) return { ok: false, erro: dados?.erro ?? "A leitura automática não respondeu." };
    return { ok: true, dados };
  } catch (e: any) {
    return { ok: false, erro: e?.name === "AbortError" ? "A leitura demorou demais (tempo esgotado)." : "Sem conexão com o servidor." };
  } finally {
    clearTimeout(timer);
  }
}

export function CadastroPorFoto() {
  const [etapa, setEtapa] = useState<Etapa>("foto");
  // Fotos: etiqueta (a IA lê; fica como foto de apoio) · equipamento por completo (CAPA) · outro ângulo (opcional)
  const [foto, setFoto] = useState<string | null>(null);
  const [fotoFrente, setFotoFrente] = useState<string | null>(null);
  const [fotoExtra, setFotoExtra] = useState<string | null>(null);
  const [qualidade, setQualidade] = useState<QualidadeImagem | null>(null);
  const [lendo, setLendo] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "erro" | "ruim"; texto: string } | null>(null);
  const [valores, setValores] = useState<Valores>(VAZIO);
  const [lidosPelaIa, setLidosPelaIa] = useState<Set<Campo>>(new Set());
  const [duvidosos, setDuvidosos] = useState<Set<string>>(new Set());
  const [outrasInfos, setOutrasInfos] = useState("");
  const [faltantes, setFaltantes] = useState<Campo[]>([]);
  const [idxPergunta, setIdxPergunta] = useState(0);
  const [erroEtapa, setErroEtapa] = useState("");

  // Local
  const [clienteId, setClienteId] = useState("");
  const [unidades, setUnidades] = useState<UnidadeItem[]>([]);
  const [carregandoUnidades, setCarregandoUnidades] = useState(false);
  const [unidadeId, setUnidadeId] = useState("");
  const [setor, setSetor] = useState("");
  const [ambiente, setAmbiente] = useState("");
  const [lendoPlaca, setLendoPlaca] = useState(false);
  const [avisoPlaca, setAvisoPlaca] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  // Tipos personalizados
  const [tiposCustom, setTiposCustom] = useState<TipoCustom[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState<{ id: string; qr: string | null; avisoQr?: string } | null>(null);

  const inputPlaca = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/tipos-equipamento").then((r) => r.json())
      .then((d) => setTiposCustom(Array.isArray(d) ? d.filter((t: TipoCustom) => !t.chaveEnum && t.ativo !== false) : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!clienteId) { setUnidades([]); return; }
    setCarregandoUnidades(true);
    fetch(`/api/unidades?clienteId=${clienteId}`).then((r) => r.json())
      .then((l: UnidadeItem[]) => {
        const lista = Array.isArray(l) ? l : [];
        setUnidades(lista);
        if (lista.length === 1) setUnidadeId(lista[0].id);
      })
      .catch(() => {}).finally(() => setCarregandoUnidades(false));
  }, [clienteId]);

  const opcoesTipo: OpcaoCadastro[] = useMemo(() => [
    ...Object.entries(LABELS_TIPO_EQUIPAMENTO).map(([value, label]) => ({ value, label })),
    ...tiposCustom.map((t) => ({ value: `${PREFIXO_CUSTOM}${t.id}`, label: t.nome, descricao: "personalizado" })),
  ], [tiposCustom]);
  const rotuloTipo = (v: string) => opcoesTipo.find((o) => o.value === v)?.label ?? v;

  async function criarTipo(v: Record<string, string>): Promise<OpcaoCadastro> {
    const res = await fetch("/api/tipos-equipamento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: v.nome }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro ?? "Erro ao cadastrar o tipo.");
    setTiposCustom((l) => [...l, data]);
    return { value: `${PREFIXO_CUSTOM}${data.id}`, label: data.nome };
  }
  async function criarUnidade(v: Record<string, string>): Promise<OpcaoCadastro> {
    const data = await UNIDADE.criar(clienteId, v, unidades.length === 0);
    setUnidades((l) => [...l, data]);
    return UNIDADE.opcao(data);
  }

  const set = (c: Campo, v: string) => setValores((s) => ({ ...s, [c]: v }));

  /* ───────── 1. Fotos (etiqueta para a IA + equipamento por completo = capa) ───────── */
  async function aoEscolherFoto(qual: "etiqueta" | "frente" | "extra", file: File | undefined) {
    if (!file) return;
    setAviso(null); setErroEtapa("");
    try {
      // Etiqueta em 1600px (texto miúdo para a IA); as demais em 1280px (só exibição)
      const { imagem, qualidade } = await reduzirImagem(file, qual === "etiqueta" ? 1600 : 1280, qual === "etiqueta" ? 0.82 : 0.8);
      if (qual === "etiqueta") { setFoto(imagem.dataUrl); setQualidade(qualidade); }
      else if (qual === "frente") setFotoFrente(imagem.dataUrl);
      else setFotoExtra(imagem.dataUrl);
    } catch {
      setAviso({ tipo: "erro", texto: "Não foi possível abrir esta imagem. Tente outra foto." });
    }
  }
  const remover = (qual: "etiqueta" | "frente" | "extra") => {
    if (qual === "etiqueta") { setFoto(null); setQualidade(null); } else if (qual === "frente") setFotoFrente(null); else setFotoExtra(null);
  };

  function irParaManual(motivo?: string) {
    if (motivo) setAviso({ tipo: "erro", texto: motivo });
    setLidosPelaIa(new Set()); setDuvidosos(new Set());
    const todos = PERGUNTAS.map((p) => p.campo);
    setFaltantes(todos); setIdxPergunta(0);
    setEtapa("faltantes");
  }

  async function lerEtiqueta() {
    if (!foto) return;
    if (!fotoFrente) { setAviso({ tipo: "ruim", texto: "Falta a foto do equipamento por completo (é a capa do cadastro)." }); return; }
    setLendo(true); setAviso(null);
    const r = await lerComIa("etiqueta", foto);
    setLendo(false);
    if (!r.ok) { irParaManual(`A leitura automática falhou: ${r.erro} Siga preenchendo os campos manualmente.`); return; }
    const d = r.dados;
    if (!d.legivel) {
      setAviso({ tipo: "ruim", texto: `Não deu para ler a etiqueta${d.problema_imagem ? ` (${d.problema_imagem})` : ""}. Tire outra foto mais de perto, sem reflexo — ou preencha manualmente.` });
      return;
    }
    const novos: Valores = { ...VAZIO };
    const lidos = new Set<Campo>();
    for (const p of PERGUNTAS) {
      const v = d.campos?.[p.campo];
      if (typeof v === "string" && v.trim()) { (novos as any)[p.campo] = v.trim(); lidos.add(p.campo); }
    }
    if (d.campos?.capacidade_unidade) novos.capacidade_unidade = d.campos.capacidade_unidade;
    setValores(novos); setLidosPelaIa(lidos); setDuvidosos(new Set(d.duvidosos ?? []));
    setOutrasInfos(d.outras_informacoes ?? "");
    setFaltantes(PERGUNTAS.map((p) => p.campo).filter((c) => !lidos.has(c)));
    setIdxPergunta(0);
    setEtapa(lidos.size ? "conferencia" : "faltantes");
    if (!lidos.size) setAviso({ tipo: "erro", texto: "A IA não encontrou nenhum dado nesta etiqueta. Preencha manualmente." });
  }

  /* ───────── 2. Conferência ───────── */
  function confirmarConferencia() {
    const vazios = [...lidosPelaIa].filter((c) => !valores[c].trim());
    // Campo lido e apagado na conferência volta para o questionário
    setFaltantes(PERGUNTAS.map((p) => p.campo).filter((c) => !lidosPelaIa.has(c) || vazios.includes(c)));
    setIdxPergunta(0);
    setEtapa("faltantes");
  }

  /* ───────── 3. Mini-questionário ───────── */
  const perguntaAtual = PERGUNTAS.find((p) => p.campo === faltantes[idxPergunta]);
  function proximaPergunta(pular = false) {
    setErroEtapa("");
    if (!perguntaAtual) { setEtapa("local"); return; }
    if (!pular && perguntaAtual.obrigatorio && !valores[perguntaAtual.campo].trim()) { setErroEtapa("Este campo é obrigatório."); return; }
    if (idxPergunta + 1 >= faltantes.length) setEtapa("local"); else setIdxPergunta((i) => i + 1);
  }
  useEffect(() => { if (etapa === "faltantes" && faltantes.length === 0) setEtapa("local"); }, [etapa, faltantes]);

  /* ───────── 4. Placa da porta ───────── */
  async function aoFotografarPlaca(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLendoPlaca(true); setAvisoPlaca(null);
    try {
      const { imagem } = await reduzirImagem(file, 1280, 0.8);
      const r = await lerComIa("placa", imagem.dataUrl);
      if (!r.ok) setAvisoPlaca({ tipo: "erro", texto: `A leitura da placa falhou: ${r.erro} Digite o setor e o ambiente.` });
      else if (!r.dados.legivel) setAvisoPlaca({ tipo: "erro", texto: `Não deu para ler a placa${r.dados.problema_imagem ? ` (${r.dados.problema_imagem})` : ""}. Digite o setor e o ambiente.` });
      else {
        if (r.dados.setor) setSetor(r.dados.setor);
        if (r.dados.ambiente) setAmbiente(r.dados.ambiente);
        setAvisoPlaca({ tipo: "ok", texto: "Lido da placa — confira abaixo." });
      }
    } catch {
      setAvisoPlaca({ tipo: "erro", texto: "Não foi possível abrir esta imagem. Digite o setor e o ambiente." });
    } finally {
      setLendoPlaca(false);
    }
  }
  function confirmarLocal() {
    setErroEtapa("");
    if (!clienteId || !unidadeId) { setErroEtapa("Escolha o cliente e o endereço/unidade."); return; }
    setEtapa("revisao");
  }

  /* ───────── 5. Salvar + QR ───────── */
  async function salvar() {
    setErroEtapa("");
    if (!valores.tipo || !valores.marca.trim() || !valores.modelo.trim()) { setErroEtapa("Tipo, marca e modelo são obrigatórios."); return; }
    setSalvando(true);
    try {
      const tipoCustomId = valores.tipo.startsWith(PREFIXO_CUSTOM) ? valores.tipo.slice(PREFIXO_CUSTOM.length) : null;
      const obsIa = [
        lidosPelaIa.size ? `Cadastrado pela foto da etiqueta (leitura por IA conferida pelo técnico).` : "",
        outrasInfos ? `Outras informações da etiqueta: ${outrasInfos}` : "",
      ].filter(Boolean).join("\n");
      const payload = {
        unidadeId,
        tipo: tipoCustomId ? "OUTRO" : valores.tipo,
        tipoEquipamentoId: tipoCustomId ?? undefined,
        marca: valores.marca.trim(),
        modelo: valores.modelo.trim(),
        numeroSerie: valores.numero_serie.trim() || undefined,
        patrimonio: valores.tag_patrimonio.trim() || undefined,
        anoFabricacao: valores.ano_fabricacao.trim() || undefined,
        capacidade: valores.capacidade_valor.trim() ? `${valores.capacidade_valor.trim()} ${valores.capacidade_unidade || "BTU/h"}` : undefined,
        fluido: valores.fluido || undefined,
        tensao: valores.tensao || undefined,
        fase: valores.fase || undefined,
        potencia: valores.potencia_kw.trim() || undefined,
        correnteNominal: valores.corrente_nominal_a.trim() || undefined,
        setor: setor.trim() || undefined,
        localizacao: ambiente.trim() || undefined,
        observacoesTecnicas: obsIa || undefined,
        // Capa (fotos[0]) = equipamento por completo; a etiqueta fica como foto de apoio, nunca como capa
        fotos: [fotoFrente, foto, fotoExtra].filter((x): x is string => !!x),
        gerarQrCode: true,
      };
      const res = await fetch("/api/equipamentos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErroEtapa(d.erro ?? "Não foi possível salvar o equipamento."); return; }
      setSalvo({ id: d.id, qr: d.qrcode?.codigo ?? null, avisoQr: d.avisoQr });
      setEtapa("pronto");
    } catch {
      setErroEtapa("Sem conexão. Seus dados continuam aqui — tente salvar de novo.");
    } finally {
      setSalvando(false);
    }
  }

  function recomecar() {
    setEtapa("foto"); setFoto(null); setFotoFrente(null); setFotoExtra(null); setQualidade(null); setAviso(null); setValores(VAZIO); setLidosPelaIa(new Set());
    setDuvidosos(new Set()); setOutrasInfos(""); setFaltantes([]); setIdxPergunta(0); setSetor(""); setAmbiente("");
    setAvisoPlaca(null); setSalvo(null); setErroEtapa("");
  }

  const PASSOS: { id: Etapa; rotulo: string }[] = [
    { id: "foto", rotulo: "Fotos" }, { id: "conferencia", rotulo: "Conferir" }, { id: "faltantes", rotulo: "Completar" },
    { id: "local", rotulo: "Local" }, { id: "revisao", rotulo: "Salvar" },
  ];
  const idxEtapa = PASSOS.findIndex((p) => p.id === etapa);

  /* ───────── Render ───────── */
  const campoInput = (p: (typeof PERGUNTAS)[number], autoFocus = false) => {
    const v = valores[p.campo];
    const duvida = duvidosos.has(p.campo);
    const cls = cn(duvida && "border-amber-400 bg-amber-50/50");
    if (p.tipo === "tipo")
      return (
        <SelectCadastroRapido
          value={v} onChange={(x) => set("tipo", x)} opcoes={opcoesTipo}
          entidade={{ singular: "tipo de equipamento", plural: "tipos de equipamento" }} placeholder="Selecione o tipo"
          campos={CAMPOS_TIPO} campoBusca="nome" criar={criarTipo}
          permissao={{ modulo: "configuracoes", acao: "gerenciar" }} linkCadastroCompleto="/configuracoes/tipos-equipamento"
        />
      );
    if (p.tipo === "capacidade")
      return (
        <div className="flex gap-2">
          <Input aria-label="Capacidade" value={v} onChange={(e) => set("capacidade_valor", e.target.value)} inputMode="decimal" autoFocus={autoFocus}
            placeholder={valores.capacidade_unidade === "TR" ? "Ex: 5" : "Ex: 12000"} className={cls} />
          <Select aria-label="Unidade da capacidade" value={valores.capacidade_unidade || "BTU/h"} onChange={(e) => set("capacidade_unidade", e.target.value)} className="w-28 shrink-0">
            <option value="BTU/h">BTU/h</option><option value="TR">TR</option>
          </Select>
        </div>
      );
    if (p.tipo === "select")
      return (
        <Select aria-label={p.rotulo} value={v} onChange={(e) => set(p.campo, e.target.value)} placeholder="Selecione" className={cls}>
          {(v && !p.opcoes!.includes(v) ? [v, ...p.opcoes!] : p.opcoes!).map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      );
    return <Input aria-label={p.rotulo} value={v} onChange={(e) => set(p.campo, e.target.value)} placeholder={p.placeholder} inputMode={p.inputMode} autoFocus={autoFocus} className={cls} />;
  };

  return (
    <div className="max-w-xl mx-auto space-y-4 pb-6">
      <div className="flex items-center gap-2">
        <Link href="/equipamentos/novo" className="p-2 rounded-lg text-ink-muted hover:bg-surface-alt" title="Voltar ao cadastro manual"><ChevronLeft className="w-5 h-5" /></Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-ink flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary-500" /> Cadastro pela foto</h1>
          <p className="text-sm text-ink-muted">Fotografe a etiqueta e a IA preenche a ficha. Você confere tudo antes de salvar.</p>
        </div>
      </div>

      {etapa !== "pronto" && (
        <ol className="flex items-center gap-1 text-[11px] font-semibold" aria-label="Etapas">
          {PASSOS.map((p, i) => (
            <li key={p.id} className={cn("flex-1 text-center py-1.5 rounded-md", i < idxEtapa ? "bg-primary-100 text-primary-700" : i === idxEtapa ? "bg-primary-500 text-white" : "bg-surface-alt text-ink-subtle")}>
              {p.rotulo}
            </li>
          ))}
        </ol>
      )}

      {aviso && (
        <div data-aviso-ia={aviso.tipo} className={cn("flex items-start gap-2 text-sm rounded-lg px-3 py-2 border",
          aviso.tipo === "ruim" ? "text-amber-900 bg-amber-50 border-amber-200" : "text-red-700 bg-red-50 border-red-200")}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{aviso.texto}</span>
        </div>
      )}

      <div className="bg-white border border-surface-border rounded-xl p-4 sm:p-5 space-y-4">
        {/* ── 1. Foto ── */}
        {etapa === "foto" && (
          <>
            <div data-aviso-privacidade className="flex items-start gap-2 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" />
              <span>
                <strong>Privacidade:</strong> só a foto da <strong>etiqueta</strong> é enviada para a <strong>Anthropic</strong> (IA Claude), fora do Frivo, para ler o texto.
                As fotos do equipamento ficam só no Frivo. Evite pessoas, documentos ou telas nas fotos.
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-slots-fotos>
              <SlotFoto
                id="etiqueta" titulo="1. Etiqueta" selo="A IA lê esta" seloCor="bg-violet-100 text-violet-800" icone={Tag}
                dica="De frente, bem perto, sem reflexo" obrigatoria url={foto} rotuloAria="Foto da etiqueta"
                onArquivo={(f) => aoEscolherFoto("etiqueta", f)} onRemover={() => remover("etiqueta")}
              />
              <SlotFoto
                id="frente" titulo="2. Equipamento" selo="Capa do cadastro" seloCor="bg-primary-100 text-primary-800" icone={Star}
                dica="Por completo: afaste-se e pegue o aparelho inteiro" obrigatoria url={fotoFrente} rotuloAria="Foto do equipamento"
                onArquivo={(f) => aoEscolherFoto("frente", f)} onRemover={() => remover("frente")}
              />
              <SlotFoto
                id="extra" titulo="3. Outro ângulo" selo="Opcional" seloCor="bg-surface-alt text-ink-muted" icone={Camera}
                dica="Ex.: condensadora, instalação" url={fotoExtra} rotuloAria="Outra foto"
                onArquivo={(f) => aoEscolherFoto("extra", f)} onRemover={() => remover("extra")}
              />
            </div>
            {qualidade && foto && (qualidade.escura || qualidade.borrada) && (
              <p data-aviso-qualidade className="flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                A foto da etiqueta parece {qualidade.escura ? "escura" : "tremida/sem foco"}. A leitura pode falhar — se puder, tire outra mais de perto e com luz.
              </p>
            )}
            <p className="text-xs text-ink-muted">
              A <strong className="text-ink">capa</strong> do equipamento (lista e ficha) será a foto 2 — nunca a etiqueta, que fica guardada como foto de apoio.
            </p>
            <button type="button" onClick={lerEtiqueta} disabled={lendo || !foto}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-3 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold disabled:opacity-50">
              {lendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {lendo ? "Lendo a etiqueta…" : !foto ? "Tire a foto da etiqueta para continuar" : !fotoFrente ? "Falta a foto do equipamento" : "Ler etiqueta com IA"}
            </button>
            <button type="button" onClick={() => irParaManual()} className="w-full inline-flex items-center justify-center gap-1.5 text-sm text-ink-muted hover:text-ink py-1">
              <Keyboard className="w-4 h-4" /> Sem etiqueta? Preencher manualmente
            </button>
          </>
        )}

        {/* ── 2. Conferência ── */}
        {etapa === "conferencia" && (
          <>
            <div>
              <h2 className="font-semibold text-ink">Confira o que a IA leu</h2>
              <p className="text-sm text-ink-muted">A IA pode errar: compare com a foto e corrija o que for preciso.
                {duvidosos.size > 0 && <> Campos em <span className="bg-amber-100 text-amber-900 px-1 rounded">amarelo</span> foram lidos com dúvida.</>}
              </p>
            </div>
            {foto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto} alt="Foto da etiqueta" className="w-full max-h-48 object-contain rounded-lg border border-surface-border bg-surface-alt" />
            )}
            <div className="space-y-3" data-conferencia>
              {PERGUNTAS.filter((p) => lidosPelaIa.has(p.campo)).map((p) => (
                <FormField key={p.campo} label={p.rotulo} hint={duvidosos.has(p.campo) ? "Lido com dúvida — confira" : undefined}>
                  {campoInput(p)}
                </FormField>
              ))}
              {outrasInfos && (
                <FormField label="Outras informações da etiqueta" hint="Vai para as observações técnicas">
                  <Input value={outrasInfos} onChange={(e) => setOutrasInfos(e.target.value)} />
                </FormField>
              )}
            </div>
            {faltantes.length > 0 && (
              <p className="text-xs text-ink-muted bg-surface-alt rounded-lg px-3 py-2" data-nao-lidos>
                A IA não leu: <strong>{faltantes.map((c) => ROTULO[c]).join(", ")}</strong>. Vamos perguntar a seguir (os opcionais dá para pular).
              </p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={() => setEtapa("foto")} className="px-4 py-2.5 rounded-lg border border-surface-border text-sm text-ink hover:bg-surface-alt">Voltar</button>
              <button type="button" onClick={confirmarConferencia} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold">
                <CheckCircle2 className="w-4 h-4" /> Conferi, continuar
              </button>
            </div>
          </>
        )}

        {/* ── 3. Mini-questionário ── */}
        {etapa === "faltantes" && perguntaAtual && (
          <div data-pergunta={perguntaAtual.campo} className="space-y-4">
            <p className="text-xs font-semibold text-ink-muted">Pergunta {idxPergunta + 1} de {faltantes.length}{perguntaAtual.obrigatorio ? " · obrigatória" : ""}</p>
            <h2 className="text-lg font-semibold text-ink">{perguntaAtual.pergunta}</h2>
            {campoInput(perguntaAtual, true)}
            {erroEtapa && <p className="text-sm text-red-600">{erroEtapa}</p>}
            <div className="flex gap-2">
              {idxPergunta > 0 && (
                <button type="button" onClick={() => { setErroEtapa(""); setIdxPergunta((i) => i - 1); }} className="px-3 py-2.5 rounded-lg border border-surface-border text-sm text-ink hover:bg-surface-alt" title="Pergunta anterior">
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
              {!perguntaAtual.obrigatorio && (
                <button type="button" onClick={() => proximaPergunta(true)} className="px-4 py-2.5 rounded-lg border border-surface-border text-sm text-ink-muted hover:bg-surface-alt">
                  Pular
                </button>
              )}
              <button type="button" onClick={() => proximaPergunta()} className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold">
                Próxima <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── 4. Local ── */}
        {etapa === "local" && (
          <div className="space-y-4">
            <h2 className="font-semibold text-ink">Onde ele está instalado?</h2>
            <FormField label="Cliente" required hint="Digite 2+ letras para buscar">
              <ClienteCombobox value={clienteId} onChange={(id) => { setClienteId(id); setUnidadeId(""); }} />
            </FormField>
            <FormField label="Endereço / Unidade" required>
              <SelectCadastroRapido
                value={unidadeId} onChange={setUnidadeId} opcoes={unidades.map(UNIDADE.opcao)} entidade={UNIDADE.entidade}
                contexto="para este cliente" placeholder="Selecione o endereço" disabled={!clienteId} textoDesabilitado="Selecione um cliente primeiro"
                carregando={carregandoUnidades} campos={UNIDADE.campos} campoBusca="nome" criar={criarUnidade}
                permissao={UNIDADE.permissao} linkCadastroCompleto={clienteId ? UNIDADE.link(clienteId) : undefined}
              />
            </FormField>
            <input ref={inputPlaca} type="file" accept="image/*" capture="environment" className="hidden" onChange={aoFotografarPlaca} aria-label="Foto da placa da porta" />
            <button type="button" onClick={() => inputPlaca.current?.click()} disabled={lendoPlaca}
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-lg border-2 border-dashed border-primary-300 bg-primary-50/40 text-primary-700 text-sm font-semibold hover:bg-primary-50 disabled:opacity-60">
              {lendoPlaca ? <Loader2 className="w-4 h-4 animate-spin" /> : <DoorOpen className="w-4 h-4" />}
              {lendoPlaca ? "Lendo a placa…" : "Fotografar a placa da porta/sala"}
            </button>
            <p className="text-[11px] text-ink-subtle -mt-2">A foto da placa também vai para a Anthropic só para leitura e não é guardada. Sem placa? É só digitar.</p>
            {avisoPlaca && (
              <p data-aviso-placa={avisoPlaca.tipo} className={cn("text-xs rounded-lg px-3 py-2 border", avisoPlaca.tipo === "ok" ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-amber-900 bg-amber-50 border-amber-200")}>
                {avisoPlaca.texto}
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Setor" hint="Andar, bloco ou área">
                <Input aria-label="Setor" value={setor} onChange={(e) => setSetor(e.target.value)} placeholder="Ex: 2º andar" />
              </FormField>
              <FormField label="Ambiente" hint="Sala onde está instalado">
                <Input aria-label="Ambiente" value={ambiente} onChange={(e) => setAmbiente(e.target.value)} placeholder="Ex: Sala 201" />
              </FormField>
            </div>
            {erroEtapa && <p className="text-sm text-red-600">{erroEtapa}</p>}
            <button type="button" onClick={confirmarLocal} className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold">
              Continuar <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── 5. Revisão ── */}
        {etapa === "revisao" && (
          <div className="space-y-4" data-revisao>
            <h2 className="font-semibold text-ink">Tudo certo? Revise e salve</h2>
            <dl className="divide-y divide-surface-border text-sm border border-surface-border rounded-lg">
              {[
                ["Tipo", valores.tipo ? rotuloTipo(valores.tipo) : ""],
                ["Marca / modelo", [valores.marca, valores.modelo].filter(Boolean).join(" · ")],
                ["Capacidade", valores.capacidade_valor ? `${valores.capacidade_valor} ${valores.capacidade_unidade}` : ""],
                ["Tensão / fase", [valores.tensao, valores.fase].filter(Boolean).join(" · ")],
                ["Gás", valores.fluido],
                ["Nº de série", valores.numero_serie],
                ["Patrimônio / TAG", valores.tag_patrimonio],
                ["Local", [unidades.find((u) => u.id === unidadeId)?.nome, setor, ambiente].filter(Boolean).join(" › ")],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 px-3 py-2">
                  <dt className="text-ink-muted">{k}</dt><dd className="text-ink font-medium text-right break-all">{v || "—"}</dd>
                </div>
              ))}
            </dl>
            <AvisoSerieDuplicada numero={valores.numero_serie} />
            <div className="flex gap-2 text-xs">
              <button type="button" onClick={() => { setFaltantes(PERGUNTAS.map((p) => p.campo)); setIdxPergunta(0); setEtapa("faltantes"); }} className="inline-flex items-center gap-1 text-primary-600 hover:underline"><Pencil className="w-3 h-3" /> Corrigir dados</button>
              <button type="button" onClick={() => setEtapa("local")} className="inline-flex items-center gap-1 text-primary-600 hover:underline"><Pencil className="w-3 h-3" /> Corrigir local</button>
            </div>
            {(fotoFrente || foto || fotoExtra) && (
              <div data-fotos-revisao>
                <p className="text-xs font-semibold text-ink-muted mb-1.5">Fotos que serão salvas</p>
                <div className="flex gap-2">
                  {([[fotoFrente, "Capa", true], [foto, "Etiqueta (apoio)", false], [fotoExtra, "Outro ângulo", false]] as const).filter(([u]) => !!u).map(([u, rotulo, capa]) => (
                    <figure key={rotulo} className="w-24">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u!} alt={rotulo} className={cn("w-24 h-20 object-cover rounded-lg border", capa ? "border-primary-400 ring-2 ring-primary-200" : "border-surface-border")} />
                      <figcaption className={cn("text-[10px] mt-1 text-center", capa ? "font-semibold text-primary-700" : "text-ink-muted")}>{rotulo}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}
            {erroEtapa && <p className="text-sm text-red-600">{erroEtapa}</p>}
            <button type="button" onClick={salvar} disabled={salvando} className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />} Salvar e gerar QR Code
            </button>
          </div>
        )}

        {/* ── Pronto ── */}
        {etapa === "pronto" && salvo && (
          <div className="text-center space-y-3 py-4" data-pronto>
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <h2 className="text-lg font-semibold text-ink">Equipamento cadastrado!</h2>
            {salvo.qr
              ? <p className="text-sm text-ink-muted">QR Code gerado: <strong className="font-mono text-ink" data-qr>{salvo.qr}</strong></p>
              : <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{salvo.avisoQr ?? "O QR Code não foi gerado. Gere pela ficha do equipamento (botão “Gerar QR”)."}</p>}
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <Link href={`/equipamentos/${salvo.id}?aba=qrcode`} className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-primary-500 hover:bg-primary-600 text-white text-sm font-semibold">
                <QrCode className="w-4 h-4" /> Ver e imprimir o QR Code
              </Link>
              <button type="button" onClick={recomecar} className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-surface-border text-sm text-ink hover:bg-surface-alt">
                <Camera className="w-4 h-4" /> Cadastrar outro
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Espaço de uma foto do cadastro (câmera ou galeria), com rótulo do papel dela. */
function SlotFoto({ id, titulo, selo, seloCor, icone: Icone, dica, obrigatoria, url, rotuloAria, onArquivo, onRemover }: {
  id: string; titulo: string; selo: string; seloCor: string; icone: React.ComponentType<{ className?: string }>; dica: string;
  obrigatoria?: boolean; url: string | null; rotuloAria: string; onArquivo: (f: File | undefined) => void; onRemover: () => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const escolher = (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ""; onArquivo(f); };
  return (
    <div data-slot={id} className={cn("rounded-xl border p-2.5 flex flex-col gap-2", url ? "border-surface-border bg-white" : "border-dashed border-primary-300 bg-primary-50/30")}>
      <div className="flex items-center justify-between gap-1">
        <p className="text-xs font-semibold text-ink truncate">{titulo}{obrigatoria && <span className="text-red-500"> *</span>}</p>
        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0", seloCor)}>{selo}</span>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={escolher} aria-label={`${rotuloAria} (câmera)`} />
      <input ref={galeria} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={escolher} aria-label={`${rotuloAria} (arquivo)`} />
      {url ? (
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={titulo} className="w-full h-32 object-cover rounded-lg bg-surface-alt" />
          <button type="button" onClick={onRemover} title="Remover foto" className="absolute top-1.5 right-1.5 bg-black/55 hover:bg-red-600 text-white rounded-full p-1"><X className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={() => camera.current?.click()} className="mt-1.5 w-full inline-flex items-center justify-center gap-1 text-xs text-ink-muted hover:text-ink"><RotateCcw className="w-3 h-3" /> Trocar</button>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => camera.current?.click()} className="h-28 rounded-lg flex flex-col items-center justify-center gap-1 text-primary-700 hover:bg-primary-50">
            <Icone className="w-7 h-7" />
            <span className="text-xs font-semibold">Fotografar</span>
            <span className="text-[10px] text-primary-600/80 text-center px-1">{dica}</span>
          </button>
          <button type="button" onClick={() => galeria.current?.click()} className="inline-flex items-center justify-center gap-1 text-[11px] text-ink-muted hover:text-ink">
            <ImagePlus className="w-3 h-3" /> da galeria
          </button>
        </>
      )}
    </div>
  );
}
