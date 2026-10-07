// Flue chat widget — zero-dependency, same-origin WebSocket to /api/chat.
(function () {
  "use strict";

  var GITHUB_URL = "https://github.com/pgebheim";
  var LINKEDIN_URL = "https://www.linkedin.com/in/pgebheim/";

  var widget = document.getElementById("chat-widget");
  if (!widget) return;
  var log = document.getElementById("chat-log");
  var form = document.getElementById("chat-form");
  var input = document.getElementById("chat-input");
  var send = document.getElementById("chat-send");

  // Runs before the socket connects, so every request from this client
  // already carries a valid JS-minted UUID and the worker's existing-cookie
  // branch always matches; its HttpOnly mint path is for clients that arrive
  // without a readable cookie.
  function ensureSession() {
    if (/(?:^|;\s*)flue_session=/.test(document.cookie)) return;
    var id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0;
            return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
          });
    document.cookie = "flue_session=" + id + "; Path=/; Secure; SameSite=Lax";
  }

  function addMessage(role, text, pending) {
    var p = document.createElement("p");
    p.className = role === "user" ? "from-user" : "from-assistant";
    if (pending) p.className += " pending";
    p.textContent = text;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    return p;
  }

  function showFallback() {
    input.disabled = true;
    send.disabled = true;
    if (widget.querySelector(".chat-fallback")) return;
    var panel = document.createElement("p");
    panel.className = "chat-fallback";
    panel.appendChild(
      document.createTextNode("Chat is offline right now. Find Paul on "),
    );
    var gh = document.createElement("a");
    gh.href = GITHUB_URL;
    gh.textContent = "GitHub";
    panel.appendChild(gh);
    panel.appendChild(document.createTextNode(" or "));
    var li = document.createElement("a");
    li.href = LINKEDIN_URL;
    li.textContent = "LinkedIn";
    panel.appendChild(li);
    panel.appendChild(document.createTextNode("."));
    widget.appendChild(panel);
  }

  ensureSession();

  var url = new URL("/api/chat", location.origin);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";

  var socket;
  try {
    socket = new WebSocket(url);
  } catch {
    showFallback();
    return;
  }

  var pending = null;
  var failed = false;

  input.disabled = true;
  send.disabled = true;
  socket.addEventListener("open", function () {
    input.disabled = false;
    send.disabled = false;
  });

  socket.addEventListener("message", function (event) {
    var frame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return;
    }
    if (frame.type === "history" && typeof frame.text === "string") {
      addMessage(frame.role === "user" ? "user" : "assistant", frame.text);
    } else if (frame.type === "reply" && typeof frame.text === "string") {
      if (pending) {
        pending.classList.remove("pending");
        pending = null;
      }
      addMessage("assistant", frame.text);
    }
  });

  function fail() {
    if (failed) return;
    failed = true;
    if (pending) {
      pending.classList.remove("pending");
      pending.textContent += " (not sent)";
      pending = null;
    }
    showFallback();
  }

  socket.addEventListener("error", fail);
  socket.addEventListener("close", function () {
    fail();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text || failed) return;
    if (socket.readyState !== WebSocket.OPEN) {
      fail();
      return;
    }
    pending = addMessage("user", text, true);
    try {
      socket.send(JSON.stringify({ type: "message", "text": text }));
    } catch {
      fail();
      return;
    }
    input.value = "";
    input.focus();
  });
})();
