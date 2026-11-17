"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Copy, FolderDown, MailCheck, MailX, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/avisos";
import { formatarData } from "@/lib/utils";
import { fraseEmailNaoSaiu, type Via } from "@/lib/documentacao/pacote";
import { baixarZipDoEnvio } from "@/lib/documentacao/baixar-cliente";
import type { EnvioCriado, EnvioResumo, ResultadoDoLote } from "@/lib/documentacao/pacote-server";

export type Resultado =
  | { tipo: "UM"; via: Via; criado: EnvioCriado; zip?: { ok: boolean; erro?: string } }
  | { tipo: "LOTE"; via: Via; lote: ResultadoDoLote; nomes: Record<string, string>; deFora: { clienteNome: string; motivo: string }[] };

const linkDo = (caminho: string) => `${typeof window === "undefined" ? "" : window.location.origin}${caminho}`;

async function copiar(texto: string) {
  try { await navigator.clipboard.writeText(texto); toast("Link copiado."); }
  catch { toast("Não foi possível copiar. Selecione o link e copie.", "erro"); }
}

/** O link do envio, pronto para copiar, com o prazo ao lado. */
function CaixaDoLink({ envio }: { envio: EnvioResumo }) {
  if (!envio.caminho) return null;
  const link = linkDo(envio.caminho);
  return (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center" data-link-do-envio>
      <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label={`Link de ${envio.clienteNome}`} className="flex-1 min-w-0 text-sm bg-surface-alt border border-surface-border rounded-lg px-3 py-2 text-ink" data-link-valor />
      <Button type="button" variant="secondary" size="sm" onClick={() => void copiar(link)} data-copiar-link><Copy className="w-4 h-4" /> Copiar</Button>
      {envio.expiraEm && <span className="text-xs text-ink-muted shrink-0" data-link-validade>Vale até {formatarData(envio.expiraEm)}</span>}
    </div>
  );
}

/** O que aconteceu com o e-mail: saiu para quem, ou por que não saiu — nunca um "enviado" de fachada. */
function LinhaDoEmail({ email }: { email: EnvioCriado["email"] }) {
  if (!email) return null;
  return email.ok ? (
    <p className="text-sm text-ok-texto flex items-start gap-1.5" data-email-resultado="ok">
      <MailCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> E-mail enviado para {[...email.para, ...email.cc].join(", ")}.
    </p>
  ) : (
    <p role="alert" className="text-sm text-atrasado-texto flex items-start gap-1.5" data-email-resultado="falhou">
      <MailX className="w-4 h-4 shrink-0 mt-0.5" aria-hidden /> {fraseEmailNaoSaiu(email.erro)} O link acima vale e pode ser mandado por outro meio.
    </p>
  );
}

/**
 * O RESULTADO do envio. Um cliente: o link para copiar, o que houve com o e-mail e o zip. Lote: a
 * mesma coisa cliente a cliente — o que saiu, o que o servidor recusou (com a razão) e o que ficou
 * de fora antes mesmo de enviar.
 */
export function ResultadoEnvio({ resultado }: { resultado: Resultado }) {
  const [baixando, setBaixando] = useState(false);

  async function baixar(envioId: string) {
    setBaixando(true);
    const r = await baixarZipDoEnvio(envioId);
    setBaixando(false);
    if (!r.ok) toast(r.erro, "erro");
  }

  const rodape = (
    <div className="flex flex-col sm:flex-row gap-2 sm:justify-end border-t border-surface-linha pt-4">
      <Link href="/documentacao-equipe" className="btn-secondary justify-center" data-ir-historico>Ver o histórico</Link>
      <a href="/documentacao-equipe/novo" className="btn-primary justify-center" data-outro-envio>Novo envio</a>
    </div>
  );

  if (resultado.tipo === "UM") {
    const { envio, email } = resultado.criado;
    return (
      <div className="bg-white rounded-card shadow-card border border-surface-border p-4 sm:p-6 space-y-4" data-resultado-envio="UM" data-envio-criado={envio.id}>
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-6 h-6 text-ok shrink-0" aria-hidden />
          <div>
            <h2 className="text-base font-semibold text-ink">Pacote de {envio.clienteNome} gerado</h2>
            <p className="text-sm text-ink-muted" data-resultado-resumo>
              {envio.arquivos} {envio.arquivos === 1 ? "arquivo" : "arquivos"} de {envio.colaboradores} {envio.colaboradores === 1 ? "colaborador" : "colaboradores"}. O envio está no histórico.
            </p>
          </div>
        </div>
        <CaixaDoLink envio={envio} />
        <LinhaDoEmail email={email} />
        {resultado.zip && !resultado.zip.ok && (
          <p role="alert" className="text-sm text-atrasado-texto" data-zip-falhou>O zip não baixou: {resultado.zip.erro}</p>
        )}
        <div>
          <Button type="button" variant="outline" size="sm" loading={baixando} onClick={() => void baixar(envio.id)} data-baixar-zip>
            <FolderDown className="w-4 h-4" /> {resultado.via === "ZIP" ? "Baixar o zip de novo" : "Baixar o zip"}
          </Button>
        </div>
        {rodape}
      </div>
    );
  }

  const { lote, nomes, deFora } = resultado;
  const sairam = lote.resultados.filter((r) => r.ok).length;
  return (
    <div className="bg-white rounded-card shadow-card border border-surface-border p-4 sm:p-6 space-y-4" data-resultado-envio="LOTE">
      <div>
        <h2 className="text-base font-semibold text-ink" data-resultado-resumo>
          {sairam} de {lote.resultados.length + deFora.length} {lote.resultados.length + deFora.length === 1 ? "cliente recebeu" : "clientes receberam"} o pacote
        </h2>
        <p className="text-sm text-ink-muted">Cada cliente tem o próprio link. Os envios estão no histórico.</p>
      </div>
      <ul className="border border-surface-border rounded-lg divide-y divide-surface-linha">
        {lote.resultados.map((r) => (
          <li key={r.clienteId} className="px-3 py-3 space-y-2" data-resultado-cliente={r.clienteId} data-ok={r.ok ? "sim" : "nao"}>
            <p className="text-sm font-medium text-ink flex items-center gap-1.5">
              {r.ok ? <CheckCircle2 className="w-4 h-4 text-ok shrink-0" aria-hidden /> : <XCircle className="w-4 h-4 text-atrasado shrink-0" aria-hidden />}
              {r.ok ? r.envio.clienteNome : nomes[r.clienteId] ?? "Cliente"}
            </p>
            {r.ok ? (
              <>
                <CaixaDoLink envio={r.envio} />
                <LinhaDoEmail email={r.email} />
              </>
            ) : (
              <p className="text-sm text-atrasado-texto" data-resultado-erro>Não saiu: {r.erro}</p>
            )}
          </li>
        ))}
        {deFora.map((d) => (
          <li key={d.clienteNome} className="px-3 py-3" data-resultado-de-fora>
            <p className="text-sm font-medium text-ink flex items-center gap-1.5"><XCircle className="w-4 h-4 text-ink-subtle shrink-0" aria-hidden /> {d.clienteNome}</p>
            <p className="text-sm text-ink-muted">Ficou de fora: {d.motivo.toLowerCase()}.</p>
          </li>
        ))}
      </ul>
      {rodape}
    </div>
  );
}
