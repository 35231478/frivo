/**
 * Baixar um arquivo pelo navegador com `fetch` (e não por um link direto): quando a rota recusa (sessão vencida, sem
 * permissão, arquivo que não existe, erro ao gerar), a pessoa vê a RAZÃO na tela em vez de um "download falhou" do
 * navegador ou de uma página com um JSON de erro. O nome vem do Content-Disposition da resposta.
 */
export async function baixarArquivo(url: string, nomePadrao: string, erroPadrao = "Não foi possível baixar o arquivo."):
  Promise<{ ok: true } | { ok: false; erro: string }> {
  try {
    const r = await fetch(url);
    if (!r.ok) {
      // A rota responde { erro } (JSON) ou um texto curto; uma página HTML de erro não vira mensagem
      const corpo = await r.text().catch(() => "");
      let erro: string | undefined;
      try { erro = JSON.parse(corpo)?.erro; } catch { erro = corpo.trim().startsWith("<") ? undefined : corpo.slice(0, 200); }
      return { ok: false, erro: (r.status === 401 ? "Sessão encerrada. Entre de novo para baixar." : erro) || erroPadrao };
    }
    const blob = await r.blob();
    const cabecalho = r.headers.get("content-disposition") ?? "";
    const utf8 = /filename\*=UTF-8''([^;]+)/.exec(cabecalho)?.[1];
    const nome = utf8 ? decodeURIComponent(utf8) : /filename="([^"]+)"/.exec(cabecalho)?.[1] ?? nomePadrao;
    const href = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href, download: nome });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
    return { ok: true };
  } catch {
    return { ok: false, erro: "Erro de conexão. Tente de novo." };
  }
}
