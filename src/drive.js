const GAPI_SRC = "https://apis.google.com/js/api.js";
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];

let gapiLoaded = false;
let clientInited = false;

export async function ensureGapiLoaded() {
  if (gapiLoaded) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = GAPI_SRC; s.async = true; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  gapiLoaded = true;
}

export async function initDrive({ clientId }) {
  await ensureGapiLoaded();
  await new Promise((res) => window.gapi.load("client:auth2", res));
  if (!clientInited) {
    await window.gapi.client.init({ clientId, scope: SCOPE, discoveryDocs: DISCOVERY_DOCS });
    clientInited = true;
  }
  return window.gapi.auth2.getAuthInstance();
}

export function isSignedIntoDrive() {
  const auth = window.gapi?.auth2?.getAuthInstance?.();
  return !!auth && auth.isSignedIn.get();
}

export async function signInDrive() {
  const auth = window.gapi.auth2.getAuthInstance();
  if (!auth.isSignedIn.get()) await auth.signIn();
}
export async function signOutDrive() {
  const auth = window.gapi.auth2.getAuthInstance();
  if (auth.isSignedIn.get()) await auth.signOut();
}

async function findBackupFileId(filename) {
  const q = `name='${filename.replace(/'/g, "\'")}' and trashed=false`;
  const resp = await window.gapi.client.drive.files.list({ q, fields: "files(id,name)" });
  return resp.result.files?.[0]?.id || null;
}

export async function backupJSON(filename, jsonObj) {
  const metadata = { name: filename, mimeType: "application/json" };
  const body = JSON.stringify(jsonObj, null, 2);
  const boundary = "foo_bar_baz_" + Date.now();
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  const multipartBody =
    delimiter +
    "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
    JSON.stringify(metadata) +
    delimiter +
    "Content-Type: application/json\r\n\r\n" +
    body +
    closeDelim;

  const fileId = await findBackupFileId(filename);
  if (fileId) {
    return window.gapi.client.request({
      path: `/upload/drive/v3/files/${fileId}`,
      method: "PATCH",
      params: { uploadType: "multipart" },
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipartBody,
    });
  }
  return window.gapi.client.request({
    path: "/upload/drive/v3/files",
    method: "POST",
    params: { uploadType: "multipart" },
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });
}

export async function loadBackupJSON(filename) {
  const fileId = await findBackupFileId(filename);
  if (!fileId) return null;
  const resp = await window.gapi.client.drive.files.get({ fileId, alt: "media" });
  return resp.result;
}
