export default async function handler(req, res) {
  // CORS (IMPORTANTE)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { pageText, complemento } = req.body || {};

    if (!pageText) {
      return res.status(400).json({ error: "Sem texto da página" });
    }

    const prompt = `
Responda em português.

Crie uma redação completa, clara e bem estruturada com base no conteúdo abaixo.

${complemento ? "Instrução extra: " + complemento : ""}

IMPORTANTE:
- Gere um título
- Depois escreva a redação
- NÃO explique nada

Conteúdo:
${pageText}
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
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: data?.error?.message || "Erro Gemini"
      });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!text) {
      return res.status(500).json({ error: "Sem resposta da IA" });
    }

    // separa título e redação (simples)
    const linhas = text.split("\n").filter(l => l.trim());
    const title = linhas[0] || "Redação";
    const essay = linhas.slice(1).join("\n");

    return res.status(200).json({
      title,
      essay
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message || "Erro interno"
    });
  }
}
