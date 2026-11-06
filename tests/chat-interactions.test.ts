import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../public/chat.js", import.meta.url), "utf8");

// Test the real client script without a server or AI calls. Browser layout and
// native radio keyboard behavior need separate rendered checks.
class Element {
  children: Element[] = [];
  events: Record<string, (event?: unknown) => void> = {};
  attributes: Record<string, string> = {};
  value = "";
  textContent = "";
  className = "";
  disabled = false;
  checked = false;
  classList = {
    remove: (name: string) => {
      this.className = this.className.split(" ").filter((c) => c !== name).join(" ");
    },
  };
  appendChild(child: Element) { this.children.push(child); return child; }
  addEventListener(name: string, listener: (event?: unknown) => void) { this.events[name] = listener; }
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  getAttribute(name: string) { return this.attributes[name]; }
  querySelector(selector: string): Element | null {
    return this.children.find((c) => selector === "." + c.className) ?? null;
  }
  focus() {}
}

function client(savedPersona: string | null = null, throwOnConnect = false) {
  const elements = Object.fromEntries(
    ["chat-widget", "chat-log", "chat-form", "chat-input", "chat-send", "chat-status", "persona-picker"]
      .map((id) => [id, new Element()]),
  );
  const options = ["default", "vampire", "robot", "salesperson"].map((id) => {
    const option = new Element();
    option.setAttribute("data-persona", id);
    option.value = id;
    return option;
  });
  Object.assign(elements["persona-picker"], { querySelectorAll: () => options });
  let stored = savedPersona;
  let reloads = 0;
  let socket!: Socket;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent: { text: string; persona: string }[] = [];
    events: Record<string, (event?: unknown) => void> = {};
    throwsOnSend = false;
    constructor() { if (throwOnConnect) throw new Error("offline"); socket = this; }
    addEventListener(name: string, listener: (event?: unknown) => void) { this.events[name] = listener; }
    send(frame: string) {
      if (this.throwsOnSend) throw new Error("send failed");
      this.sent.push(JSON.parse(frame));
    }
  }
  runInNewContext(script, {
    document: {
      cookie: "flue_session=existing",
      getElementById: (id: string) => elements[id],
      createElement: () => new Element(),
      createTextNode: (text: string) => Object.assign(new Element(), { textContent: text }),
    },
    localStorage: { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value; } },
    URL,
    location: { origin: "https://gebheim.com", protocol: "https:", reload: () => { reloads++; } },
    WebSocket: Socket,
  }, { filename: fileURLToPath(new URL("../public/chat.js", import.meta.url)) });
  return {
    elements, options, socket,
    get reloads() { return reloads; },
    get savedPersona() { return stored; },
    open() { socket.events.open(); },
    send(text: string) {
      elements["chat-input"].value = text;
      elements["chat-form"].events.submit({ preventDefault() {} });
    },
    reply(text = "Answer") { socket.events.message({ data: JSON.stringify({ type: "reply", text }) }); },
  };
}

describe("chat interaction states", () => {
  test("announces connecting and ready states", () => {
    const c = client();
    expect(c.elements["chat-send"].disabled).toBe(true);
    expect(c.elements["chat-status"].textContent).toMatch(/connecting/i);
    c.open();
    expect(c.elements["chat-send"].disabled).toBe(false);
    expect(c.elements["chat-status"].textContent).toMatch(/ready/i);
  });

  test("allows only one outstanding question and preserves the next draft", () => {
    const c = client(); c.open(); c.send("First"); c.send("Second");
    expect(c.socket.sent).toHaveLength(1);
    expect(c.elements["chat-send"].disabled).toBe(true);
    expect(c.elements["chat-status"].textContent).toMatch(/replying/i);
    c.reply();
    expect(c.elements["chat-log"].children.some((e) => e.className.includes("pending"))).toBe(false);
    expect(c.elements["chat-send"].disabled).toBe(false);
    expect(c.elements["chat-input"].value).toBe("Second");
    c.send("Second"); c.reply();
    expect(c.socket.sent).toHaveLength(2);
  });

  test("does not claim a message was unsent when delivery is uncertain", () => {
    const c = client(); c.open(); c.send("Question"); c.socket.events.close();
    expect(c.elements["chat-log"].children[0].textContent).not.toContain("not sent");
    expect(c.elements["chat-status"].textContent).toMatch(/may have arrived/i);
    expect(c.elements["chat-send"].disabled).toBe(true);
    const fallback = c.elements["chat-widget"].querySelector(".chat-fallback")!;
    fallback.children.find((e) => /reload/i.test(e.textContent))!.events.click();
    expect(c.reloads).toBe(1);
  });

  test("a synchronous send failure preserves the draft and reports not sent", () => {
    const c = client(); c.open(); c.socket.throwsOnSend = true; c.send("Keep this draft");
    expect(c.elements["chat-input"].value).toBe("Keep this draft");
    expect(c.elements["chat-status"].textContent).toMatch(/not sent/i);
    expect(c.elements["chat-log"].children[0].className).not.toContain("pending");
  });

  test("reports startup failure and adds only one fallback panel", () => {
    const c = client(null, true);
    expect(c.elements["chat-status"].textContent).toMatch(/offline/i);
    expect(c.elements["chat-send"].disabled).toBe(true);
    const connected = client(); connected.open(); connected.socket.events.error(); connected.socket.events.close();
    expect(connected.elements["chat-widget"].children).toHaveLength(1);
  });

  test("restores a known persona and sends changes from native radios", () => {
    const c = client("robot"); c.open();
    expect(c.options[2].checked).toBe(true);
    c.options[1].checked = true;
    c.options[1].events.change();
    c.send("Hello");
    expect(c.socket.sent[0].persona).toBe("vampire");
    expect(c.savedPersona).toBe("vampire");
  });

  test("an unknown stored persona selects the default", () => {
    const c = client("unknown"); c.open();
    expect(c.options[0].checked).toBe(true);
    c.send("Hello");
    expect(c.socket.sent[0].persona).toBe("default");
  });
});
