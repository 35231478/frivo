"use client";

import { useState } from "react";
import { MessageCircle, Globe, ClipboardList, FileText, Wrench, CalendarClock, MapPin, CheckCircle2, Copy, Upload, X } from "lucide-react";
import { reduzirImagem, FOTO_GALERIA } from "@/lib/imagem-cliente";

type Botao = "login" | "form" | null;
type Dados = {
  token: string;
  empresaNome: string;
  logo: string | null;
  boasVindas: string;
  cor: string;
  equipamento: { nome: string; tipo: string; marca: string; modelo: string; numeroSerie: string | null } | null;
  localizacao: { unidade: string | null; local: string | null } | null;
  historico: { id: string; numero: string; data: string; tipo: string; tecnico: string | null; status: { label: string; cor: string } }[];
  historicoOculto: boolean;
  /** Atalho para o histórico completo no sistema (só para a equipe interna logada). */
  linkEquipe?: string | null;
  proxima: { data: string; tipo: string } | null;
  botoes: { whatsapp: string | null; site: string | null; chamado: Botao; orcamento: Botao };
};

export function QrPublicoClient({ dados }: { dados: Dados }) {
  // O formulário fica MONTADO depois da primeira abertura: fechar ou alternar o tipo
  // não descarta o que a pessoa já digitou (Y14 — rascunho preservado).
  const [tipoForm, setTipoForm] = useState<"CHAMADO" | "ORCAMENTO" | null>(null);
  const [aberto, setAberto] = useState(false);
  const form = aberto ? tipoForm : null;
  const setForm = (t: "CHAMADO" | "ORCAMENTO" | null) => {
    if (t === null) { setAberto(false); return; }
    setTipoForm(t);
    setAberto(true);
  };

  return (
    <div className="min-h-screen bg-surface-page">
      {/* Cabeçalho */}
      <header className="text-white px-5 pt-8 pb-10" style={{ background: "linear-gradient(135deg, #0F2744 0%, " + dados.cor + " 140%)" }}>
        <div className="max-w-md mx-auto text-center">
          {dados.logo ? (
            <img src={dados.logo} alt={dados.empresaNome} className="h-14 mx-auto object-contain mb-3 bg-white/95 rounded-lg p-1.5" />
          ) : (
            <h1 className="text-2xl font-bold">{dados.empresaNome}</h1>
          )}
          {dados.logo && <p className="font-semibold text-white/90">{dados.empresaNome}</p>}
          {dados.boasVindas && <p className="text-sm text-white/80 mt-2">{dados.boasVindas}</p>}
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 -mt-6 pb-10 space-y-4">
        {/* Dados do equipamento */}
        {dados.equipamento && (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3 text-ink">
              <Wrench className="w-4 h-4 text-primary-600" />
              <h2 className="font-semibold">{dados.equipamento.nome}</h2>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Info termo="Tipo" valor={dados.equipamento.tipo} />
              <Info termo="Marca" valor={dados.equipamento.marca} />
              <Info termo="Modelo" valor={dados.equipamento.modelo} />
              {dados.equipamento.numeroSerie && <Info termo="Nº de série" valor={dados.equipamento.numeroSerie} />}
            </dl>
          </section>
        )}

        {/* Localização */}
        {dados.localizacao && (dados.localizacao.unidade || dados.localizacao.local) && (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2 text-ink">
              <MapPin className="w-4 h-4 text-primary-600" />
              <h2 className="font-semibold">Localização</h2>
            </div>
            <p className="text-sm text-ink-muted">
              {[dados.localizacao.unidade, dados.localizacao.local].filter(Boolean).join(" · ")}
            </p>
          </section>
        )}

        {/* Próxima manutenção */}
        {dados.proxima && (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2 text-ink">
              <CalendarClock className="w-4 h-4 text-primary-600" />
              <h2 className="font-semibold">Próxima manutenção</h2>
            </div>
            <p className="text-sm text-ink">{dados.proxima.data}</p>
            <p className="text-xs text-ink-muted">{dados.proxima.tipo}</p>
          </section>
        )}

        {/* Histórico */}
        {dados.historico.length > 0 && (
          <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3 text-ink">
              <ClipboardList className="w-4 h-4 text-primary-600" />
              <h2 className="font-semibold">Histórico de manutenções</h2>
            </div>
            <ul className="space-y-3">
              {dados.historico.map((h) => (
                <li key={h.id} className="flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: h.status.cor }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-ink truncate">{h.tipo}</p>
                      <span className="text-xs text-ink-muted shrink-0">{h.data}</span>
                    </div>
                    {h.tecnico && <p className="text-xs text-ink-muted">Técnico: {h.tecnico}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        {dados.historicoOculto && (
          <p className="text-center text-xs text-ink-muted">O histórico completo está disponível para clientes logados no portal.</p>
        )}
        {dados.linkEquipe && (
          <a href={dados.linkEquipe} className="flex items-center justify-center gap-2 w-full rounded-lg border border-primary-200 bg-primary-50 text-primary-700 px-4 py-3 text-sm font-semibold">
            <ClipboardList className="w-4 h-4" /> Histórico completo no sistema (equipe)
          </a>
        )}

        {/* Formulário inline — montado de vez após a primeira abertura (rascunho preservado) */}
        {tipoForm && (
          <div hidden={!aberto}>
            <FormularioSolicitacao tipo={tipoForm} token={dados.token} onFechar={() => setForm(null)} />
          </div>
        )}

        {/* Botões de ação */}
        <div className="space-y-2.5 pt-1">
          {dados.botoes.whatsapp && (
            <a href={dados.botoes.whatsapp} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full rounded-lg bg-green-500 text-white px-4 py-3 text-sm font-semibold shadow-sm">
              <MessageCircle className="w-4 h-4" /> Falar conosco
            </a>
          )}
          {/* Y14: com o formulário aberto, some o botão do tipo ativo — fica UM chamado à ação
              (o Enviar do próprio formulário); o outro botão só troca o tipo, sem perder o texto. */}
          {dados.botoes.chamado && form !== "CHAMADO" && (
            dados.botoes.chamado === "login" ? (
              <a href="/portal/login" className="flex items-center justify-center gap-2 w-full rounded-lg bg-primary-500 text-white px-4 py-3 text-sm font-semibold shadow-sm">
                <ClipboardList className="w-4 h-4" /> Abrir chamado (entrar)
              </a>
            ) : (
              <button data-abrir-chamado onClick={() => setForm("CHAMADO")} className="flex items-center justify-center gap-2 w-full rounded-lg bg-primary-500 text-white px-4 py-3 text-sm font-semibold shadow-sm">
                <ClipboardList className="w-4 h-4" /> Abrir chamado
              </button>
            )
          )}
          {dados.botoes.orcamento && form !== "ORCAMENTO" && (
            dados.botoes.orcamento === "login" ? (
              <a href="/portal/login" className="flex items-center justify-center gap-2 w-full rounded-lg bg-white border border-primary-500 text-primary-600 px-4 py-3 text-sm font-semibold">
                <FileText className="w-4 h-4" /> Solicitar orçamento (entrar)
              </a>
            ) : (
              <button data-abrir-orcamento onClick={() => setForm("ORCAMENTO")} className="flex items-center justify-center gap-2 w-full rounded-lg bg-white border border-primary-500 text-primary-600 px-4 py-3 text-sm font-semibold">
                <FileText className="w-4 h-4" /> Solicitar orçamento
              </button>
            )
          )}
          {dados.botoes.site && (
            <a href={dados.botoes.site} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full rounded-lg bg-white border border-gray-200 text-ink px-4 py-3 text-sm font-semibold">
              <Globe className="w-4 h-4" /> Nosso site
            </a>
          )}
        </div>

        <p className="text-center text-[11px] text-ink-subtle pt-2">{dados.empresaNome}</p>
      </main>
    </div>
  );
}

function Info({ termo, valor }: { termo: string; valor: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{termo}</dt>
      <dd className="text-ink">{valor}</dd>
    </div>
  );
}

interface FotoQr { nome: string; tipo: string; tamanho: number; conteudo: string }

function FormularioSolicitacao({ tipo, token, onFechar }: { tipo: "CHAMADO" | "ORCAMENTO"; token: string; onFechar: () => void }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [descricao, setDescricao] = useState("");
  const [fotos, setFotos] = useState<FotoQr[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const titulo = tipo === "ORCAMENTO" ? "Solicitar orçamento" : "Abrir chamado";

  // C2: a pessoa está NA FRENTE do problema — mesma compressão do chamado do portal
  async function addFotos(files: FileList | null) {
    if (!files) return;
    setErro("");
    const novas: FotoQr[] = [];
    for (const f of Array.from(files).slice(0, 6)) {
      try {
        const { imagem } = await reduzirImagem(f, FOTO_GALERIA.ladoMax, FOTO_GALERIA.qualidade);
        novas.push({ nome: f.name, tipo: "image/jpeg", tamanho: imagem.bytes, conteudo: imagem.dataUrl });
      } catch {
        setErro(`Não foi possível ler a imagem "${f.name}". Envie fotos JPG, PNG ou WEBP.`);
      }
    }
    setFotos((p) => [...p, ...novas].slice(0, 6));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(""); setEnviando(true);
    try {
      const res = await fetch(`/api/qr/${token}/chamado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, nome, email, telefone, descricao, fotos }),
      });
      const d = await res.json();
      if (!res.ok) { setErro(d.erro ?? "Erro ao enviar."); return; }
      setOk(d.chamadoNumero ?? "");
      // Enviado: o rascunho cumpriu o papel
      setNome(""); setEmail(""); setTelefone(""); setDescricao(""); setFotos([]);
    } catch { setErro("Erro de conexão."); } finally { setEnviando(false); }
  }

  async function copiarProtocolo() {
    if (!ok) return;
    try { await navigator.clipboard.writeText(ok); setCopiado(true); setTimeout(() => setCopiado(false), 2500); }
    catch { /* sem clipboard (http antigo): o protocolo segue visível para anotar */ }
  }

  // Y17: confirmação com protocolo COPIÁVEL e o próximo passo dito com todas as letras
  if (ok !== null) {
    return (
      <section data-confirmacao-qr className="bg-white rounded-xl border border-green-200 shadow-sm p-5 text-center">
        <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
        <p className="font-semibold text-ink">Solicitação enviada!</p>
        {ok && (
          <>
            <p className="text-sm text-ink-muted mt-2">Protocolo</p>
            <p data-protocolo className="font-mono text-lg font-bold text-ink">{ok}</p>
            <button type="button" data-copiar-protocolo onClick={copiarProtocolo} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-primary-500 text-primary-600 px-3 py-1.5 text-sm font-semibold">
              <Copy className="w-3.5 h-3.5" /> {copiado ? "Copiado!" : "Copiar protocolo"}
            </button>
          </>
        )}
        <p className="text-sm text-ink-muted mt-3">
          Guarde o protocolo. Nossa equipe recebe a solicitação e entra em contato pelos dados que você informou.
        </p>
        <button onClick={() => { setOk(null); onFechar(); }} className="text-sm text-primary-600 hover:underline mt-3">Fechar</button>
      </section>
    );
  }

  const inputCls = "mt-1 w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10";
  const labelCls = "block text-sm font-semibold text-ink";

  return (
    <section data-form-qr className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-ink">{titulo}</h2>
        <button onClick={onFechar} aria-label="Fechar formulário" className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
      </div>
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{erro}</div>}
      <form onSubmit={enviar} className="space-y-3">
        <label className={labelCls}>
          Seu nome <span className="text-red-500">*</span>
          <input className={inputCls} placeholder="Como podemos te chamar" value={nome} onChange={(e) => setNome(e.target.value)} required />
        </label>
        <label className={labelCls}>
          E-mail
          <input className={inputCls} type="email" inputMode="email" autoComplete="email" placeholder="voce@empresa.com.br" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className={labelCls}>
          Telefone / WhatsApp
          <input className={inputCls} type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-0000" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </label>
        <label className={labelCls}>
          {tipo === "ORCAMENTO" ? "O que você precisa orçar?" : "Descreva o problema"} <span className="text-red-500">*</span>
          <textarea className={inputCls} rows={3} placeholder={tipo === "ORCAMENTO" ? "Conte o que precisa ser feito" : "O que está acontecendo com o equipamento?"} value={descricao} onChange={(e) => setDescricao(e.target.value)} required />
        </label>
        <div>
          <span className={labelCls}>Fotos (opcional)</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {fotos.map((f, i) => (
              <div key={i} data-foto-qr className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.conteudo} alt={f.nome} className="w-full h-full object-cover" />
                <button type="button" onClick={() => setFotos((p) => p.filter((_, j) => j !== i))} aria-label={`Remover foto ${f.nome}`} className="absolute top-0.5 right-0.5 bg-black/50 text-white rounded-full p-0.5"><X className="w-3 h-3" /></button>
              </div>
            ))}
            {fotos.length < 6 && (
              <label className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-200 flex flex-col items-center justify-center text-ink-subtle cursor-pointer hover:border-primary-300">
                <Upload className="w-5 h-5" />
                <span className="text-[10px]">Adicionar</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFotos(e.target.files)} />
              </label>
            )}
          </div>
        </div>
        <button type="submit" disabled={enviando} className="w-full rounded-lg bg-primary-500 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60">
          {enviando ? "Enviando…" : "Enviar"}
        </button>
      </form>
    </section>
  );
}
