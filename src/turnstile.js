export const TURNSTILE_SITE_KEY =
  import.meta.env?.VITE_TURNSTILE_SITE_KEY || "0x4AAAAAADp0Se6vGHnBig59";

export const TURNSTILE_VERIFY_URL =
  import.meta.env?.VITE_TURNSTILE_VERIFY_URL ||
  "https://turnstile-siteverify-bolao-copa2026.guilherme-saraiva.workers.dev";

export function getTurnstileToken(payload = {}, currentToken = "") {
  return String(currentToken || payload["cf-turnstile-response"] || "").trim();
}

export async function verifyTurnstileToken(token, fetchImpl = fetch) {
  if (!token) {
    return { success: false, message: "Conclua a verificação de segurança." };
  }

  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    const result = await response.json();

    return {
      ...result,
      success: response.ok && result.success === true,
      message: result.success === true
        ? ""
        : "Não foi possível confirmar a verificação. Tente novamente."
    };
  } catch {
    return {
      success: false,
      message: "A verificação de segurança está indisponível. Tente novamente."
    };
  }
}
