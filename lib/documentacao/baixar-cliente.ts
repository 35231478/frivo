/**
 * Baixa o zip do pacote pelo navegador. É `fetch` e não um link direto de propósito: quando a rota
 * recusa (o pacote tem documento que venceu depois do envio), a pessoa vê a RAZÃO na tela em vez
 * de ser levada para uma página com um JSON de erro.
 */
export async function baixarZipDoEnvio(envioId: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const r = await fetch(`/api/documentacao/envios/${envioId}/zip`);
    if (!r.ok) return { ok: false, erro: (await r.json().catch(() => ({})))?.erro ?? "Não foi possível baixar o pacote." };
    const blob = await r.blob();
    const cabecalho = r.headers.get("content-disposition") ?? "";
    const utf8 = /filename\*=UTF-8''([^;]+)/.exec(cabecalho)?.[1];
    const nome = utf8 ? decodeURIComponent(utf8) : /filename="([^"]+)"/.exec(cabecalho)?.[1] ?? "documentacao.zip";
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: nome });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true };
  } catch {
    return { ok: false, erro: "Erro de conexão. Tente de novo." };
  }
}
