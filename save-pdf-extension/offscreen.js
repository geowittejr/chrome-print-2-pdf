// Offscreen document: turns base64 PDF bytes into a Blob URL, and revokes it later.

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") return false;

  if (message.type === "make-blob-url") {
    try {
      const binary = atob(message.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      sendResponse({ url });
    } catch (err) {
      sendResponse({ error: `Couldn't decode the PDF: ${err?.message ?? err}` });
    }
    return false;
  }

  if (message.type === "revoke-blob-url") {
    URL.revokeObjectURL(message.url);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
