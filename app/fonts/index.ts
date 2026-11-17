import localFont from "next/font/local";

/**
 * AS FONTES DO SISTEMA, servidas de dentro do projeto.
 *
 * Antes vinham de `next/font/google`, que baixa os arquivos do Google Fonts DURANTE o build. Quando
 * essa busca falhava (rede intermitente), o build inteiro caía com "An error occurred in next/font"
 * — sem nada de errado no código. Agora os arquivos (.woff2) estão em app/fonts e o build não
 * depende de rede nenhuma.
 *
 * São os MESMOS arquivos que o Google servia para a Inter (variável, todos os pesos) e o Archivo
 * (600 e 700): mesma fonte, mesma aparência. Aqui ficam as faces do LATIM, que cobrem o português e
 * são as únicas pré-carregadas; os outros subconjuntos (latim estendido, grego, cirílico,
 * vietnamita) estão em ./subconjuntos.css e só são baixados quando a página usa um caractere deles.
 *
 * Para trocar ou atualizar uma fonte: substituir o .woff2 em app/fonts (e conferir o intervalo em
 * `unicode-range`). Licença das duas: SIL Open Font License 1.1 (OFL-inter.txt e OFL-archivo.txt).
 */

// Inter (400/500/600) no corpo e nos dados. Segue variável (todos os pesos): telas ainda não
// restilizadas usam 700, e sem ele o navegador sintetizaria o negrito.
export const inter = localFont({
  src: "./inter-latim.woff2",
  weight: "100 900",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
  // A fonte de reserva (Arial ajustada, mostrada enquanto a Inter carrega) está em ./subconjuntos.css
  // com as mesmas medidas de antes; a automática do next/font/local sairia com medidas diferentes.
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
});

// Archivo (600/700) em títulos e números. É um arquivo só (variável); as duas faces dizem ao
// navegador quais pesos existem — pedir 500 dá 600, pedir 800 dá 700, como antes.
export const archivo = localFont({
  src: [
    { path: "./archivo-latim.woff2", weight: "600", style: "normal" },
    { path: "./archivo-latim.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-archivo",
  display: "swap",
  adjustFontFallback: false,
  declarations: [
    { prop: "font-stretch", value: "100%" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
});
