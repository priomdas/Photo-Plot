// Thin wrapper around the PhotoPilot backend.
// Every call goes through the Vite dev proxy (see vite.config.js).

async function asJson(response) {
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return response.json();
}

export function getGpu() {
  return fetch("/api/gpu").then(asJson);
}

export function listPresets() {
  return fetch("/api/presets").then(asJson);
}

export function savePreset(preset) {
  return fetch("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preset),
  }).then(asJson);
}

export function deletePreset(name) {
  return fetch(`/api/presets/${encodeURIComponent(name)}`, { method: "DELETE" }).then(asJson);
}

export async function importPreset(file) {
  const data = new FormData();
  data.append("file", file);
  const response = await fetch("/api/presets/import", { method: "POST", body: data });
  return asJson(response);
}

function buildForm(preset, logo, device = "auto") {
  const data = new FormData();
  if (logo) data.append("logo", logo);
  data.append("preset_json", JSON.stringify(preset));
  data.append("device", device || "auto");
  return data;
}

export async function previewUpload(file, preset, logo, device = "auto") {
  const data = buildForm(preset, logo, device);
  data.append("file", file);
  const response = await fetch("/api/preview-upload", { method: "POST", body: data });
  if (!response.ok) {
    let detail = "Could not create preview.";
    try {
      detail = (await response.json()).detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  const deviceUsed = response.headers.get("X-Device-Used") || null;
  const url = URL.createObjectURL(await response.blob());
  return { url, deviceUsed };
}

export async function startProcess(files, preset, logo, device = "auto") {
  const data = buildForm(preset, logo, device);
  files.forEach((f) => data.append("files", f));
  return fetch("/api/process", { method: "POST", body: data }).then(asJson);
}

export function getProgress(jobId) {
  return fetch(`/api/progress/${jobId}`).then(asJson);
}

export function openFolder() {
  return fetch("/api/open-folder", { method: "POST" }).then(asJson);
}

// Curation API
export function getCurationConfig() {
  return fetch("/api/curation/config").then(asJson);
}

export function saveCurationConfig(cfg) {
  return fetch("/api/curation/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  }).then(asJson);
}

export async function startCuration(files = [], folderPath = "") {
  const data = new FormData();
  if (folderPath && folderPath.trim()) {
    data.append("folder_path", folderPath.trim());
  } else {
    files.forEach((f) => data.append("files", f));
  }
  const response = await fetch("/api/curation/start", { method: "POST", body: data });
  return asJson(response);
}

export function getCurationProgress(jobId) {
  return fetch(`/api/curation/progress/${jobId}`).then(asJson);
}

export function selectBestN(groups, standalone, targetCount) {
  return fetch("/api/curation/select-best-n", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groups, standalone, target_count: targetCount }),
  }).then(asJson);
}

export function getThumbnailUrl(path, maxSize = 360) {
  return `/api/curation/thumbnail?path=${encodeURIComponent(path)}&max_size=${maxSize}`;
}

// ============================================
// Social / Post Composer API
// ============================================

export function getCaptionProviders() {
  return fetch("/api/social/providers").then(asJson);
}

export function getCaptionConfig() {
  return fetch("/api/social/caption/config").then(asJson);
}

export function saveCaptionConfig(config) {
  return fetch("/api/social/caption/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  }).then(asJson);
}

export function testCaptionConnection(config) {
  return fetch("/api/social/caption/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  }).then(asJson);
}

export async function uploadPhotosForPublish(files) {
  const data = new FormData();
  files.forEach((f) => data.append("files", f));
  const response = await fetch("/api/social/upload-photos", { method: "POST", body: data });
  return asJson(response);
}

export function generateCaption({ imagePath = "", prompt = "", provider = "rule-based" } = {}) {
  return fetch("/api/social/caption/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_path: imagePath, prompt, provider }),
  }).then(asJson);
}

export function generateHashtags({ caption = "", imagePath = "", category = "photography", count = 15 } = {}) {
  return fetch("/api/social/hashtags/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caption, image_path: imagePath, category, count }),
  }).then(asJson);
}

export function getHashtagCategories() {
  return fetch("/api/social/hashtags/categories").then(asJson);
}

// Hashtag Sets
export function getHashtagSets() {
  return fetch("/api/social/hashtag-sets").then(asJson);
}

export function saveHashtagSet(name, hashtags) {
  return fetch("/api/social/hashtag-sets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, hashtags }),
  }).then(asJson);
}

export function deleteHashtagSet(setId) {
  return fetch(`/api/social/hashtag-sets/${setId}`, { method: "DELETE" }).then(asJson);
}

// Drafts
export function getDrafts(status = "") {
  const qs = status ? `?status=${status}` : "";
  return fetch(`/api/social/drafts${qs}`).then(asJson);
}

export function createDraft({ title = "", caption = "", hashtags = [], photoPaths = [], pageId = "" } = {}) {
  return fetch("/api/social/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, caption, hashtags, photo_paths: photoPaths, page_id: pageId }),
  }).then(asJson);
}

export function updateDraft(draftId, fields) {
  const body = {};
  if (fields.title !== undefined) body.title = fields.title;
  if (fields.caption !== undefined) body.caption = fields.caption;
  if (fields.hashtags !== undefined) body.hashtags = fields.hashtags;
  if (fields.photoPaths !== undefined) body.photo_paths = fields.photoPaths;
  if (fields.pageId !== undefined) body.page_id = fields.pageId;
  if (fields.status !== undefined) body.status = fields.status;
  if (fields.scheduledAt !== undefined) body.scheduled_at = fields.scheduledAt;
  return fetch(`/api/social/drafts/${draftId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(asJson);
}

export function deleteDraft(draftId) {
  return fetch(`/api/social/drafts/${draftId}`, { method: "DELETE" }).then(asJson);
}

// Facebook Pages
export function getFacebookPages() {
  return fetch("/api/social/facebook/pages").then(asJson);
}

export function connectFacebookPage(pageAccessToken) {
  return fetch("/api/social/facebook/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page_access_token: pageAccessToken }),
  }).then(asJson);
}

export function connectFacebookPagesFromUser(userAccessToken) {
  return fetch("/api/social/facebook/connect-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_access_token: userAccessToken }),
  }).then(asJson);
}

export function disconnectFacebookPage(pageId) {
  return fetch(`/api/social/facebook/pages/${pageId}`, { method: "DELETE" }).then(asJson);
}

// Publishing
export function publishPost({ draftId = "", pageId = "", pageIds = [], caption, hashtags = [], photoPaths = [], scheduledPublishTime = 0 }) {
  return fetch("/api/social/publish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      draft_id: draftId,
      page_id: pageId,
      page_ids: pageIds,
      caption,
      hashtags,
      photo_paths: photoPaths,
      scheduled_publish_time: scheduledPublishTime,
    }),
  }).then(asJson);
}

export function getPublishProgress(jobId) {
  return fetch(`/api/social/publish/progress/${jobId}`).then(asJson);
}

export function getPublishHistory(limit = 50) {
  return fetch(`/api/social/history?limit=${limit}`).then(asJson);
}
