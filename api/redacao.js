export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    req.headers["access-control-request-headers"] ||
      "Content-Type, request-id, x-request-id"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { pageText, complemento, title: pageTitle, url } = req.body || {};

    if (!pageText || typeof pageText !== "string") {
      return res.status(400).json({ error: "pageText é obrigatório" });
    }

    const prompt = `
Responda em português do Brasil.

Você é um gerador de redação.
Use apenas o conteúdo enviado.

Tarefa:
- Gere um título curto e bom
- Depois escreva uma redação completa, clara, natural e bem estruturada
- Não explique o processo
- Não use markdown
- Entregue só o conteúdo final
- Não cite Nenhuma fonte na redação

Instrução extra:
${complemento || "nenhuma"}

Título da página:
${pageTitle || "não informado"}

URL:
${url || "não informada"}

Conteúdo da página:
${pageText}

Responda APENAS em JSON válido neste formato:
{
  "title": "Título aqui",
  "essay": "Redação aqui"
}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }]
            }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: data?.error?.message || "Erro na Gemini API",
        details: data
      });
    }

    const raw =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

    if (!raw) {
      return res.status(500).json({
        error: "A Gemini não devolveu texto"
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const cleaned = raw
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
  } catch (err) {
    return res.status(500).json({
      error: err?.message || "Erro interno"
    });
  }
}
