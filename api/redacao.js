export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Responde ao preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { pageText, complemento, url, title: pageTitle } = req.body || {};

    if (!pageText || typeof pageText !== "string") {
      return res.status(400).json({ error: "Sem texto da página" });
    }

    const prompt = `
Responda APENAS em JSON válido.
Formato:
{
  "title": "Título aqui",
  "essay": "Redação aqui"
}

Tarefa:
Escreva uma redação completa, natural, clara e bem estruturada com base no conteúdo abaixo.

${complemento ? `Complemento do usuário: ${complemento}` : ""}

Título da página: ${pageTitle || "Não informado"}
URL: ${url || "Não informada"}

Conteúdo:
${pageText}
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
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

    if (!rawText) {
      return res.status(500).json({
        error: "A Gemini não devolveu texto",
        details: data
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      const cleaned = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();

      try {
        parsed = JSON.parse(cleaned);
      } catch {
        parsed = {
          title: "Redação",
          essay: cleaned
        };
      }
    }

    return res.status(200).json({
      title: parsed.title || "Redação",
      essay: parsed.essay || ""
    });
  } catch (error) {
    console.error("ERRO INTERNO:", error);
    return res.status(500).json({
      error: "Erro interno no servidor",
      details: String(error?.message || error)
    });
  }
}
