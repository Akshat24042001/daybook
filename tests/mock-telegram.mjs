// A stand-in for api.telegram.org (and Deepgram) that behaves like the real services where it matters:
//  - callback_data limited to 64 bytes, URL buttons must be https, text limited to 4096 chars
//  - editing a message to identical content fails with "message is not modified"
//  - getFile + file download for voice notes, and Deepgram's /v1/listen returning a scripted transcript
// Imported by the automated tests only.
import http from "node:http";

export function startMockTelegram(port = 0) {
  const calls = []; // every API call, in order
  const messages = new Map(); // `${chat}:${id}` -> current state of that message
  const deepgram = { calls: [], transcript: "hello world", status: 200 };
  let nextId = 100;

  const fail = (res, code, description) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error_code: code, description }));
  };

  const checkMarkup = (markup) => {
    for (const row of markup?.inline_keyboard ?? []) {
      for (const b of row) {
        if (b.callback_data !== undefined && Buffer.byteLength(b.callback_data) > 64) return `BUTTON_DATA_INVALID: ${b.callback_data}`;
        if (b.url !== undefined && !/^https:\/\//.test(b.url)) return "wrong HTTP URL";
        if (b.callback_data === undefined && b.url === undefined) return "button must have callback_data or url";
      }
    }
    return null;
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const url = req.url ?? "";

      if (url === "/__calls") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(calls));
      }
      if (url === "/__reset") {
        calls.length = 0;
        messages.clear();
        deepgram.calls.length = 0;
        res.writeHead(200);
        return res.end("ok");
      }
      if (url === "/__transcript") {
        deepgram.transcript = raw.toString("utf8");
        res.writeHead(200);
        return res.end("ok");
      }

      // ---- Deepgram
      if (req.method === "POST" && url.startsWith("/v1/listen")) {
        deepgram.calls.push({ url, auth: req.headers.authorization, contentType: req.headers["content-type"], bytes: raw.length });
        if (deepgram.status !== 200) {
          res.writeHead(deepgram.status, { "content-type": "application/json" });
          return res.end(JSON.stringify({ err_code: "X", err_msg: "nope" }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: deepgram.transcript }] }] } }));
      }

      // ---- Telegram file download
      if (req.method === "GET" && /^\/file\/bot[^/]+\/voice\//.test(url)) {
        res.writeHead(200, { "content-type": "audio/ogg" });
        return res.end(Buffer.alloc(4096, 1));
      }

      const m = /^\/bot([^/]+)\/(\w+)$/.exec(url);
      if (!m) return fail(res, 404, "Not Found");
      const method = m[2];
      const p = raw.length ? JSON.parse(raw.toString("utf8")) : {};
      const call = { method, ...p };
      calls.push(call);

      const err = checkMarkup(p.reply_markup);
      if (err) return fail(res, 400, `Bad Request: ${err}`);
      if (typeof p.text === "string" && p.text.length > 4096) return fail(res, 400, "Bad Request: message is too long");

      const ok = (result) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, result }));
      };
      const key = (chat, id) => `${chat}:${id}`;

      switch (method) {
        case "sendMessage": {
          const id = nextId++;
          call.message_id = id;
          messages.set(key(p.chat_id, id), { chat_id: p.chat_id, message_id: id, text: p.text, reply_markup: p.reply_markup });
          return ok({ message_id: id, chat: { id: p.chat_id } });
        }
        case "editMessageText": {
          const k = key(p.chat_id, p.message_id);
          const cur = messages.get(k);
          if (!cur) return fail(res, 400, "Bad Request: message to edit not found");
          const same = cur.text === p.text && JSON.stringify(cur.reply_markup ?? { inline_keyboard: [] }) === JSON.stringify(p.reply_markup ?? { inline_keyboard: [] });
          if (same) return fail(res, 400, "Bad Request: message is not modified");
          messages.set(k, { ...cur, text: p.text, reply_markup: p.reply_markup });
          return ok({ message_id: p.message_id });
        }
        case "editMessageReplyMarkup": {
          const k = key(p.chat_id, p.message_id);
          const cur = messages.get(k);
          if (!cur) return fail(res, 400, "Bad Request: message to edit not found");
          if (JSON.stringify(cur.reply_markup) === JSON.stringify(p.reply_markup)) return fail(res, 400, "Bad Request: message is not modified");
          messages.set(k, { ...cur, reply_markup: p.reply_markup });
          return ok({ message_id: p.message_id });
        }
        case "getFile":
          return ok({ file_id: p.file_id, file_path: "voice/file_1.oga" });
        case "answerCallbackQuery":
        case "setWebhook":
          return ok(true);
        default:
          return ok(true);
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const actualPort = server.address().port;
      resolve({
        url: `http://127.0.0.1:${actualPort}`,
        calls,
        messages,
        deepgram,
        reset: () => {
          calls.length = 0;
          messages.clear();
          deepgram.calls.length = 0;
          deepgram.status = 200;
        },
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

