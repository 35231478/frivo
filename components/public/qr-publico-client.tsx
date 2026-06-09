"use client";

import { useState } from "react";
import { MessageCircle, Globe, ClipboardList, FileText, Wrench, CalendarClock, MapPin, CheckCircle2, X } from "lucide-react";

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
  proxima: { data: string; tipo: string } | null;
  botoes: { whatsapp: string | null; site: string | null; chamado: Botao; orcamento: Botao };
};

export function QrPublicoClient({ dados }: { dados: Dados }) {
  const [form, setForm] = useState<"CHAMADO" | "ORCAMENTO" | null>(null);

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

        {/* Formulário inline */}
        {form && (
          <FormularioSolicitacao
            tipo={form}
            token={dados.token}
            onFechar={() => setForm(null)}
          />
        )}

        {/* Botões de ação */}
        <div className="space-y-2.5 pt-1">
          {dados.botoes.whatsapp && (
            <a href={dados.botoes.whatsapp} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full rounded-lg bg-green-500 text-white px-4 py-3 text-sm font-semibold shadow-sm">
              <MessageCircle className="w-4 h-4" /> Falar conosco
            </a>
          )}
          {dados.botoes.chamado && (
            dados.botoes.chamado === "login" ? (
              <a href="/portal/login" className="flex items-center justify-center gap-2 w-full rounded-lg bg-primary-500 text-white px-4 py-3 text-sm font-semibold shadow-sm">
                <ClipboardList className="w-4 h-4" /> Abrir chamado (entrar)
              </a>
            ) : (
              <button onClick={() => setForm(form === "CHAMADO" ? null : "CHAMADO")} className="flex items-center justify-center gap-2 w-full rounded-lg bg-primary-500 text-white px-4 py-3 text-sm font-semibold shadow-sm">
                <ClipboardList className="w-4 h-4" /> Abrir chamado
              </button>
            )
          )}
          {dados.botoes.orcamento && (
            dados.botoes.orcamento === "login" ? (
              <a href="/portal/login" className="flex items-center justify-center gap-2 w-full rounded-lg bg-white border border-primary-500 text-primary-600 px-4 py-3 text-sm font-semibold">
                <FileText className="w-4 h-4" /> Solicitar orçamento (entrar)
              </a>
            ) : (
              <button onClick={() => setForm(form === "ORCAMENTO" ? null : "ORCAMENTO")} className="flex items-center justify-center gap-2 w-full rounded-lg bg-white border border-primary-500 text-primary-600 px-4 py-3 text-sm font-semibold">
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

function FormularioSolicitacao({ tipo, token, onFechar }: { tipo: "CHAMADO" | "ORCAMENTO"; token: string; onFechar: () => void }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [descricao, setDescricao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState<string | null>(null);

  const titulo = tipo === "ORCAMENTO" ? "Solicitar orçamento" : "Abrir chamado";

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro(""); setEnviando(true);
    try {
      const res = await fetch(`/api/qr/${token}/chamado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, nome, email, telefone, descricao }),
      });
      const d = await res.json();
      if (!res.ok) { setErro(d.erro ?? "Erro ao enviar."); return; }
      setOk(d.chamadoNumero ?? "");
    } catch { setErro("Erro de conexão."); } finally { setEnviando(false); }
  }

  if (ok !== null) {
    return (
      <section className="bg-white rounded-xl border border-green-200 shadow-sm p-5 text-center">
        <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
        <p className="font-semibold text-ink">Solicitação enviada!</p>
        {ok && <p className="text-sm text-ink-muted mt-1">Protocolo: <span className="font-mono">{ok}</span></p>}
        <button onClick={onFechar} className="text-sm text-primary-600 hover:underline mt-3">Fechar</button>
      </section>
    );
  }

  const inputCls = "w-full bg-white border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10";

  return (
    <section className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-ink">{titulo}</h2>
        <button onClick={onFechar} className="text-ink-muted hover:text-ink"><X className="w-5 h-5" /></button>
      </div>
      {erro && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{erro}</div>}
      <form onSubmit={enviar} className="space-y-2.5">
        <input className={inputCls} placeholder="Seu nome *" value={nome} onChange={(e) => setNome(e.target.value)} required />
        <input className={inputCls} type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={inputCls} placeholder="Telefone / WhatsApp" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        <textarea className={inputCls} rows={3} placeholder={tipo === "ORCAMENTO" ? "O que você precisa orçar? *" : "Descreva o problema *"} value={descricao} onChange={(e) => setDescricao(e.target.value)} required />
        <button type="submit" disabled={enviando} className="w-full rounded-lg bg-primary-500 text-white px-4 py-2.5 text-sm font-semibold disabled:opacity-60">
          {enviando ? "Enviando…" : "Enviar"}
        </button>
      </form>
    </section>
  );
}
