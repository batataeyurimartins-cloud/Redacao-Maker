export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { pageText, complemento, url, title: pageTitle } = req.body || {};

    if (!pageText || typeof pageText !== "string") {
      return res.status(400).json({ error: "Sem texto da página" });
    }

    const prompt = `
Você é um especialista em redações.

Com base no conteúdo abaixo, escreva uma redação completa, natural, clara e bem estruturada.

${complemento ? `Instrução extra do usuário: ${complemento}` : ""}

Informações da página:
- Título da página: ${pageTitle || "Não informado"}
- URL: ${url || "Não informada"}

Conteúdo da página:
${pageText}

Regras:
- Gere um título curto e bom
- Entregue uma redação coesa
- Linguagem natural
- Não use marcadores
- Não explique o processo
- Responda em JSON válido com as chaves "title" e "essay"
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Erro na Gemini API",
        details: data
      });
    }

    const rawText =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";

    if (!rawText) {
      return res.status(500).json({ error: "A Gemini não devolveu texto" });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = {
        title: "Redação",
        essay: rawText
      };
    }

    return res.status(200).json({
      title: parsed.title || "Redação",
      essay: parsed.essay || rawText
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Erro interno no servidor",
      details: String(error?.message || error)
    });
  }
}
