// Page chat widget — zero-dependency, same-origin WebSocket to /api/chat.
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
  var status = document.getElementById("chat-status");

  function setStatus(text) {
    status.textContent = text;
  }

  // Persona picker: the choice rides along with each message frame and is
  // remembered in localStorage; the server falls back to the default voice
  // for anything it doesn't recognize.
  var persona = "default";
  try {
    persona = localStorage.getItem("page_persona") || "default";
  } catch {
    // storage can be unavailable (private mode); the default voice is fine
  }
  var picker = document.getElementById("persona-picker");
  if (picker) {
    var options = picker.querySelectorAll("input[name='persona']");
    var select = function (id) {
      var known = false;
      for (var i = 0; i < options.length; i++) {
        if (options[i].getAttribute("data-persona") === id) known = true;
      }
      persona = known ? id : "default";
      try {
        localStorage.setItem("page_persona", persona);
      } catch {}
      for (var i = 0; i < options.length; i++) {
        options[i].checked = options[i].getAttribute("data-persona") === persona;
      }
    };
    for (var i = 0; i < options.length; i++) {
      (function (option) {
        option.addEventListener("change", function () {
          if (option.checked) select(option.getAttribute("data-persona"));
        });
      })(options[i]);
    }
    select(persona);
  }

  // Runs before the socket connects: the worker has no server-side mint, so
  // the client mints the session UUID itself. The worker resumes any valid
  // UUID cookie; anything else gets an ephemeral session.
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
    panel.appendChild(document.createTextNode(". "));
    var reload = document.createElement("button");
    reload.type = "button";
    reload.className = "chat-reconnect";
    reload.textContent = "Reload to reconnect";
    reload.addEventListener("click", function () {
      location.reload();
    });
    panel.appendChild(reload);
    widget.appendChild(panel);
  }

  ensureSession();

  var url = new URL("/api/chat", location.origin);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";

  var socket;
  var pending = null;
  var failed = false;

  input.disabled = true;
  send.disabled = true;
  setStatus("Connecting to Page…");
  try {
    socket = new WebSocket(url);
  } catch {
    fail();
    return;
  }
  socket.addEventListener("open", function () {
    if (failed) return;
    input.disabled = false;
    send.disabled = false;
    setStatus("Ready. Ask about Paul’s experience, projects, or talks.");
  });

  socket.addEventListener("message", function (event) {
    if (failed) return;
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
      send.disabled = false;
      setStatus("Ready for your next question.");
    }
  });

  function fail(notSent) {
    if (failed) return;
    failed = true;
    if (pending) {
      pending.classList.remove("pending");
      pending.textContent += notSent === true ? " (not sent)" : " (delivery unconfirmed)";
      pending = null;
      setStatus(notSent === true
        ? "Your message was not sent. Reload to reconnect."
        : "Connection lost. Your last message may have arrived. Reload to check the conversation before sending again.");
    } else {
      setStatus("Chat is offline. Reload to reconnect, or use the links below.");
    }
    showFallback();
  }

  socket.addEventListener("error", function () {
    fail();
  });
  socket.addEventListener("close", function () {
    fail();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var text = input.value.trim();
    if (!text || failed || pending) return;
    if (socket.readyState !== WebSocket.OPEN) {
      fail();
      return;
    }
    pending = addMessage("user", text, true);
    try {
      socket.send(
        JSON.stringify({ type: "message", "text": text, persona: persona }),
      );
    } catch {
      fail(true);
      return;
    }
    send.disabled = true;
    setStatus("Page is replying…");
    input.value = "";
    input.focus();
  });
})();
