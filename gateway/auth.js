// Passkey sign-in for one account. Same shape as humanizer-pass: SimpleWebAuthn on the server,
// SQLite for the user, credentials, sign-in links and sessions. Cookies and links carry a random
// value; the database stores only its SHA-256. There is no sign-up: the one user is created from
// ALLOWED_EMAIL at startup, and a new device is added through a one-time emailed link.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("base64url");
const now = () => Date.now();
export const normalizeEmail = (s) => String(s || "").trim().toLowerCase();

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function openAuth({ dataDir, rpID, rpName, origin, email, sessionDays, linkMinutes }) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, "auth.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT,
      device_type TEXT, backed_up INTEGER, created_at INTEGER NOT NULL, last_used INTEGER);
    CREATE TABLE IF NOT EXISTS links (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
  `);

  const q = {
    userByEmail: db.prepare("SELECT id, email FROM users WHERE email = ?"),
    userById: db.prepare("SELECT id, email FROM users WHERE id = ?"),
    insertUser: db.prepare("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)"),
    credsForUser: db.prepare("SELECT id, transports FROM credentials WHERE user_id = ?"),
    credCount: db.prepare("SELECT COUNT(*) AS n FROM credentials"),
    credById: db.prepare("SELECT * FROM credentials WHERE id = ?"),
    insertCred: db.prepare(`INSERT INTO credentials
      (id, user_id, public_key, counter, transports, device_type, backed_up, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
    touchCred: db.prepare("UPDATE credentials SET counter = ?, last_used = ? WHERE id = ?"),
    link: db.prepare("SELECT * FROM links WHERE token_hash = ?"),
    insertLink: db.prepare("INSERT INTO links (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    useLink: db.prepare("UPDATE links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL"),
    insertSession: db.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)"),
    session: db.prepare("SELECT s.id_hash, s.expires_at, u.id AS user_id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?"),
    touchSession: db.prepare("UPDATE sessions SET last_seen = ? WHERE id_hash = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE id_hash = ?"),
    sweepSessions: db.prepare("DELETE FROM sessions WHERE expires_at < ?"),
    sweepLinks: db.prepare("DELETE FROM links WHERE expires_at < ?"),
  };

  // The one account.
  const allowed = normalizeEmail(email);
  if (!allowed) throw new Error("ALLOWED_EMAIL is not set");
  let user = q.userByEmail.get(allowed);
  if (!user) {
    q.insertUser.run(crypto.randomUUID(), allowed, now());
    user = q.userByEmail.get(allowed);
  }

  // Pending WebAuthn challenges, keyed by a one-time id handed to the browser.
  const challenges = new Map();
  function putChallenge(data) {
    const id = randomToken();
    challenges.set(id, { ...data, exp: now() + CHALLENGE_TTL_MS });
    return id;
  }
  function takeChallenge(id) {
    const c = challenges.get(String(id || ""));
    challenges.delete(String(id || ""));
    return c && c.exp >= now() ? c : null;
  }
  setInterval(() => {
    const t = now();
    for (const [k, v] of challenges) if (v.exp < t) challenges.delete(k);
    q.sweepSessions.run(t);
    q.sweepLinks.run(t - 86400_000);
  }, 60_000).unref();

  // ---------- sign-in links (add a device) ----------
  // Returns null for any address other than the one account, so the caller can answer the same
  // way either way.
  function createLink(typedEmail) {
    if (normalizeEmail(typedEmail) !== allowed) return null;
    const token = randomToken();
    q.insertLink.run(sha256(token), user.id, now(), now() + linkMinutes * 60_000);
    return { to: allowed, url: `${origin}/link/${token}`, minutes: linkMinutes };
  }
  function readLink(token) {
    if (typeof token !== "string" || token.length < 30 || token.length > 100) return null;
    const row = q.link.get(sha256(token));
    if (!row || row.used_at || row.expires_at < now()) return null;
    return row;
  }

  // ---------- sessions ----------
  function readSession(cookieValue) {
    if (!cookieValue) return null;
    const row = q.session.get(sha256(cookieValue));
    if (!row || row.expires_at < now()) return null;
    q.touchSession.run(now(), row.id_hash);
    return { userId: row.user_id, email: row.email, idHash: row.id_hash };
  }
  function createSession(userId) {
    const id = randomToken();
    const t = now();
    q.insertSession.run(sha256(id), userId, t, t + sessionDays * 86400_000, t);
    return { id, maxAge: sessionDays * 86400 };
  }
  function deleteSession(cookieValue) {
    if (cookieValue) q.deleteSession.run(sha256(cookieValue));
  }

  // ---------- registration (add a passkey, needs a live link) ----------
  async function registrationOptions(token) {
    const link = readLink(token);
    if (!link) throw httpError(410, "This link has expired or was already used. Ask for a new one.");
    const owner = q.userById.get(link.user_id);
    const options = await generateRegistrationOptions({
      rpName, rpID,
      userID: new TextEncoder().encode(owner.id),
      userName: owner.email,
      userDisplayName: owner.email,
      attestationType: "none",
      excludeCredentials: q.credsForUser.all(owner.id).map((c) => ({ id: c.id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const challengeId = putChallenge({ kind: "reg", challenge: options.challenge, userId: owner.id, linkHash: link.token_hash });
    return { options, challengeId };
  }
  async function registrationVerify({ challengeId, response }) {
    const c = takeChallenge(challengeId);
    if (!c || c.kind !== "reg") throw httpError(400, "That took too long. Press Create passkey again.");
    const link = q.link.get(c.linkHash);
    if (!link || link.used_at || link.expires_at < now()) throw httpError(410, "This link has expired or was already used. Ask for a new one.");
    let result;
    try {
      result = await verifyRegistrationResponse({
        response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      });
    } catch {
      throw httpError(400, "The passkey could not be verified. Try again.");
    }
    if (!result.verified || !result.registrationInfo) throw httpError(400, "The passkey could not be verified. Try again.");
    // Use the link before storing the key, so two racing requests can't both enrol.
    if (q.useLink.run(now(), c.linkHash).changes !== 1) throw httpError(410, "This link was already used. Ask for a new one.");
    const info = result.registrationInfo;
    const cred = info.credential;
    q.insertCred.run(
      cred.id, c.userId, Buffer.from(cred.publicKey).toString("base64url"), cred.counter,
      JSON.stringify(cred.transports || []), info.credentialDeviceType, info.credentialBackedUp ? 1 : 0, now(),
    );
    return { userId: c.userId };
  }

  // ---------- authentication (sign in) ----------
  // Discoverable credentials and an empty allow list: the answer is the same for any email.
  async function authenticationOptions() {
    const options = await generateAuthenticationOptions({ rpID, userVerification: "required", allowCredentials: [] });
    const challengeId = putChallenge({ kind: "auth", challenge: options.challenge });
    return { options, challengeId };
  }
  async function authenticationVerify({ challengeId, response }) {
    const c = takeChallenge(challengeId);
    if (!c || c.kind !== "auth") throw httpError(400, "That took too long. Try again.");
    const cred = typeof response?.id === "string" ? q.credById.get(response.id) : null;
    if (!cred) throw httpError(401, "That passkey didn't work.");
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response, expectedChallenge: c.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: {
          id: cred.id, publicKey: Buffer.from(cred.public_key, "base64url"), counter: cred.counter,
          transports: cred.transports ? JSON.parse(cred.transports) : undefined,
        },
      });
    } catch {
      throw httpError(401, "That passkey didn't work.");
    }
    if (!result.verified) throw httpError(401, "That passkey didn't work.");
    q.touchCred.run(result.authenticationInfo.newCounter, now(), cred.id);
    return { userId: cred.user_id };
  }

  const passkeyCount = () => q.credCount.get().n;

  return {
    createLink, readLink, readSession, createSession, deleteSession,
    registrationOptions, registrationVerify, authenticationOptions, authenticationVerify,
    passkeyCount, accountId: user.id, close: () => db.close(),
  };
}
