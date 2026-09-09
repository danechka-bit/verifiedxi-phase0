// Highlight video handling: parses pasted YouTube/Vimeo links into embeds,
// and saves uploaded video files to local disk.
//
// Local disk (UPLOAD_DIR) is fine for development but will NOT survive most
// hosting platforms' ephemeral filesystems — before deploying, swap
// saveUploadedFile's body for a real object storage upload (S3, Cloudflare
// R2, Cloudinary) and have it return that provider's URL instead. Nothing
// else needs to change; callers only care about the returned URL.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads', 'videos');
const MAX_UPLOAD_BYTES = 150 * 1024 * 1024; // 150MB — enough for a short highlight clip
const ALLOWED_EXTENSIONS = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v' };

function ensureUploadDir() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Recognizes a YouTube or Vimeo URL and returns {source, embedUrl}, or null
// if the link doesn't match either — callers can still store it as a plain
// outbound link in that case.
function parseVideoLink(url) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
  if (yt) return { source: 'youtube', embedUrl: `https://www.youtube.com/embed/${yt[1]}` };
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return { source: 'vimeo', embedUrl: `https://player.vimeo.com/video/${vimeo[1]}` };
  return null;
}

// Saves a formidable-parsed file to disk under a random name (never trusts
// the client-supplied filename) and returns the URL path to serve it from.
// Throws on a disallowed extension or an oversized file.
function saveUploadedFile(file) {
  const ext = path.extname(file.originalFilename || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS[ext]) {
    throw new Error(`Unsupported video format "${ext}". Allowed: ${Object.keys(ALLOWED_EXTENSIONS).join(', ')}`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`Video is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)`);
  }
  ensureUploadDir();
  const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  fs.copyFileSync(file.filepath, path.join(UPLOAD_DIR, filename));
  fs.unlinkSync(file.filepath); // formidable's own tmp file
  return `/uploads/videos/${filename}`;
}

// Serves an uploaded file by its already-sanitized filename (no path
// separators allowed — this is the only way in, so directory traversal
// isn't reachable even if a caller forgot to validate upstream).
function readUploadedFile(filename) {
  if (!/^[a-f0-9]{32}\.\w+$/.test(filename)) return null;
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filename).toLowerCase();
  return { filePath, contentType: ALLOWED_EXTENSIONS[ext] || 'application/octet-stream' };
}

module.exports = { parseVideoLink, saveUploadedFile, readUploadedFile, MAX_UPLOAD_BYTES, ALLOWED_EXTENSIONS };
