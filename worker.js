const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-user, x-pass",
};

const OWNER = "Cedar1012";
const REPO = "excel_tree";
const FILE = "data.json";
const GH = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

      if (request.method === "GET" && path === "/") {
        return json({ ok: true, service: "excel-tree-save" });
      }

      if (request.method === "POST" && path === "/login") {
        const body = await request.json();
        const user = findUser(env, body.username, body.password);
        if (!user) return json({ ok: false, error: "账号或密码不对" }, 401);
        return json({ ok: true, user: publicUser(user) });
      }

      if (request.method === "GET" && path === "/data") {
        const user = findUser(env, headerUser(request), headerPass(request));
        if (!user) return json({ ok: false, error: "未登录" }, 401);
        const file = await readFile(env);
        return json({ ok: true, user: publicUser(user), rows: filterRows(file.rows || [], user) });
      }

      if (request.method === "POST" && path === "/save") {
        const body = await request.json();
        const user = findUser(env, body.username, body.password);
        if (!user) return json({ ok: false, error: "未登录" }, 401);
        const file = await readFile(env);
        const merged = mergeRows(file.rows || [], body.rows || [], user, {
          replaceAll: body.replaceAll === true,
          deletedIds: body.deletedIds || []
        });
        await writeFile(env, { rows: merged }, body.message || `${user.username} 保存台账`);
        return json({ ok: true, rows: filterRows(merged, user) });
      }

      return json({ ok: false, error: "not found" }, 404);
    } catch (err) {
      return json({ ok: false, error: String((err && err.message) || err) }, 500);
    }
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" }
  });
}

function users(env) {
  try {
    const parsed = JSON.parse(env.USERS_JSON || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function findUser(env, username, password) {
  const name = String(username || "").trim();
  const pass = String(password || "");
  return users(env).find((u) => u.username === name && u.password === pass) || null;
}

function publicUser(u) {
  return { username: u.username, role: u.role, bind: u.bind || "" };
}

function headerUser(req) {
  return req.headers.get("x-user") || "";
}

function headerPass(req) {
  return req.headers.get("x-pass") || "";
}

function norm(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function rowField(role) {
  if (role === "company") return "supportCompany";
  if (role === "executor") return "execParty";
  if (role === "signOwner") return "signOwner";
  return null;
}

function filterRows(rows, user) {
  const field = rowField(user.role);
  if (!field) return rows;
  const bind = norm(user.bind);
  if (!bind) return [];
  return rows.filter((r) => norm(r[field]) === bind);
}

function canEdit(role, key) {
  if (role === "admin") return true;
  const company = ["diseaseArea", "projectName", "supportCompany", "hcoName", "signOwner", "projectType", "nature", "presenter", "signTime", "endTime", "status", "signAmount", "manageFee", "execFee", "coordFee", "taxFee", "paymentProgress", "received", "receiveTime", "receivedManage", "receivedExec", "receivedCoord", "receivedTax", "execParty"];
  const executor = ["diseaseArea", "projectName", "supportCompany", "hcoName", "projectType", "nature", "presenter", "status", "execParty", "execOwner", "execSignTime", "execSignAmount", "execManageFee", "execCoordFee", "execExecFee", "execTaxFee", "execReceived", "execReceiveTime", "execReceivedManage", "execReceivedExec", "execReceivedCoord", "execReceivedTax", "paidSupplier", "paidLabor"];
  const signOwner = ["diseaseArea", "projectName", "supportCompany", "hcoName", "signOwner", "projectType", "nature", "presenter", "signTime", "endTime", "status", "execParty"];
  if (role === "company") return company.includes(key);
  if (role === "executor") return executor.includes(key);
  if (role === "signOwner") return signOwner.includes(key);
  return false;
}

function canCreate(role) {
  return role === "admin" || role === "company" || role === "executor" || role === "signOwner";
}

function canTouch(user, row) {
  if (!row) return false;
  if (user.role === "admin") return true;
  const field = rowField(user.role);
  return !!(field && user.bind && norm(row[field]) === norm(user.bind));
}

function mergeRows(oldRows, incoming, user, opts = {}) {
  const replaceAll = !!opts.replaceAll;
  const deletedIds = Array.isArray(opts.deletedIds) ? opts.deletedIds : [];
  const byId = new Map((oldRows || []).filter((r) => r && r.id).map((r) => [r.id, r]));
  const list = Array.isArray(incoming) ? incoming : [];

  for (const id of deletedIds) {
    const prev = byId.get(id);
    if (prev && canTouch(user, prev) && (user.role === "admin" || user.role === "company")) {
      byId.delete(id);
    }
  }

  for (const row of list) {
    if (!row || !row.id) continue;
    const prev = byId.get(row.id);
    if (!prev) {
      if (!canCreate(user.role)) continue;
      const created = { ...row };
      const field = rowField(user.role);
      if (field && user.bind) created[field] = user.bind;
      byId.set(row.id, created);
      continue;
    }
    const field = rowField(user.role);
    if (field && norm(prev[field]) !== norm(user.bind) && user.role !== "admin") continue;
    const next = { ...prev };
    Object.keys(row).forEach((k) => {
      if (k === "id") return;
      if (canEdit(user.role, k)) next[k] = row[k];
    });
    byId.set(row.id, next);
  }

  if (user.role === "admin" && replaceAll) {
    const keep = new Set(list.map((r) => r && r.id).filter(Boolean));
    for (const id of Array.from(byId.keys())) {
      if (!keep.has(id)) byId.delete(id);
    }
  }

  return Array.from(byId.values());
}

function decodeGitContent(content) {
  const bin = atob(String(content || "").replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeGitContent(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

async function readFile(env) {
  const res = await fetch(`${GH}?ref=main`, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "excel-tree-save"
    }
  });
  if (res.status === 404) return { rows: [], sha: null };
  if (!res.ok) throw new Error("读取仓库失败 " + res.status);
  const data = await res.json();
  const parsed = JSON.parse(decodeGitContent(data.content) || '{"rows":[]}');
  return {
    rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    sha: data.sha
  };
}

async function writeFile(env, payload, message) {
  const latest = await readFile(env);
  const body = {
    message,
    content: encodeGitContent(JSON.stringify({ rows: payload.rows }, null, 2)),
    branch: "main"
  };
  if (latest.sha) body.sha = latest.sha;
  const res = await fetch(GH, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "excel-tree-save",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error("写入仓库失败 " + res.status + " " + await res.text());
}
